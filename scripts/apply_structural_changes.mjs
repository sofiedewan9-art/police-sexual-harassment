#!/usr/bin/env node
/**
 * Structural data changes (2026-07-28):
 *   node scripts/apply_structural_changes.mjs window   -> exclude suits filed before 2020
 *   node scripts/apply_structural_changes.mjs repeat   -> compute repeat_offender + academy type
 *                                                         (requires migration 0002 applied)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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
const mode = process.argv[2];

async function logRevision(incident_id, field, old_value, new_value) {
  await db.from("revisions").insert({
    incident_id, field,
    old_value: old_value == null ? null : String(old_value),
    new_value: new_value == null ? null : String(new_value),
    changed_by: "structural-change:2026-07-28",
  });
}

if (mode === "window") {
  const { data } = await db.from("incidents")
    .select("id, slug, agency, year_filed, filing_year_range, notes, status")
    .lt("year_filed", 2020).neq("status", "excluded");
  for (const r of data ?? []) {
    const rangeNote = r.filing_year_range
      ? ` Filing range ${r.filing_year_range} may extend into the window — review.` : "";
    const note = `Outside time window: filed ${r.year_filed}; database covers suits filed 2020-present.${rangeNote}`;
    await db.from("incidents").update({
      status: "excluded",
      notes: [r.notes, note].filter(Boolean).join(" "),
    }).eq("id", r.id);
    await logRevision(r.id, "status", r.status, "excluded (time window)");
    console.log(`excluded: ${r.agency} [${r.slug}] filed ${r.year_filed}${r.filing_year_range ? ` (range ${r.filing_year_range})` : ""}`);
  }
  console.log(`\n${(data ?? []).length} records excluded for time window`);
}

if (mode === "repeat") {
  const { data: all, error } = await db.from("incidents")
    .select("id, slug, agency, officer_names, repeat_offender, lawsuit_type, description, criminal_detail, notes, outcome_detail")
    .neq("status", "excluded");
  if (error) throw error;

  // officers appearing in 2+ records
  const nameCount = new Map();
  for (const r of all) {
    for (const n of r.officer_names ?? []) {
      const k = n.toLowerCase().trim();
      nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }
  }
  const REPEAT_TEXT = /(prior complaint|previous (complaint|allegation|lawsuit)|earlier (complaint|allegation)|other (victims|women|accusers)|multiple (victims|women|accusers)|repeat(ed)? (offense|offender|misconduct)|history of (sexual|misconduct|predatory)|second (woman|lawsuit|accuser)|had been accused before|prior (allegations|misconduct|discipline))/i;

  let flagged = 0;
  for (const r of all) {
    const byName = (r.officer_names ?? []).some((n) => nameCount.get(n.toLowerCase().trim()) >= 2);
    const text = [r.description, r.criminal_detail, r.outcome_detail, r.notes].filter(Boolean).join(" ");
    const byText = REPEAT_TEXT.test(text);
    const repeat = byName || byText;
    if (repeat !== Boolean(r.repeat_offender)) {
      await db.from("incidents").update({ repeat_offender: repeat }).eq("id", r.id);
      await logRevision(r.id, "repeat_offender", r.repeat_offender, `${repeat} (${byName ? "officer in 2+ records" : "sources describe repeat conduct"})`);
      if (repeat) { flagged++; console.log(`repeat: ${r.agency} [${r.slug}] — ${byName ? "officer in 2+ records" : "text indicator"}`); }
    }
  }
  console.log(`\n${flagged} records marked repeat_offender=yes`);

  // academy reclassification: internal suits arising in academies/training settings
  const ACADEMY = /(police academy|training academy|training commission|cjtc|academy instructor|recruit|cadet)/i;
  for (const r of all) {
    if (r.lawsuit_type === "internal" && ACADEMY.test([r.agency, r.description].filter(Boolean).join(" "))) {
      await db.from("incidents").update({ lawsuit_type: "internal_academy" }).eq("id", r.id);
      await logRevision(r.id, "lawsuit_type", "internal", "internal_academy");
      console.log(`academy: ${r.agency} [${r.slug}]`);
    }
  }
}
