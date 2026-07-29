import Link from "next/link";
import { fetchIncidents, fetchFacets, type Filters } from "@/lib/queries";
import { label, money, OUTCOME_LABELS, TYPE_LABELS, CATEGORY_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

function qs(f: Filters, overrides: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...overrides })) {
    if (v) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

function SortLink({ f, col, children }: { f: Filters; col: string; children: React.ReactNode }) {
  const active = (f.sort ?? "year_filed") === col;
  const nextDir = active && f.dir !== "asc" ? "asc" : "desc";
  return (
    <Link
      href={`/${qs(f, { sort: col, dir: active ? nextDir : "desc" })}`}
      className={`inline-flex items-center gap-1 hover:text-brand ${active ? "text-brand" : ""}`}
    >
      {children}
      {active && <span aria-hidden>{f.dir === "asc" ? "↑" : "↓"}</span>}
    </Link>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = (await searchParams) as Filters;
  const [incidents, facets] = await Promise.all([fetchIncidents(f), fetchFacets()]);

  const sel = "rounded border border-navy/20 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold">
          Civil lawsuits alleging sexual harassment involving law-enforcement agencies
        </h1>
        <p className="max-w-3xl text-ink/80">
          One record per lawsuit, US and Canada, filed 2020 to present. Compiled
          from news media and verified against cited sources; every record shows a
          last-verified date. Read the <Link className="text-brand underline" href="/methodology">methodology</Link>.
        </p>
      </section>

      <form method="GET" action="/" className="rounded-lg border border-navy/10 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium text-navy">
            Search
            <input
              type="text" name="q" defaultValue={f.q ?? ""} placeholder="Agency, officer, keywords…"
              className="rounded border border-navy/20 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            State/Province
            <select name="state" defaultValue={f.state ?? ""} className={sel}>
              <option value="">All</option>
              {facets.states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            Country
            <select name="country" defaultValue={f.country ?? ""} className={sel}>
              <option value="">All</option>
              <option value="US">US</option>
              <option value="CA">Canada</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            Year filed
            <select name="year" defaultValue={f.year ?? ""} className={sel}>
              <option value="">All</option>
              {facets.years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            Case type
            <select name="type" defaultValue={f.type ?? ""} className={sel}>
              <option value="">All</option>
              {facets.types.map((t) => <option key={t} value={t}>{label(TYPE_LABELS, t)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            Agency category
            <select name="category" defaultValue={f.category ?? ""} className={sel}>
              <option value="">All</option>
              {facets.categories.map((c) => (
                <option key={c} value={c}>{label(CATEGORY_LABELS, c)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            Outcome
            <select name="outcome" defaultValue={f.outcome ?? ""} className={sel}>
              <option value="">All</option>
              {facets.outcomes.map((o) => (
                <option key={o} value={o}>{label(OUTCOME_LABELS, o)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            30x30
            <select name="x30" defaultValue={f.x30 ?? ""} className={sel}>
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            Settlement $ min
            <input type="number" name="amin" defaultValue={f.amin ?? ""} className={`${sel} w-28`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-navy">
            Settlement $ max
            <input type="number" name="amax" defaultValue={f.amax ?? ""} className={`${sel} w-28`} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
              Apply
            </button>
            <Link href="/" className="rounded border border-navy/20 px-4 py-1.5 text-sm hover:bg-paper">
              Reset
            </Link>
          </div>
        </div>
      </form>

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink/70">
          {incidents.length} record{incidents.length === 1 ? "" : "s"}
        </p>
        <a
          href={`/api/export${qs(f, {})}`}
          className="rounded border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand hover:text-white"
        >
          Export CSV
        </a>
      </div>

      {incidents.length === 0 ? (
        <div className="rounded-lg border border-navy/10 bg-white p-10 text-center text-ink/70">
          <p className="font-medium text-navy">No published records match.</p>
          <p className="mt-1 text-sm">
            Records appear here once verified. If you searched, try fewer terms.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy/10 bg-paper text-left text-xs uppercase tracking-wide text-navy">
                <th className="px-3 py-2"><SortLink f={f} col="agency">Agency</SortLink></th>
                <th className="px-3 py-2">Country</th>
                <th className="px-3 py-2"><SortLink f={f} col="state_province">State</SortLink></th>
                <th className="px-3 py-2"><SortLink f={f} col="year_filed">Filed</SortLink></th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2"><SortLink f={f} col="outcome_status">Outcome</SortLink></th>
                <th className="px-3 py-2 text-right"><SortLink f={f} col="settlement_amount">Amount</SortLink></th>
                <th className="px-3 py-2">Officer(s)</th>
                <th className="px-3 py-2 text-center">Repeat offender</th>
                <th className="px-3 py-2 text-center">30x30</th>
                <th className="px-3 py-2"><SortLink f={f} col="last_verified">Verified</SortLink></th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((r) => (
                <tr key={r.id} className="border-b border-navy/5 align-top hover:bg-brand/5">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/case/${r.slug}`} className="text-brand hover:underline">
                      {r.agency}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.country === "CA" ? "Canada" : r.country ?? "—"}</td>
                  <td className="px-3 py-2">{r.state_province ?? "—"}</td>
                  <td className="px-3 py-2">
                    {r.year_filed_approx ? "~" : ""}{r.filing_year_range ?? r.year_filed ?? "—"}
                  </td>
                  <td className="px-3 py-2">{label(TYPE_LABELS, r.lawsuit_type)}</td>
                  <td className="px-3 py-2">{label(OUTCOME_LABELS, r.outcome_status)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.settlement_amount)}</td>
                  <td className="px-3 py-2">{r.officer_names?.length ? r.officer_names.join(", ") : "—"}</td>
                  <td className="px-3 py-2 text-center">{r.repeat_offender ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-center">
                    {r.is_30x30 == null ? "—" : r.is_30x30 ? "Yes" : "No"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.last_verified ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
