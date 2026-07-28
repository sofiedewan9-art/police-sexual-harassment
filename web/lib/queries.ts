import { supabasePublic } from "./supabase";
import type { Incident } from "./types";

export type Filters = {
  q?: string;
  state?: string;
  country?: string;
  year?: string;
  type?: string;
  category?: string;
  outcome?: string;
  x30?: string; // "yes" | "no"
  amin?: string;
  amax?: string;
  sort?: string;
  dir?: string;
};

const SORTABLE = new Set([
  "agency",
  "year_filed",
  "state_province",
  "outcome_status",
  "settlement_amount",
  "last_verified",
]);

/* eslint-disable @typescript-eslint/no-explicit-any */
export function applyFilters(query: any, f: Filters): any {
  let q = query;
  if (f.q) q = q.textSearch("search_vector", f.q, { type: "websearch", config: "english" });
  if (f.state) q = q.eq("state_province", f.state);
  if (f.country) q = q.eq("country", f.country);
  if (f.year) q = q.eq("year_filed", Number(f.year));
  if (f.type) q = q.eq("lawsuit_type", f.type);
  if (f.category) q = q.eq("agency_category", f.category);
  if (f.outcome) q = q.eq("outcome_status", f.outcome);
  if (f.x30 === "yes") q = q.eq("is_30x30", true);
  if (f.x30 === "no") q = q.eq("is_30x30", false);
  if (f.amin) q = q.gte("settlement_amount", Number(f.amin));
  if (f.amax) q = q.lte("settlement_amount", Number(f.amax));
  return q;
}

export async function fetchIncidents(f: Filters): Promise<Incident[]> {
  const db = supabasePublic();
  let query = applyFilters(db.from("incidents").select("*"), f);
  const sort = f.sort && SORTABLE.has(f.sort) ? f.sort : "year_filed";
  query = query.order(sort, { ascending: f.dir === "asc", nullsFirst: false }).limit(500);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Incident[];
}

export async function fetchFacets() {
  const db = supabasePublic();
  const { data } = await db
    .from("incidents")
    .select("state_province, year_filed, lawsuit_type, agency_category, outcome_status")
    .limit(1000);
  const rows = (data ?? []) as Record<string, unknown>[];
  const uniq = (k: string) => [...new Set(rows.map((r) => r[k]).filter((v) => v != null))];
  return {
    states: (uniq("state_province") as string[]).sort(),
    years: (uniq("year_filed") as number[]).sort((a, b) => b - a),
    types: uniq("lawsuit_type") as string[],
    categories: uniq("agency_category") as string[],
    outcomes: uniq("outcome_status") as string[],
  };
}
