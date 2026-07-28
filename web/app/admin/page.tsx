import Link from "next/link";
import { supabaseService } from "@/lib/supabase";
import type { Incident } from "@/lib/types";
import { label, OUTCOME_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — review queue" };

const STATUSES = ["needs_review", "published", "excluded"] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = "needs_review" } = await searchParams;
  const db = supabaseService();
  const [{ data: incidents }, counts, { count: corrections }] = await Promise.all([
    db.from("incidents").select("*").eq("status", status)
      .order("agency", { ascending: true }).limit(500) as unknown as Promise<{ data: Incident[] | null }>,
    Promise.all(
      STATUSES.map(async (s) => {
        const { count } = await db
          .from("incidents").select("*", { count: "exact", head: true }).eq("status", s);
        return [s, count ?? 0] as const;
      })
    ),
    db.from("correction_requests").select("*", { count: "exact", head: true }).eq("handled", false),
  ]);
  const countMap = Object.fromEntries(counts);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        {(corrections ?? 0) > 0 && (
          <span className="rounded bg-accent px-3 py-1 text-sm font-medium text-navy">
            {corrections} unhandled correction request{corrections === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <nav className="flex gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin?status=${s}`}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              s === status ? "bg-brand text-white" : "border border-navy/20 bg-white hover:bg-paper"
            }`}
          >
            {s.replace("_", " ")} ({countMap[s]})
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy/10 bg-paper text-left text-xs uppercase tracking-wide text-navy">
              <th className="px-3 py-2">Agency</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Filed</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Missing</th>
              <th className="px-3 py-2">Verified</th>
            </tr>
          </thead>
          <tbody>
            {(incidents ?? []).map((r) => {
              const missing = [
                !r.description && "description",
                !r.lawsuit_type && "type",
                !r.agency_category && "category",
                !r.outcome_status && "outcome",
                !r.criminal_status && "criminal",
                r.is_30x30 == null && "30x30",
                !r.year_filed && "year",
              ].filter(Boolean);
              return (
                <tr key={r.id} className="border-b border-navy/5 hover:bg-brand/5">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/admin/${r.slug}`} className="text-brand hover:underline">
                      {r.agency}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.state_province ?? "—"}</td>
                  <td className="px-3 py-2">{r.filing_year_range ?? r.year_filed ?? "—"}</td>
                  <td className="px-3 py-2">{label(OUTCOME_LABELS, r.outcome_status)}</td>
                  <td className="px-3 py-2 text-xs text-red-700">{missing.join(", ") || "—"}</td>
                  <td className="px-3 py-2">{r.last_verified ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
