"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseService } from "@/lib/supabase";

const FIELDS = [
  "agency", "agency_category", "country", "state_province", "lawsuit_type",
  "year_filed", "filing_year_range", "outcome_status", "outcome_detail",
  "settlement_amount", "settlement_currency", "settlement_date",
  "criminal_status", "criminal_detail", "is_30x30",
  "thirty_by_thirty_match_note", "description", "notes", "status",
  "last_verified",
] as const;

const NUMERIC = new Set(["year_filed", "settlement_amount"]);
const BOOLEAN = new Set(["is_30x30"]);

function parseValue(field: string, raw: string): unknown {
  if (raw === "") return null;
  if (NUMERIC.has(field)) return Number(raw);
  if (BOOLEAN.has(field)) return raw === "true" ? true : raw === "false" ? false : null;
  return raw;
}

export async function saveIncident(formData: FormData) {
  const slug = String(formData.get("slug"));
  const db = supabaseService();
  const { data: current, error: fetchErr } = await db
    .from("incidents").select("*").eq("slug", slug).single();
  if (fetchErr || !current) throw new Error(fetchErr?.message ?? "not found");

  const updates: Record<string, unknown> = {};
  const revisions: { field: string; old_value: string | null; new_value: string | null }[] = [];
  for (const field of FIELDS) {
    if (!formData.has(field)) continue;
    const next = parseValue(field, String(formData.get(field)).trim());
    const prev = current[field] ?? null;
    if (String(prev ?? "") !== String(next ?? "")) {
      updates[field] = next;
      revisions.push({
        field,
        old_value: prev == null ? null : String(prev),
        new_value: next == null ? null : String(next),
      });
    }
  }

  if (formData.get("checkboxes_present")) {
    for (const b of ["year_filed_approx", "multiple_filings"]) {
      const next = formData.get(b) === "on";
      if (Boolean(current[b]) !== next) {
        updates[b] = next;
        revisions.push({ field: b, old_value: String(current[b]), new_value: String(next) });
      }
    }
  }

  if (Object.keys(updates).length) {
    const { error } = await db.from("incidents").update(updates).eq("id", current.id);
    if (error) throw new Error(error.message);
    await db.from("revisions").insert(
      revisions.map((r) => ({ ...r, incident_id: current.id, changed_by: "admin" }))
    );
  }

  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/case/${slug}`);
  revalidatePath("/admin");
  redirect(`/admin/${slug}?saved=1`);
}

export async function addSource(formData: FormData) {
  const slug = String(formData.get("slug"));
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return;
  const db = supabaseService();
  const { data: incident } = await db.from("incidents").select("id").eq("slug", slug).single();
  if (!incident) return;
  await db.from("sources").upsert(
    {
      incident_id: incident.id,
      url,
      title: String(formData.get("title") ?? "").trim() || null,
      archive_url: String(formData.get("archive_url") ?? "").trim() || null,
    },
    { onConflict: "incident_id,url" }
  );
  revalidatePath(`/admin/${slug}`);
  redirect(`/admin/${slug}`);
}
