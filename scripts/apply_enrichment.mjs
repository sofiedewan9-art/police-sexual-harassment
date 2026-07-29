#!/usr/bin/env node
/**
 * Merge enrichment + verification results into Supabase.
 *
 * Inputs:
 *   data/enriched/rec-<row>.json        research agent output (full record)
 *   data/verify/rec-<row>-v1.json,-v2   two independent verifier outputs (fields only)
 *
 * For each record with all three files present:
 *   - compute per-field agreement (extractor + 2 verifiers) on audited columns
 *   - fill is_30x30 deterministically from agencies_30x30 (only when currently null)
 *   - find/capture archive.org snapshots for every source URL
 *   - upsert incidents + sources, log revisions, queue conflicts for review
 *   - set last_verified; status remains needs_review (human audit publishes)
 *
 * Usage: node scripts/apply_enrichment.mjs [--rows 2,3,4] [--skip-archive] [--allow-unverified]
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const SKIP_ARCHIVE = args.includes("--skip-archive");
const ALLOW_UNVERIFIED = args.includes("--allow-unverified");
const rowsArg = args[args.indexOf("--rows") + 1];
const ONLY_ROWS = args.includes("--rows") ? rowsArg.split(",").map(Number) : null;

const CAD_TO_USD = 0.73; // fixed conversion, July 2026 — documented in record notes

for (const line of readFileSync(path.join(ROOT, "web/.env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createClient } = createRequire(path.join(ROOT, "web/package.json"))("@supabase/supabase-js");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const manifest = JSON.parse(readFileSync(path.join(ROOT, "data/work_manifest.json"), "utf8"));
const byRow = new Map(manifest.map((m) => [m.row, m]));
const TODAY = "2026-07-28";

// ---------- helpers ----------
const AUDITED = [
  "agency", "agency_category", "country", "state_province", "lawsuit_type",
  "year_filed", "outcome_status", "settlement_amount_original", "criminal_status",
];

function norm(field, v) {
  if (v == null || v === "") return null;
  if (field === "agency") {
    return String(v).toLowerCase().replace(/['’.]/g, "").replace(/\s+/g, " ")
      .replace(/\b(the|of)\b/g, "").trim();
  }
  if (field === "settlement_amount_original") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (field === "year_filed") return Number(v) || null;
  return String(v).toLowerCase().trim();
}

function agreement(field, ext, v1, v2) {
  const e = norm(field, ext), a = norm(field, v1), b = norm(field, v2);
  if (field === "settlement_amount_original" && e != null && a != null && b != null) {
    const close = (x, y) => Math.abs(x - y) <= Math.max(0.01 * Math.max(x, y), 1);
    if (close(e, a) && close(e, b)) return "3way";
    if (close(e, a) || close(e, b)) return "2way";
    return "conflict";
  }
  if (e === a && e === b) return "3way";
  if (e === a || e === b) return "2way";
  if (a === b && a !== e) return "verifiers_disagree_with_extractor";
  return "conflict";
}

async function wayback(url) {
  try {
    const r = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const j = await r.json();
    const snap = j?.archived_snapshots?.closest;
    if (snap?.available && snap.url) return snap.url.replace(/^http:/, "https:");
  } catch {}
  return null;
}

async function savePageNow(url) {
  try {
    const r = await fetch(`https://web.archive.org/save/${url}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
      headers: { "User-Agent": "policing-project-lawsuits-db/1.0 (archive request)" },
    });
    if (r.ok && r.url.includes("/web/")) return r.url;
    const loc = r.headers.get("content-location");
    if (loc) return `https://web.archive.org${loc}`;
  } catch {}
  return null;
}

async function archiveUrl(url) {
  const existing = await wayback(url);
  if (existing) return existing;
  const fresh = await savePageNow(url);
  if (fresh) return fresh;
  return null;
}

// 30x30 deterministic matcher (conservative: same state + name similarity)
const { data: agencies30 } = await db.from("agencies_30x30").select("name, city, state_province, country");
function match30x30(agencyName, state) {
  if (!agencyName || !state) return { match: null, note: "insufficient data for 30x30 match" };
  const n = norm("agency", agencyName);
  const candidates = (agencies30 ?? []).filter(
    (a) => a.state_province === state && (norm("agency", a.name) === n)
  );
  if (candidates.length === 1) return { match: true, note: null };
  // near-miss: name matches in a different state → explicitly No but note it
  const otherState = (agencies30 ?? []).filter(
    (a) => a.state_province !== state && norm("agency", a.name) === n
  );
  if (otherState.length) {
    return {
      match: false,
      note: `30x30 list has same-named agency in ${otherState.map((a) => a.state_province).join(", ")}; conservative same-state rule → No`,
    };
  }
  return { match: false, note: null };
}

// ---------- main loop ----------
// One record per lawsuit: a seed row that covers N distinct suits yields
// rec-<row>.json (primary, updates the seed's DB row) plus rec-<row>b.json,
// rec-<row>c.json… (splits, inserted as new DB rows with suffixed slugs).
const enrichedFiles = readdirSync(path.join(ROOT, "data/enriched")).filter((f) => f.match(/^rec-\d+[a-z]?\.json$/));
let applied = 0, skipped = 0, conflicts = 0;

for (const file of enrichedFiles) {
  const [, rowStr, letter] = file.match(/rec-(\d+)([a-z]?)\.json/);
  const row = Number(rowStr);
  if (ONLY_ROWS && !ONLY_ROWS.includes(row)) continue;
  let seed = byRow.get(row);
  if (!seed) { console.log(`row ${row}: not in manifest, skipping`); continue; }
  if (letter) {
    // split record: insert (or reuse) a new incident row
    const splitSlug = `${seed.slug}-${letter}`;
    const { data: existing } = await db.from("incidents").select("id").eq("slug", splitSlug).maybeSingle();
    let splitId = existing?.id;
    if (!splitId) {
      const { data: created, error: insErr } = await db.from("incidents")
        .insert({ slug: splitSlug, agency: seed.agency_raw ?? "Unknown", status: "needs_review" })
        .select("id").single();
      if (insErr) { console.log(`row ${row}${letter}: INSERT FAILED — ${insErr.message}`); continue; }
      splitId = created.id;
    }
    seed = { ...seed, id: splitId, slug: splitSlug };
  }

  const key = `${row}${letter}`;
  let rec;
  try {
    rec = JSON.parse(readFileSync(path.join(ROOT, "data/enriched", file), "utf8"));
  } catch (e) {
    console.log(`row ${key}: UNPARSEABLE enriched file, skipping — ${e.message.slice(0, 60)}`);
    skipped++;
    continue;
  }
  const v1Path = path.join(ROOT, "data/verify", `rec-${key}-v1.json`);
  const v2Path = path.join(ROOT, "data/verify", `rec-${key}-v2.json`);
  let confidence = {};
  const conflictFields = [];

  if (existsSync(v1Path) && existsSync(v2Path)) {
    let v1, v2;
    try {
      v1 = JSON.parse(readFileSync(v1Path, "utf8")).fields ?? {};
      v2 = JSON.parse(readFileSync(v2Path, "utf8")).fields ?? {};
    } catch (e) {
      console.log(`row ${key}: UNPARSEABLE verify file, skipping — ${e.message.slice(0, 60)}`);
      skipped++;
      continue;
    }
    for (const f of AUDITED) {
      const verdict = agreement(f, rec[f], v1[f], v2[f]);
      confidence[f] = verdict;
      if (verdict !== "3way" && verdict !== "2way") conflictFields.push(f);
    }
  } else if (!ALLOW_UNVERIFIED) {
    console.log(`row ${row}: verifier files missing, skipping (use --allow-unverified to override)`);
    skipped++;
    continue;
  } else {
    confidence = { unverified: true };
  }

  // 30x30: fill only if currently null; never overwrite a seed Yes/No
  let is30 = seed.is_30x30_raw == null ? null : /^y/i.test(seed.is_30x30_raw);
  let note30 = null;
  if (is30 == null) {
    const m30 = match30x30(rec.agency, rec.state_province);
    is30 = m30.match;
    note30 = m30.note;
  }

  // settlement USD normalization
  let settlementUsd = rec.settlement_amount_original ?? null;
  let currencyNote = null;
  if (settlementUsd != null && rec.settlement_currency === "CAD") {
    settlementUsd = Math.round(settlementUsd * CAD_TO_USD);
    currencyNote = `Settlement USD-normalized from CAD at ${CAD_TO_USD} (Jul 2026).`;
  }

  const notes = [rec.notes, note30 ? `30x30: ${note30}` : null, currencyNote,
    rec.inclusion_concern ? `INCLUSION: ${rec.inclusion_concern}` : null]
    .filter(Boolean).join(" ") || null;

  const updates = {
    agency: rec.agency,
    agency_category: rec.agency_category,
    country: rec.country,
    state_province: rec.state_province,
    lawsuit_type: rec.lawsuit_type,
    year_filed: rec.year_filed,
    year_filed_approx: Boolean(rec.year_filed_approx),
    filing_year_range: rec.filing_year_range,
    multiple_filings: Boolean(rec.multiple_filings),
    outcome_status: rec.outcome_status,
    outcome_detail: rec.outcome_detail || null,
    settlement_amount: settlementUsd,
    settlement_amount_original: rec.settlement_amount_original,
    settlement_currency: rec.settlement_currency ?? "USD",
    settlement_date: rec.settlement_date,
    criminal_status: rec.criminal_status,
    criminal_detail: rec.criminal_detail || null,
    officer_names: rec.officer_names ?? [],
    incident_date_approx: rec.incident_date_approx || null,
    description: rec.description,
    notes,
    is_30x30: is30,
    thirty_by_thirty_match_note: note30,
    confidence,
    last_verified: TODAY,
    status: "needs_review",
  };

  // revisions: log changed fields
  const { data: current } = await db.from("incidents").select("*").eq("id", seed.id).single();
  const revs = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === "confidence") continue;
    const prev = current[k];
    if (String(prev ?? "") !== String(v ?? "")) {
      revs.push({
        incident_id: seed.id, field: k,
        old_value: prev == null ? null : String(prev),
        new_value: v == null ? null : String(v),
        changed_by: "enrichment:2026-07-28",
      });
    }
  }

  const { error } = await db.from("incidents").update(updates).eq("id", seed.id);
  if (error) { console.log(`row ${row}: UPDATE FAILED — ${error.message}`); continue; }
  if (revs.length) await db.from("revisions").insert(revs);

  // sources (with archive snapshots)
  for (const s of rec.sources ?? []) {
    if (!s.url) continue;
    let archive_url = null;
    if (!SKIP_ARCHIVE) {
      archive_url = await archiveUrl(s.url);
      await new Promise((r) => setTimeout(r, 2000)); // be polite to archive.org
    }
    await db.from("sources").upsert(
      {
        incident_id: seed.id, url: s.url, title: s.title ?? null,
        publisher: s.publisher ?? null, published_date: s.published_date ?? null,
        ...(archive_url ? { archive_url } : {}),
      },
      { onConflict: "incident_id,url" }
    );
  }

  // queue conflicts / inclusion concerns for human review
  const reasons = [];
  if (conflictFields.length) reasons.push({ reason: "field_disagreement", payload: { fields: conflictFields, confidence } });
  if (rec.inclusion_concern) reasons.push({ reason: "not_a_lawsuit", payload: { concern: rec.inclusion_concern } });
  for (const r of reasons) {
    await db.from("review_queue").insert({ incident_id: seed.id, ...r });
    conflicts++;
  }

  console.log(
    `row ${key}: applied — ${rec.agency} — ${rec.outcome_status}` +
    (conflictFields.length ? ` — CONFLICTS: ${conflictFields.join(",")}` : "") +
    (rec.inclusion_concern ? " — INCLUSION CONCERN" : "")
  );
  applied++;
}

console.log(`\ndone: ${applied} applied, ${skipped} skipped, ${conflicts} review-queue items`);
