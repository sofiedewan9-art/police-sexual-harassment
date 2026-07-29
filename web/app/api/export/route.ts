import { fetchIncidents, type Filters } from "@/lib/queries";

const COLUMNS = [
  "agency", "officer_names", "repeat_offender",
  "agency_category", "country", "state_province", "lawsuit_type",
  "year_filed", "year_filed_approx", "filing_year_range", "outcome_status",
  "outcome_detail", "settlement_amount", "settlement_currency", "settlement_date",
  "criminal_status", "criminal_detail", "is_30x30", "description", "notes",
  "last_verified", "slug",
] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const f = Object.fromEntries(url.searchParams) as Filters;
  const incidents = await fetchIncidents(f);
  const rows = [
    COLUMNS.join(","),
    ...incidents.map((r) =>
      COLUMNS.map((c) => csvCell((r as Record<string, unknown>)[c])).join(",")
    ),
  ];
  return new Response(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="police-sa-lawsuits.csv"',
    },
  });
}
