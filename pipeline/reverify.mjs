/**
 * Monthly re-verification: re-check unresolved outcomes (ongoing /
 * no_resolution_found) via CourtListener dockets + news search, refresh
 * last_verified, retry missing archive.org snapshots, flag dead links.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 * Flags: --limit N (default 20)
 */
import { db, claude, extractJson, sleep, archiveUrl, TODAY } from "./lib.mjs";

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 20;
const RUN_ID = `reverify:${TODAY}`;

async function courtListener(query) {
  try {
    const r = await fetch(
      `https://www.courtlistener.com/api/rest/v4/search/?type=r&q=${encodeURIComponent(query)}&order_by=dateFiled%20desc`,
      { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "policing-project-lawsuits-db/1.0" } }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results ?? []).slice(0, 5).map((d) => ({
      caseName: d.caseName, court: d.court, dateFiled: d.dateFiled,
      docketNumber: d.docketNumber,
      url: d.docket_absolute_url ? `https://www.courtlistener.com${d.docket_absolute_url}` : null,
    }));
  } catch {
    return [];
  }
}

const { data: records } = await db
  .from("incidents")
  .select("id, slug, agency, state_province, year_filed, officer_names, outcome_status, outcome_detail, last_verified")
  .in("outcome_status", ["ongoing", "no_resolution_found"])
  .neq("status", "excluded")
  .order("last_verified", { ascending: true, nullsFirst: true })
  .limit(LIMIT);

console.log(`${RUN_ID}: re-checking ${(records ?? []).length} unresolved records`);

for (const r of records ?? []) {
  const officer = (r.officer_names ?? [])[0] ?? "";
  const dockets = await courtListener(`"${officer || r.agency}" sexual harassment`);
  const docketText = dockets.length
    ? dockets.map((d) => `- ${d.caseName} (${d.court}, filed ${d.dateFiled}, ${d.docketNumber}) ${d.url ?? ""}`).join("\n")
    : "(no matching federal dockets found on CourtListener)";

  try {
    const out = await claude({
      maxTokens: 4000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      system: `Today is ${TODAY}. You verify the current status of a civil lawsuit. Be strict: report a change only if a source confirms it. End with ONLY JSON.`,
      prompt: `Record: ${r.agency} (${r.state_province}), lawsuit filed ${r.year_filed ?? "?"}, officer(s): ${(r.officer_names ?? []).join(", ") || "unknown"}.
Current status: ${r.outcome_status}. Detail: ${r.outcome_detail ?? "-"}

Federal docket search results (CourtListener RECAP):
${docketText}

Search the web for the CURRENT status of this specific suit (settlement, verdict, dismissal, or confirmation it remains active). Return:
{"changed": <bool>, "outcome_status": "settled|plaintiff_verdict|defense_verdict|dismissed|ongoing|no_resolution_found", "outcome_detail": "<amount/date/grounds or ''>", "settlement_amount_original": <number|null>, "settlement_date": <"YYYY-MM-DD"|null>, "source_url": <string|null>, "source_title": <string|null>, "explanation": "<short>"}
Set changed=true ONLY if the status genuinely differs from the current one and a source supports it.`,
    });
    const v = extractJson(out);
    if (v.changed && v.outcome_status && v.source_url) {
      await db.from("incidents").update({
        outcome_status: v.outcome_status,
        outcome_detail: v.outcome_detail || r.outcome_detail,
        settlement_amount_original: v.settlement_amount_original ?? undefined,
        settlement_amount: v.settlement_amount_original ?? undefined,
        settlement_date: v.settlement_date ?? undefined,
        last_verified: TODAY,
      }).eq("id", r.id);
      const archive_url = await archiveUrl(v.source_url);
      await db.from("sources").upsert(
        { incident_id: r.id, url: v.source_url, title: v.source_title ?? null, ...(archive_url ? { archive_url } : {}) },
        { onConflict: "incident_id,url", ignoreDuplicates: true }
      );
      await db.from("revisions").insert({
        incident_id: r.id, field: "outcome_status",
        old_value: r.outcome_status, new_value: v.outcome_status, changed_by: RUN_ID,
      });
      await db.from("review_queue").insert({
        incident_id: r.id, reason: "field_disagreement",
        payload: { pipeline: RUN_ID, change: "outcome updated by re-verification", explanation: v.explanation, source: v.source_url },
      });
      console.log(`UPDATED ${r.slug}: ${r.outcome_status} -> ${v.outcome_status} (${v.explanation})`);
    } else {
      await db.from("incidents").update({ last_verified: TODAY }).eq("id", r.id);
      console.log(`unchanged ${r.slug} (${v.explanation ?? "no new info"})`);
    }
  } catch (e) {
    console.log(`FAILED ${r.slug}: ${e.message}`);
  }
  await sleep(2000);
}

// retry missing archive snapshots (cap 20/run)
const { data: unarchived } = await db.from("sources")
  .select("id, url").is("archive_url", null).limit(20);
let archived = 0;
for (const s of unarchived ?? []) {
  const a = await archiveUrl(s.url);
  if (a) { await db.from("sources").update({ archive_url: a }).eq("id", s.id); archived++; }
  await sleep(3000);
}
console.log(`archive retries: ${archived}/${(unarchived ?? []).length} captured`);
console.log("reverify done");
