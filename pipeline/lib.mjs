import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const TODAY = new Date().toISOString().slice(0, 10);
export const MODEL = process.env.PIPELINE_MODEL || "claude-opus-4-8";

let _db = null;
export const db = new Proxy({}, {
  get(_, prop) {
    _db ??= createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
    return _db[prop];
  },
});

let _anthropic = null;
const anthropic = new Proxy({}, {
  get(_, prop) {
    _anthropic ??= new Anthropic();
    const v = _anthropic[prop];
    return typeof v === "function" ? v.bind(_anthropic) : v;
  },
});

/**
 * Call Claude and return the final text. Handles pause_turn (server tools),
 * refusal stop reason, and retries on transient errors.
 */
export async function claude({ system, prompt, tools = [], maxTokens = 8000 }) {
  let messages = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < 8; turn++) {
    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        system,
        tools,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
        await sleep(30000);
        continue;
      }
      throw err;
    }
    if (response.stop_reason === "pause_turn") {
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }
    if (response.stop_reason === "refusal") {
      throw new Error("model refused the request");
    }
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  throw new Error("too many pause_turn continuations");
}

/** Extract the first JSON object/array from model text output. */
export function extractJson(text) {
  const start = Math.min(
    ...["{", "["].map((c) => {
      const i = text.indexOf(c);
      return i === -1 ? Infinity : i;
    })
  );
  if (!Number.isFinite(start)) throw new Error("no JSON in output");
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  return JSON.parse(text.slice(start, end + 1));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- archive.org ----------
export async function archiveUrl(url) {
  try {
    const r = await fetch(
      `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const j = await r.json();
    const snap = j?.archived_snapshots?.closest;
    if (snap?.available && snap.url) return snap.url.replace(/^http:/, "https:");
  } catch {}
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

// ---------- field agreement (same logic as scripts/apply_enrichment.mjs) ----------
export const AUDITED = [
  "agency", "agency_category", "country", "state_province", "lawsuit_type",
  "year_filed", "outcome_status", "settlement_amount_original", "criminal_status",
];

export function norm(field, v) {
  if (v == null || v === "") return null;
  if (field === "agency")
    return String(v).toLowerCase().replace(/['’.]/g, "").replace(/\s+/g, " ")
      .replace(/\b(the|of)\b/g, "").trim();
  if (field === "settlement_amount_original") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (field === "year_filed") return Number(v) || null;
  return String(v).toLowerCase().trim();
}

export function agreement(field, ext, v1, v2) {
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

// ---------- 30x30 deterministic matcher ----------
export async function match30x30(agencyName, state) {
  if (!agencyName || !state) return { match: null, note: "insufficient data for 30x30 match" };
  const { data } = await db.from("agencies_30x30").select("name, state_province");
  const n = norm("agency", agencyName);
  if ((data ?? []).some((a) => a.state_province === state && norm("agency", a.name) === n))
    return { match: true, note: null };
  const other = (data ?? []).filter((a) => a.state_province !== state && norm("agency", a.name) === n);
  if (other.length)
    return { match: false, note: `30x30 list has same-named agency in ${other.map((a) => a.state_province).join(", ")}; conservative same-state rule → No` };
  return { match: false, note: null };
}

export function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}
