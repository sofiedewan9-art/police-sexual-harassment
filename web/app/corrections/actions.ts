"use server";

import { supabasePublic, supabaseService } from "@/lib/supabase";

export type CorrectionState = { ok: boolean; message: string } | null;

export async function submitCorrection(
  _prev: CorrectionState,
  formData: FormData
): Promise<CorrectionState> {
  // honeypot: real users never fill this hidden field
  if (formData.get("website")) return { ok: true, message: "Thank you." };

  const message = String(formData.get("message") ?? "").trim();
  if (message.length < 10) {
    return { ok: false, message: "Please describe the issue (at least 10 characters)." };
  }
  if (!String(formData.get("record") ?? "").trim()) {
    return { ok: false, message: "Please identify the record this request concerns." };
  }
  if (!String(formData.get("organization") ?? "").trim()) {
    return { ok: false, message: "Please provide your organization." };
  }

  const slug = String(formData.get("record") ?? "").trim();
  let incident_id: string | null = null;
  if (slug) {
    const { data } = await supabasePublic()
      .from("incidents").select("id").eq("slug", slug).maybeSingle();
    incident_id = data?.id ?? null;
  }

  const { error } = await supabasePublic().from("correction_requests").insert({
    incident_id,
    name: String(formData.get("name") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    organization: String(formData.get("organization") ?? "").trim() || null,
    message: slug && !incident_id ? `[record: ${slug}] ${message}` : message,
  });
  if (error) return { ok: false, message: "Something went wrong — please try again." };

  // also queue it for admin review
  if (incident_id) {
    await supabaseService().from("review_queue").insert({
      incident_id,
      reason: "correction_request",
      payload: { message },
    });
  }
  return {
    ok: true,
    message: "Thank you. Your request has been received and will be reviewed.",
  };
}
