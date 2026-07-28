#!/usr/bin/env node
/**
 * Import seed data into Supabase:
 *   1. data/30x30_agencies_raw.txt  -> agencies_30x30
 *   2. data/seed_staging.json       -> incidents + sources (status: needs_review)
 *
 * Usage:
 *   node scripts/import_seed.mjs --dry-run   # parse + report only, no DB writes
 *   node scripts/import_seed.mjs             # writes to Supabase (needs web/.env.local)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRY = process.argv.includes("--dry-run");

// ---------- state/province normalization ----------
const US_STATES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", "d.c.": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  // typos present in the source list
  connecticu: "CT", lllinois: "IL", "new jeresy": "NJ", ca: "CA",
};
const CA_PROVINCES = {
  ontario: "ON", quebec: "QC", "british columbia": "BC", bc: "BC",
  alberta: "AB", manitoba: "MB", saskatchewan: "SK", "nova scotia": "NS",
  "new brunswick": "NB", "newfoundland and labrador": "NL",
  "prince edward island": "PE", yukon: "YT", "northwest territories": "NT",
  nunavut: "NU",
};

function normState(raw, country) {
  const key = raw.trim().toLowerCase();
  const table = country === "CA" ? CA_PROVINCES : US_STATES;
  return table[key] ?? null;
}

// ---------- 30x30 list parsing ----------
// Lines look like "Adams County Sheriff’s OfficeBrighton, Colorado":
// agency name and city are concatenated with no separator. The name nearly
// always ends in a known token; fall back to the last lowercase->uppercase
// boundary otherwise.
const NAME_END_TOKENS = [
  "Department", "Office", "Service", "Police", "Patrol", "Bureau",
  "Division", "Command", "Safety", "PD", "Sheriff", "Administration",
  "Center", "College", "Protection", "Enforcement", "Revenue", "Wildlife",
  "Corrections", "Control", "Explosives \\(ATF\\)", "\\(FBI\\)",
  "\\(SSA OIG\\)", "Abuse", "Rehabilitation", "the",
];
const TOKEN_SPLIT = new RegExp(
  `^(.*(?:${NAME_END_TOKENS.join("|")}))((?:The )?[A-ZÀ-Þ].*)$`
);

function splitNameCity(head) {
  const m = head.match(TOKEN_SPLIT);
  if (m) return { name: m[1].trim(), city: m[2].trim(), how: "token" };
  // fallback: last aZ boundary, e.g. "...SUNY BrockportBrockport"
  let idx = -1;
  for (let i = 1; i < head.length; i++) {
    if (/[a-zà-þ)]/.test(head[i - 1]) && /[A-ZÀ-Þ]/.test(head[i])) idx = i;
  }
  if (idx > 0)
    return { name: head.slice(0, idx).trim(), city: head.slice(idx).trim(), how: "boundary" };
  return { name: head.trim(), city: null, how: "unsplit" };
}

function parse30x30() {
  const lines = readFileSync(path.join(ROOT, "data/30x30_agencies_raw.txt"), "utf8")
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const agencies = [];
  const problems = [];
  for (const line of lines) {
    const parts = line.split(",").map((p) => p.trim());
    let country, stateRaw, head;
    if (parts[parts.length - 1] === "Canada") {
      country = "CA";
      if (parts.length >= 3) {
        stateRaw = parts[parts.length - 2];
        head = parts.slice(0, -2).join(", ");
      } else {
        // e.g. "Belleville Police ServiceOntario, Canada" (province fused)
        const s = splitNameCity(parts[0]);
        agencies.push({ name: s.name, city: null,
          state_province: normState(s.city ?? "", "CA"), country, line });
        if (!normState(s.city ?? "", "CA")) problems.push({ line, why: "province" });
        continue;
      }
    } else {
      country = "US";
      stateRaw = parts[parts.length - 1];
      head = parts.slice(0, -1).join(", ");
    }
    const state = normState(stateRaw, country);
    const { name, city, how } = splitNameCity(head);
    if (!state) problems.push({ line, why: `state "${stateRaw}"` });
    if (!city || how === "unsplit") problems.push({ line, why: "name/city split" });
    agencies.push({ name, city, state_province: state, country, line, how });
  }
  return { agencies, problems };
}

// ---------- seed records ----------
function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}

function buildIncidents() {
  const staging = JSON.parse(
    readFileSync(path.join(ROOT, "data/seed_staging.json"), "utf8"));
  const seen = new Set();
  return staging.map((r) => {
    const countryRaw = (r.country_raw ?? "").toUpperCase();
    const country = countryRaw === "US" ? "US"
      : countryRaw === "CANADA" ? "CA" : null;
    let slug = slugify(
      [r.agency_raw ?? "unknown-agency", r.year_filed ?? "", `r${r.row}`].join(" "));
    while (seen.has(slug)) slug += "-x";
    seen.add(slug);
    const is30 = r.is_30x30_raw == null ? null
      : /^y/i.test(r.is_30x30_raw);
    return {
      incident: {
        slug,
        agency: (r.agency_raw ?? "Unknown (needs research)").trim(),
        country,
        state_province: r.state_raw?.trim() || null,
        year_filed: r.year_filed,
        year_filed_approx: r.year_filed_approx,
        multiple_filings: Boolean(r.filing_year_range),
        filing_year_range: r.filing_year_range,
        outcome_detail: r.result_text,
        settlement_amount: r.dollar_hint,
        is_30x30: is30,
        notes: [
          r.notes_raw,
          countryRaw === "AUS" ? "Out of scope: Australia." : null,
          r.orphan_titles.length
            ? `URLs to recover for: ${r.orphan_titles.join(" | ")}`
            : null,
        ].filter(Boolean).join(" ") || null,
        status: countryRaw === "AUS" ? "excluded" : "needs_review",
      },
      sources: r.sources.filter((s) => s.url),
    };
  });
}

// ---------- main ----------
const { agencies, problems } = parse30x30();
const incidents = buildIncidents();

console.log(`30x30 agencies parsed : ${agencies.length}`);
console.log(`  by country          : US ${agencies.filter(a => a.country === "US").length}, CA ${agencies.filter(a => a.country === "CA").length}`);
console.log(`  split via token     : ${agencies.filter(a => a.how === "token").length}`);
console.log(`  split via boundary  : ${agencies.filter(a => a.how === "boundary").length}`);
console.log(`  problems            : ${problems.length}`);
for (const p of problems) console.log(`    [${p.why}] ${p.line}`);
if (process.env.DEBUG_SPLITS) {
  const show = process.env.DEBUG_SPLITS === "all"
    ? agencies : agencies.filter((a) => a.how !== "token");
  for (const a of show)
    console.log(`  ${a.how}: "${a.name}" | "${a.city}" | ${a.state_province}`);
}
console.log(`incidents to import   : ${incidents.length} (excluded: ${incidents.filter(i => i.incident.status === "excluded").length})`);
console.log(`sources to import     : ${incidents.reduce((n, i) => n + i.sources.length, 0)}`);

if (DRY) {
  console.log("\n--dry-run: no database writes.");
  process.exit(0);
}

// load env from web/.env.local
const envText = readFileSync(path.join(ROOT, "web/.env.local"), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const { createRequire } = await import("node:module");
const requireFromWeb = createRequire(path.join(ROOT, "web/package.json"));
const { createClient } = requireFromWeb("@supabase/supabase-js");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

{
  const rows = agencies.map(({ name, city, state_province, country }) =>
    ({ name, city, state_province, country }));
  const { error } = await db.from("agencies_30x30")
    .upsert(rows, { onConflict: "name,city,state_province", ignoreDuplicates: true });
  if (error) throw new Error(`agencies_30x30: ${error.message}`);
  console.log(`agencies_30x30 upserted: ${rows.length}`);
}

let nInc = 0, nSrc = 0;
for (const { incident, sources } of incidents) {
  const { data, error } = await db.from("incidents")
    .upsert(incident, { onConflict: "slug" }).select("id").single();
  if (error) throw new Error(`incident ${incident.slug}: ${error.message}`);
  nInc++;
  if (sources.length) {
    const { error: e2 } = await db.from("sources").upsert(
      sources.map((s) => ({ incident_id: data.id, url: s.url, title: s.title })),
      { onConflict: "incident_id,url", ignoreDuplicates: true });
    if (e2) throw new Error(`sources ${incident.slug}: ${e2.message}`);
    nSrc += sources.length;
  }
}
console.log(`incidents upserted: ${nInc}, sources upserted: ${nSrc}`);
console.log("Import complete.");
