import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseService } from "@/lib/supabase";
import type { Incident, Source } from "@/lib/types";
import {
  OUTCOME_LABELS, TYPE_LABELS, CATEGORY_LABELS, CRIMINAL_LABELS,
} from "@/lib/format";
import { saveIncident, addSource } from "./actions";
import { publishIncident, excludeIncident, resolveQueueItem } from "./reviewActions";

export const dynamic = "force-dynamic";

const input = "mt-1 w-full rounded border border-navy/20 bg-white px-3 py-1.5 text-sm";

function Select({
  name, value, options, allowEmpty = true,
}: {
  name: string;
  value: string | null;
  options: Record<string, string>;
  allowEmpty?: boolean;
}) {
  return (
    <select name={name} defaultValue={value ?? ""} className={input}>
      {allowEmpty && <option value="">—</option>}
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </select>
  );
}

export default async function AdminEdit({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { slug } = await params;
  const { saved } = await searchParams;
  const db = supabaseService();
  const { data: incident } = await db
    .from("incidents").select("*").eq("slug", slug).maybeSingle<Incident>();
  if (!incident) notFound();
  const { data: sources } = (await db
    .from("sources").select("*").eq("incident_id", incident.id)) as { data: Source[] | null };
  const { data: queueItems } = await db
    .from("review_queue").select("id, reason, payload, created_at")
    .eq("incident_id", incident.id).is("resolved_at", null);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-sm text-brand hover:underline">← Queue</Link>
          <h1 className="text-2xl font-semibold">{incident.agency}</h1>
        </div>
        <span className={`rounded px-3 py-1 text-sm font-medium ${
          incident.status === "published" ? "bg-green-100 text-green-900"
          : incident.status === "excluded" ? "bg-gray-200 text-gray-700"
          : "bg-accent/30 text-navy"
        }`}>
          {incident.status.replace("_", " ")}
        </span>
      </div>

      {saved && (
        <p className="rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-900">
          Saved.
        </p>
      )}

      {(queueItems ?? []).length > 0 && (
        <section className="rounded-lg border-l-4 border-accent bg-white p-4">
          <h2 className="text-sm font-semibold text-navy">Open review flags</h2>
          <ul className="mt-2 space-y-2">
            {(queueItems ?? []).map((q) => (
              <li key={q.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <span className="mr-2 rounded bg-accent/30 px-2 py-0.5 text-xs font-medium text-navy">
                    {String(q.reason).replace(/_/g, " ")}
                  </span>
                  <span className="text-ink/80">
                    {q.payload?.concern ?? (q.payload?.fields ? `fields: ${q.payload.fields.join(", ")}` : "")}
                  </span>
                </div>
                <form action={resolveQueueItem}>
                  <input type="hidden" name="queue_id" value={q.id} />
                  <input type="hidden" name="slug" value={incident.slug} />
                  <button className="whitespace-nowrap rounded border border-navy/20 px-2 py-1 text-xs hover:bg-paper">
                    Mark resolved
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-2">
        {incident.status !== "published" && (
          <form action={publishIncident}>
            <input type="hidden" name="slug" value={incident.slug} />
            <input type="hidden" name="next" value="detail" />
            <button className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800">
              Approve &amp; publish
            </button>
          </form>
        )}
        {incident.status !== "excluded" && (
          <form action={excludeIncident}>
            <input type="hidden" name="slug" value={incident.slug} />
            <button className="rounded border border-red-700 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
              Exclude
            </button>
          </form>
        )}
      </div>

      <form action={saveIncident} className="space-y-5 rounded-lg border border-navy/10 bg-white p-6">
        <input type="hidden" name="slug" value={incident.slug} />
        <input type="hidden" name="checkboxes_present" value="1" />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-navy">Agency
            <input name="agency" defaultValue={incident.agency} className={input} />
          </label>
          <label className="text-sm font-medium text-navy">Agency category
            <Select name="agency_category" value={incident.agency_category} options={CATEGORY_LABELS} />
          </label>
          <label className="text-sm font-medium text-navy">Country
            <Select name="country" value={incident.country} options={{ US: "US", CA: "Canada" }} />
          </label>
          <label className="text-sm font-medium text-navy">State / Province
            <input name="state_province" defaultValue={incident.state_province ?? ""} className={input} />
          </label>
          <label className="text-sm font-medium text-navy">Lawsuit type
            <Select name="lawsuit_type" value={incident.lawsuit_type} options={TYPE_LABELS} />
          </label>
          <label className="text-sm font-medium text-navy">Year filed
            <input name="year_filed" type="number" defaultValue={incident.year_filed ?? ""} className={input} />
          </label>
          <label className="text-sm font-medium text-navy">Filing year range
            <input name="filing_year_range" defaultValue={incident.filing_year_range ?? ""} className={input} />
          </label>
          <div className="flex items-end gap-6 pb-1 text-sm text-navy">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="year_filed_approx" defaultChecked={incident.year_filed_approx} />
              Year approximate
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="multiple_filings" defaultChecked={incident.multiple_filings} />
              Multiple filings
            </label>
          </div>
        </div>

        <hr className="border-navy/10" />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-navy">Outcome status
            <Select name="outcome_status" value={incident.outcome_status} options={OUTCOME_LABELS} />
          </label>
          <label className="text-sm font-medium text-navy">Outcome detail
            <input name="outcome_detail" defaultValue={incident.outcome_detail ?? ""} className={input} />
          </label>
          <label className="text-sm font-medium text-navy">Settlement amount (USD)
            <input name="settlement_amount" type="number" step="any"
              defaultValue={incident.settlement_amount ?? ""} className={input} />
          </label>
          <label className="text-sm font-medium text-navy">Settlement date
            <input name="settlement_date" type="date" defaultValue={incident.settlement_date ?? ""} className={input} />
          </label>
          <label className="text-sm font-medium text-navy">Criminal status
            <Select name="criminal_status" value={incident.criminal_status} options={CRIMINAL_LABELS} />
          </label>
          <label className="text-sm font-medium text-navy">Criminal detail
            <input name="criminal_detail" defaultValue={incident.criminal_detail ?? ""} className={input} />
          </label>
          <label className="text-sm font-medium text-navy">30x30 agency
            <Select name="is_30x30" value={incident.is_30x30 == null ? null : String(incident.is_30x30)}
              options={{ true: "Yes", false: "No" }} />
          </label>
          <label className="text-sm font-medium text-navy">30x30 match note
            <input name="thirty_by_thirty_match_note"
              defaultValue={incident.thirty_by_thirty_match_note ?? ""} className={input} />
          </label>
        </div>

        <label className="block text-sm font-medium text-navy">Description (strictly factual; attribute allegations)
          <textarea name="description" rows={6} defaultValue={incident.description ?? ""} className={input} />
        </label>
        <label className="block text-sm font-medium text-navy">Notes
          <textarea name="notes" rows={3} defaultValue={incident.notes ?? ""} className={input} />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium text-navy">Status
            <Select name="status" allowEmpty={false} value={incident.status}
              options={{ needs_review: "Needs review", published: "Published", excluded: "Excluded" }} />
          </label>
          <label className="text-sm font-medium text-navy">Last verified
            <input name="last_verified" type="date" defaultValue={incident.last_verified ?? ""} className={input} />
          </label>
          <div className="flex items-end">
            <button className="w-full rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              Save
            </button>
          </div>
        </div>
      </form>

      <section className="rounded-lg border border-navy/10 bg-white p-6">
        <h2 className="text-lg font-semibold">Sources</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(sources ?? []).map((s) => (
            <li key={s.id}>
              <a href={s.url} className="text-brand hover:underline">{s.title ?? s.url}</a>
              {s.archive_url ? (
                <a href={s.archive_url} className="ml-2 text-ink/60 underline">archive</a>
              ) : (
                <span className="ml-2 text-xs text-red-700">no archive</span>
              )}
            </li>
          ))}
        </ul>
        <form action={addSource} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input type="hidden" name="slug" value={incident.slug} />
          <input name="url" placeholder="URL" required className={input} />
          <input name="title" placeholder="Title" className={input} />
          <input name="archive_url" placeholder="Archive URL" className={input} />
          <button className="mt-1 rounded border border-brand px-3 text-sm font-medium text-brand hover:bg-brand hover:text-white">
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
