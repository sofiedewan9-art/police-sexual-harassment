#!/usr/bin/env python3
"""Parse the seed spreadsheet into staging JSON for import + enrichment.

Reads data/SH Lawsuits and media articles.xlsx (sheet "Lawsuits") and writes
data/seed_staging.json with one object per row. Free-text year/outcome cells
are split into year_filed / result_text / dollar hints; multi-article link
cells keep the one surviving hyperlink and record the orphaned titles whose
URLs Excel discarded (to be re-found during enrichment).
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "SH Lawsuits and media articles.xlsx"
OUT = ROOT / "data" / "seed_staging.json"

MONEY_RE = re.compile(
    r"\$\s*([\d,.]+)\s*(billion|million|[MKB])?", re.IGNORECASE
)
YEAR_RE = re.compile(r"(~?)\s*((?:19|20)\d{2})(?:\s*-\s*((?:19|20)\d{2}))?")


def parse_money(text: str):
    """Return the largest dollar amount mentioned, in dollars, or None."""
    best = None
    for m in MONEY_RE.finditer(text):
        num = float(m.group(1).replace(",", ""))
        unit = (m.group(2) or "").lower()
        if unit in ("billion", "b"):
            num *= 1_000_000_000
        elif unit in ("million", "m"):
            num *= 1_000_000
        elif unit == "k":
            num *= 1_000
        best = max(best or 0, num)
    return best


def parse_year_cell(raw):
    """Split e.g. '2021 (settled $1.8M in Oct 2022)' into structured hints."""
    out = {
        "year_filed": None,
        "year_filed_approx": False,
        "filing_year_range": None,
        "result_text": None,
        "dollar_hint": None,
    }
    if raw is None:
        return out
    text = str(raw).strip()
    if text.endswith(".0"):
        text = text[:-2]
    m = YEAR_RE.search(text)
    if m:
        out["year_filed"] = int(m.group(2))
        out["year_filed_approx"] = m.group(1) == "~"
        if m.group(3):
            out["filing_year_range"] = f"{m.group(2)}-{m.group(3)}"
    paren = re.search(r"\((.*)\)\s*$", text, re.DOTALL)
    if paren:
        out["result_text"] = paren.group(1).strip()
    elif not m:
        # cells like plain "Ongoing"
        out["result_text"] = text or None
    elif text[: m.start()].strip() or text[m.end():].strip().strip("()"):
        leftover = (text[: m.start()] + " " + text[m.end():]).strip()
        leftover = leftover.strip("() ")
        if leftover:
            out["result_text"] = leftover
    out["dollar_hint"] = parse_money(text)
    return out


def main():
    wb = openpyxl.load_workbook(XLSX)
    ws = wb["Lawsuits"]
    records = []
    for row in ws.iter_rows(min_row=2):
        agency, year, thirty, country, state, links = row[:6]
        notes = row[6] if len(row) > 6 else None
        values = [c.value for c in (agency, year, thirty, country, state, links)]
        if not any(v is not None for v in values):
            continue
        link_lines = [
            l.strip() for l in str(links.value or "").split("\n") if l.strip()
        ]
        rec = {
            "row": agency.row,
            "agency_raw": str(agency.value).strip() if agency.value else None,
            "year_raw": str(year.value).strip() if year.value is not None else None,
            "is_30x30_raw": str(thirty.value).strip() if thirty.value else None,
            "country_raw": str(country.value).strip() if country.value else None,
            "state_raw": str(state.value).strip() if state.value else None,
            "notes_raw": str(notes.value).strip() if notes and notes.value else None,
            "sources": [],
            # titles whose URLs Excel discarded (one hyperlink per cell);
            # enrichment re-finds these by searching the title text
            "orphan_titles": [],
        }
        if link_lines:
            url = links.hyperlink.target if links.hyperlink else None
            rec["sources"].append({"title": link_lines[0], "url": url})
            rec["orphan_titles"] = link_lines[1:]
        rec.update(parse_year_cell(year.value))
        records.append(rec)

    OUT.write_text(json.dumps(records, indent=2, ensure_ascii=False))

    n = len(records)
    print(f"wrote {n} records -> {OUT.relative_to(ROOT)}")
    print(f"  missing year_filed : {sum(1 for r in records if r['year_filed'] is None)}")
    print(f"  missing agency     : {sum(1 for r in records if not r['agency_raw'])}")
    print(f"  missing country    : {sum(1 for r in records if not r['country_raw'])}")
    print(f"  missing 30x30 flag : {sum(1 for r in records if not r['is_30x30_raw'])}")
    print(f"  missing source URL : {sum(1 for r in records if not r['sources'] or not r['sources'][0]['url'])}")
    print(f"  orphaned titles    : {sum(len(r['orphan_titles']) for r in records)}")
    print(f"  with $ hint        : {sum(1 for r in records if r['dollar_hint'])}")
    print(f"  with result text   : {sum(1 for r in records if r['result_text'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
