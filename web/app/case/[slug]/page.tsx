import Link from "next/link";
import { notFound } from "next/navigation";
import { supabasePublic } from "@/lib/supabase";
import type { Incident, Source } from "@/lib/types";
import {
  label, money, OUTCOME_LABELS, TYPE_LABELS, CATEGORY_LABELS, CRIMINAL_LABELS,
} from "@/lib/format";

export const dynamic = "force-dynamic";

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-navy/70">{name}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

export default async function CasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = supabasePublic();
  const { data: incident } = await db
    .from("incidents").select("*").eq("slug", slug).maybeSingle<Incident>();
  if (!incident) notFound();
  const { data: sources } = await db
    .from("sources").select("*").eq("incident_id", incident.id)
    .order("published_date", { ascending: true }) as { data: Source[] | null };

  return (
    <article className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href="/" className="text-sm text-brand hover:underline">← All records</Link>
        <h1 className="mt-2 text-3xl font-semibold">{incident.agency}</h1>
        <p className="text-ink/70">
          {incident.state_province}
          {incident.country === "CA" ? ", Canada" : incident.country === "US" ? ", United States" : ""}
          {" · "}Filed {incident.year_filed_approx ? "~" : ""}
          {incident.filing_year_range ?? incident.year_filed ?? "unknown"}
        </p>
      </div>

      {incident.description && (
        <section className="rounded-lg border border-navy/10 bg-white p-6 leading-relaxed">
          {incident.description}
        </section>
      )}

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border-l-4 border-brand bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Civil case</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Field name="Status">{label(OUTCOME_LABELS, incident.outcome_status)}</Field>
            {incident.outcome_detail && <Field name="Detail">{incident.outcome_detail}</Field>}
            {incident.settlement_amount != null && (
              <Field name="Settlement / award">
                {money(incident.settlement_amount)}
                {incident.settlement_currency && incident.settlement_currency !== "USD"
                  ? ` (${incident.settlement_currency})` : ""}
                {incident.settlement_date ? ` — ${incident.settlement_date}` : ""}
              </Field>
            )}
            <Field name="Case type">{label(TYPE_LABELS, incident.lawsuit_type)}</Field>
          </dl>
        </div>
        <div className="rounded-lg border-l-4 border-accent bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Criminal case</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Field name="Status">{label(CRIMINAL_LABELS, incident.criminal_status)}</Field>
            {incident.criminal_detail && <Field name="Detail">{incident.criminal_detail}</Field>}
          </dl>
          <p className="mt-3 text-xs text-ink/60">
            A civil lawsuit (damages, preponderance standard) is independent of any criminal
            prosecution (beyond-reasonable-doubt standard).
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-navy/10 bg-white p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <Field name="Officer(s) named in reporting">
            {incident.officer_names?.length ? incident.officer_names.join(", ") : "—"}
          </Field>
          <Field name="Repeat offender">{incident.repeat_offender ? "Yes" : "No"}</Field>
          <Field name="Agency category">{label(CATEGORY_LABELS, incident.agency_category)}</Field>
          <Field name="30x30 agency">
            {incident.is_30x30 == null ? "Undetermined" : incident.is_30x30 ? "Yes" : "No"}
          </Field>
          <Field name="Last verified">{incident.last_verified ?? "—"}</Field>
        </dl>
        {incident.notes && (
          <p className="mt-4 border-t border-navy/10 pt-3 text-sm text-ink/70">
            <span className="font-medium text-navy">Notes: </span>{incident.notes}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold">Sources</h2>
        <ul className="mt-3 space-y-2">
          {(sources ?? []).map((s) => (
            <li key={s.id} className="rounded border border-navy/10 bg-white px-4 py-2.5 text-sm">
              <a href={s.url} className="text-brand hover:underline" rel="nofollow noopener">
                {s.title ?? s.url}
              </a>
              {s.publisher && <span className="text-ink/60"> — {s.publisher}</span>}
              {s.archive_url && (
                <>
                  {" · "}
                  <a href={s.archive_url} className="text-ink/60 underline" rel="nofollow noopener">
                    archived copy
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-ink/60">
        See an error in this record?{" "}
        <Link href={`/corrections?record=${incident.slug}`} className="text-brand underline">
          Request a correction.
        </Link>
      </p>
    </article>
  );
}
