"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseService } from "@/lib/supabase";

async function setStatus(slug: string, status: "published" | "needs_review" | "excluded") {
  const db = supabaseService();
  const { data: incident } = await db
    .from("incidents").select("id, status").eq("slug", slug).single();
  if (!incident) throw new Error("not found");
  const { error } = await db
    .from("incidents")
    .update({ status, last_verified: new Date().toISOString().slice(0, 10) })
    .eq("id", incident.id);
  if (error) throw new Error(error.message);
  await db.from("revisions").insert({
    incident_id: incident.id,
    field: "status",
    old_value: incident.status,
    new_value: status,
    changed_by: "admin",
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/${slug}`);
  revalidatePath(`/case/${slug}`);
  revalidatePath("/");
}

export async function publishIncident(formData: FormData) {
  const slug = String(formData.get("slug"));
  await setStatus(slug, "published");
  const next = String(formData.get("next") ?? "");
  redirect(next === "detail" ? `/admin/${slug}?saved=1` : "/admin");
}

export async function excludeIncident(formData: FormData) {
  const slug = String(formData.get("slug"));
  await setStatus(slug, "excluded");
  redirect("/admin");
}

export async function resolveQueueItem(formData: FormData) {
  const id = String(formData.get("queue_id"));
  const slug = String(formData.get("slug"));
  const db = supabaseService();
  await db.from("review_queue")
    .update({ resolved_at: new Date().toISOString(), resolved_by: "admin", resolution: "reviewed" })
    .eq("id", id);
  revalidatePath(`/admin/${slug}`);
  redirect(`/admin/${slug}`);
}
