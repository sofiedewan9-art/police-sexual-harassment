/**
 * Weekly ingestion: discover news of new police sexual-harassment lawsuits,
 * screen + dedup, research each new case (Claude + web search), verify twice
 * (blind), and insert as needs_review.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 * Flags: --discover-only (no AI, no writes) · --dry-run (AI screen, no writes)
 *        --max-new N (default 8)
 */
import {
  db, claude, extractJson, sleep, archiveUrl, AUDITED, agreement,
  match30x30, slugify, TODAY,
} from "./lib.mjs";

const args = process.argv.slice(2);
const DISCOVER_ONLY = args.includes("--discover-only");
const DRY_RUN = args.includes("--dry-run");
const MAX_NEW = args.includes("--max-new") ? Number(args[args.indexOf("--max-new") + 1]) : 8;
const RUN_ID = `pipeline:${TODAY}`;

const QUERIES = [
  '"police officer" lawsuit "sexual harassment"',
  '"police officer" lawsuit "sexual assault" sued',
  'deputy sued "sexual harassment" sheriff',
  'trooper lawsuit "sexual harassment"',
  '"corrections officer" lawsuit "sexual harassment" filed',
  'officer sues department "sexual harassment"',
  '"police department" "sexual harassment" lawsuit filed',
  'police "sexual harassment" EEOC complaint officer',
  'police service civil claim "sexual harassment" Canada',
  '"police academy" recruit "sexual harassment" lawsuit',
];

// ---------- discovery ----------
function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<!\[CDATA\[|\]\]>/g, "");
}

async function googleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:14d")}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).text();
    const items = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const title = decodeEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const link = decodeEntities(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
      const pub = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null;
      const source = decodeEntities(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
      if (title && link) items.push({ title, url: link, published: pub, publisher: source });
    }
    return items.slice(0, 25);
  } catch (e) {
    console.log(`  google news failed for "${query}": ${e.message}`);
    return [];
  }
}

// GDELT rejects queries with multiple quoted phrases — it gets its own simple set
const GDELT_QUERIES = [
  'police lawsuit "sexual harassment"',
  'sheriff deputy sued "sexual assault"',
  'police officer lawsuit "sexual misconduct"',
];

async function gdelt(query) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=25&timespan=2w&format=json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    return (j.articles ?? []).map((a) => ({
      title: a.title, url: a.url, published: a.seendate, publisher: a.domain,
    }));
  } catch (e) {
    console.log(`  gdelt failed for "${query}": ${e.message}`);
    return [];
  }
}

async function discover() {
  const byUrl = new Map();
  const byTitle = new Set();
  const add = (results) => {
    for (const r of results) {
      const titleKey = r.title.toLowerCase().replace(/\W+/g, " ").trim().slice(0, 80);
      if (byUrl.has(r.url) || byTitle.has(titleKey)) continue;
      byUrl.set(r.url, r);
      byTitle.add(titleKey);
    }
  };
  for (const q of QUERIES) {
    add(await googleNews(q));
    await sleep(1500);
  }
  for (const q of GDELT_QUERIES) {
    await sleep(6000); // GDELT rate limit: 1 request per 5 seconds
    add(await gdelt(q));
  }
  return [...byUrl.values()];
}

// ---------- main ----------
console.log(`ingest run ${RUN_ID} — discovering…`);
let candidates = await discover();
console.log(`discovered ${candidates.length} unique articles`);

if (DISCOVER_ONLY) {
  for (const c of candidates.slice(0, 40)) console.log(`- [${c.publisher}] ${c.title.slice(0, 110)}`);
  process.exit(0);
}

// drop already-seen URLs
{
  const { data: seen, error: seenErr } = await db.from("pipeline_seen").select("url");
  if (seenErr) console.log(`WARNING: pipeline_seen unavailable (${seenErr.message}) — run migration 0003; continuing without cross-run dedup`);
  const seenSet = new Set((seen ?? []).map((s) => s.url));
  const { data: src } = await db.from("sources").select("url");
  for (const s of src ?? []) seenSet.add(s.url);
  candidates = candidates.filter((c) => !seenSet.has(c.url));
}
console.log(`${candidates.length} not previously processed`);
if (!candidates.length) process.exit(0);

// compact index of existing records for dedup
const { data: existing } = await db
  .from("incidents")
  .select("slug, agency, state_province, year_filed, officer_names")
  .neq("status", "excluded").limit(1000);
const index = (existing ?? [])
  .map((r) => `${r.slug} | ${r.agency} | ${r.state_province ?? "?"} | ${r.year_filed ?? "?"} | ${(r.officer_names ?? []).join(",") || "-"}`)
  .join("\n");

// ---------- screen + dedup (one call per 30 candidates) ----------
const screened = [];
for (let i = 0; i < candidates.length; i += 30) {
  const batch = candidates.slice(i, i + 30);
  const list = batch.map((c, j) => `${j}: [${c.publisher}] ${c.title}`).join("\n");
  const out = await claude({
    system: "You screen news headlines for a database of civil lawsuits involving sexual harassment and law-enforcement agencies (US/Canada). Respond with ONLY JSON.",
    prompt: `Inclusion criteria: an actual filed civil lawsuit or formal claim (notice of claim, EEOC/human-rights complaint) where sexual harassment/assault is central; agency is law enforcement (police, sheriff, state police, corrections, juvenile, federal, campus, transit); US or Canada; filed 2020 or later. Criminal charges alone do NOT qualify.

EXISTING DATABASE RECORDS (slug | agency | state | year | officers):
${index}

CANDIDATE HEADLINES:
${list}

For each candidate return: {"i": <index>, "verdict": "exclude"|"duplicate"|"candidate", "slug": "<existing slug if duplicate, else null>", "reason": "<short>"}
"duplicate" = clearly the same lawsuit as an existing record. "candidate" = plausibly a new qualifying lawsuit worth researching. When unsure between exclude and candidate, choose candidate.
Return ONLY a JSON array.`,
  });
  try {
    for (const v of extractJson(out)) {
      const c = batch[v.i];
      if (c) screened.push({ ...c, verdict: v.verdict, dupSlug: v.slug, reason: v.reason });
    }
  } catch (e) {
    console.log(`screen batch parse failed: ${e.message}`);
  }
}

const summary = { exclude: 0, duplicate: 0, candidate: 0 };
for (const s of screened) summary[s.verdict] = (summary[s.verdict] ?? 0) + 1;
console.log(`screened: ${JSON.stringify(summary)}`);

if (DRY_RUN) {
  for (const s of screened.filter((x) => x.verdict !== "exclude"))
    console.log(`- ${s.verdict}${s.dupSlug ? ` of ${s.dupSlug}` : ""}: ${s.title.slice(0, 100)} (${s.reason})`);
  process.exit(0);
}

async function markSeen(c, disposition, detail) {
  await db.from("pipeline_seen").upsert({ url: c.url, title: c.title, disposition, detail });
}

// excluded → record; duplicates → attach as new source
for (const s of screened) {
  if (s.verdict === "exclude") await markSeen(s, "excluded", s.reason);
  if (s.verdict === "duplicate" && s.dupSlug) {
    const { data: inc } = await db.from("incidents").select("id").eq("slug", s.dupSlug).maybeSingle();
    if (inc) {
      const archive_url = await archiveUrl(s.url);
      await db.from("sources").upsert(
        { incident_id: inc.id, url: s.url, title: s.title, publisher: s.publisher, ...(archive_url ? { archive_url } : {}) },
        { onConflict: "incident_id,url", ignoreDuplicates: true }
      );
      await markSeen(s, "duplicate", s.dupSlug);
      console.log(`attached new source to ${s.dupSlug}`);
    }
  }
}

// ---------- research + verify + insert new candidates ----------
const RECORD_SCHEMA = `{
  "include": <bool — false if research shows no qualifying suit (not filed, sexual harassment not central, outside US/CA, filed before 2020)>,
  "exclude_reason": <string|null>,
  "agency": "<official agency name>",
  "agency_category": "police|sheriff|state_police|corrections|juvenile|federal|campus|transit|other",
  "country": "US|CA", "state_province": "<2-letter>",
  "lawsuit_type": "civilian|internal|internal_academy|class_action",
  "year_filed": <int|null>, "year_filed_approx": <bool>,
  "outcome_status": "settled|plaintiff_verdict|defense_verdict|dismissed|ongoing|no_resolution_found",
  "outcome_detail": "<amount, date, grounds — or ''>",
  "settlement_amount_original": <number|null>, "settlement_currency": "USD|CAD",
  "settlement_date": <"YYYY-MM-DD"|null>,
  "criminal_status": "none_filed|charged|convicted|pleaded_guilty|acquitted|charges_dropped|unknown",
  "criminal_detail": "<string or ''>",
  "officer_names": ["<accused officers named in public reporting>"],
  "incident_date_approx": "<free text>",
  "description": "<3-6 sentences. Attribute every unproven claim ('the suit alleges…'). State conduct as fact ONLY with a conviction, guilty plea, admission, or jury finding. NEVER name victims. No editorializing.>",
  "notes": <string|null>,
  "sources": [{"url":"...","title":"...","publisher":"...","published_date":<"YYYY-MM-DD"|null>}],
  "confidence_notes": "<string>"
}`;

const kept = screened.filter((s) => s.verdict === "candidate").slice(0, MAX_NEW);
const skipped = screened.filter((s) => s.verdict === "candidate").length - kept.length;
if (skipped > 0) console.log(`capped: ${skipped} candidates deferred to next run (--max-new ${MAX_NEW})`);

let inserted = 0;
for (const c of kept) {
  console.log(`researching: ${c.title.slice(0, 90)}`);
  try {
    const out = await claude({
      maxTokens: 12000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      system: "You research civil lawsuits involving sexual harassment and law-enforcement agencies for a public database. Today is " + TODAY + ". End your reply with ONLY the JSON record.",
      prompt: `Research this news item and produce a complete lawsuit record.

Headline: ${c.title} (${c.publisher})
URL: ${c.url}

Steps: (1) find the article and related coverage via web search; (2) run a DEDICATED outcome search (settled/verdict/dismissed/active — never assume from filing coverage); (3) search for any criminal case against the accused officer(s); (4) confirm the inclusion criteria: actual filed civil suit or formal claim, sexual harassment/assault central, US/Canada, filed 2020+.
One record per lawsuit: if the coverage bundles several distinct suits, produce the record for the PRIMARY suit only and note the others in confidence_notes.

Output JSON schema:
${RECORD_SCHEMA}`,
    });
    const rec = extractJson(out);
    if (!rec.include) {
      await markSeen(c, "excluded", rec.exclude_reason ?? "post-research exclusion");
      console.log(`  excluded after research: ${rec.exclude_reason}`);
      continue;
    }

    // two blind verifications from sources only
    const urls = (rec.sources ?? []).map((s) => s.url).filter(Boolean);
    const verifyPrompt = (n) => claude({
      maxTokens: 4000,
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 }],
      system: `You are independent verifier #${n}. Derive fields ONLY from the listed sources (fetch them; skip failures; do not search elsewhere). Use null when sources don't establish a value. Respond with ONLY JSON.`,
      prompt: `Sources:\n${urls.join("\n")}\n\nReturn: {"agency": "...", "agency_category": "police|sheriff|state_police|corrections|juvenile|federal|campus|transit|other", "country": "US|CA", "state_province": "..", "lawsuit_type": "civilian|internal|internal_academy|class_action", "year_filed": <int|null>, "outcome_status": "settled|plaintiff_verdict|defense_verdict|dismissed|ongoing|no_resolution_found", "settlement_amount_original": <number|null>, "criminal_status": "none_filed|charged|convicted|pleaded_guilty|acquitted|charges_dropped|unknown"}`,
    }).then(extractJson).catch((e) => { console.log(`  verifier ${n} failed: ${e.message}`); return null; });

    const [v1, v2] = [await verifyPrompt(1), await verifyPrompt(2)];
    const confidence = {};
    const conflicts = [];
    if (v1 && v2) {
      for (const f of AUDITED) {
        if (f === "agency_category") continue; // computed below with the rest
        const verdict = agreement(f, rec[f], v1[f], v2[f]);
        confidence[f] = verdict;
        if (verdict !== "3way" && verdict !== "2way") conflicts.push(f);
      }
      confidence.agency_category = agreement("agency_category", rec.agency_category, v1.agency_category, v2.agency_category);
      if (!["3way", "2way"].includes(confidence.agency_category)) conflicts.push("agency_category");
    } else {
      confidence.unverified = true;
      conflicts.push("verification_incomplete");
    }

    const m30 = await match30x30(rec.agency, rec.state_province);
    let slug = slugify(`${rec.agency} ${rec.year_filed ?? ""} p${TODAY.replace(/-/g, "")}`);
    const { data: slugTaken } = await db.from("incidents").select("id").eq("slug", slug).maybeSingle();
    if (slugTaken) slug += "-b";

    const settlementUsd = rec.settlement_amount_original != null && rec.settlement_currency === "CAD"
      ? Math.round(rec.settlement_amount_original * 0.73)
      : rec.settlement_amount_original;

    const { data: created, error } = await db.from("incidents").insert({
      slug,
      agency: rec.agency,
      agency_category: rec.agency_category,
      country: rec.country,
      state_province: rec.state_province,
      lawsuit_type: rec.lawsuit_type,
      year_filed: rec.year_filed,
      year_filed_approx: Boolean(rec.year_filed_approx),
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
      notes: [rec.notes, m30.note ? `30x30: ${m30.note}` : null].filter(Boolean).join(" ") || null,
      is_30x30: m30.match,
      thirty_by_thirty_match_note: m30.note,
      confidence,
      last_verified: TODAY,
      status: "needs_review",
    }).select("id").single();
    if (error) throw new Error(error.message);

    for (const s of rec.sources ?? []) {
      if (!s.url) continue;
      const archive_url = await archiveUrl(s.url);
      await db.from("sources").upsert(
        { incident_id: created.id, url: s.url, title: s.title ?? null, publisher: s.publisher ?? null, published_date: s.published_date ?? null, ...(archive_url ? { archive_url } : {}) },
        { onConflict: "incident_id,url", ignoreDuplicates: true }
      );
      await sleep(1500);
    }

    await db.from("review_queue").insert({
      incident_id: created.id,
      reason: conflicts.length ? "field_disagreement" : "low_confidence",
      payload: { pipeline: RUN_ID, conflicts, confidence, headline: c.title },
    });
    await db.from("revisions").insert({
      incident_id: created.id, field: "created", old_value: null,
      new_value: `pipeline ingest from ${c.url}`, changed_by: RUN_ID,
    });
    await markSeen(c, "inserted", slug);
    inserted++;
    console.log(`  inserted ${slug}${conflicts.length ? ` (conflicts: ${conflicts.join(",")})` : ""}`);
  } catch (e) {
    console.log(`  FAILED: ${e.message}`);
    await markSeen(c, "error", e.message.slice(0, 200));
  }
}

console.log(`\ndone: ${inserted} new records inserted (needs_review), ${summary.duplicate} sources attached, ${summary.exclude} excluded`);
