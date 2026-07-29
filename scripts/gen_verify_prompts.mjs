#!/usr/bin/env node
/**
 * Generate verifier prompt files for enriched records.
 * Usage: node scripts/gen_verify_prompts.mjs 9,10,11,12
 * Writes data/batches/verify-<first>-v1.txt and -v2.txt containing the
 * verification instructions + each record's slug and source URLs (only).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const keys = process.argv[2].split(",").map((s) => s.trim());

const TEMPLATE = (pass) => `You are an independent verification agent for a database of civil lawsuits involving sexual assault/harassment and law-enforcement agencies. Today is 2026-07-28. For each record below you get ONLY source URLs. Read the sources (WebFetch; if one fails, skip it — do NOT search for other articles) and independently derive the fields from the sources alone. Do not guess: if the sources don't establish a value, use null.${pass === 2 ? " Be skeptical and literal about what the sources actually say." : ""}

For each record, write a JSON file to /Users/sofiedewan/police-sa-lawsuits/data/verify/rec-<key>-v${pass}.json (the <key> is given per record):
{
  "row": <int>, "slug": "<given>",
  "fields": {
    "agency": "<official agency name as best supported by sources>",
    "agency_category": "police|sheriff|state_police|corrections|juvenile|federal|campus|transit|other",
    "country": "US|CA",
    "state_province": "<2-letter>",
    "lawsuit_type": "civilian|internal|class_action",
    "year_filed": <int|null>,
    "outcome_status": "settled|plaintiff_verdict|defense_verdict|dismissed|ongoing|no_resolution_found",
    "settlement_amount_original": <number|null>,
    "criminal_status": "none_filed|charged|convicted|pleaded_guilty|acquitted|charges_dropped|unknown"
  },
  "caveats": "<brief notes on anything ambiguous>"
}
Definitions: civilian = officer accused of assaulting a civilian; internal = employee suing own agency over workplace sexual assault/harassment; class_action = mass litigation. "ongoing" only if sources confirm the case is active; "no_resolution_found" if sources show no resolution. year_filed = year the CIVIL suit was filed. If no lawsuit exists in the sources, pick the closest lawsuit_type fit and say so in caveats.

Final message: one line per record "rec-<key>: done". Nothing else.

THE RECORDS:

`;

let blocks = "";
for (const key of keys) {
  const rec = JSON.parse(readFileSync(path.join(ROOT, "data/enriched", `rec-${key}.json`), "utf8"));
  const urls = (rec.sources ?? []).map((s) => s.url).filter(Boolean).join("\n");
  blocks += `Record key=${key}, row=${rec.row}, slug="${rec.slug}", sources:\n${urls}\n\n`;
}

for (const pass of [1, 2]) {
  const out = path.join(ROOT, "data/batches", `verify-${keys[0]}-v${pass}.txt`);
  writeFileSync(out, TEMPLATE(pass) + blocks);
  console.log("wrote", out);
}
