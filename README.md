# Police Sexual Assault Lawsuits Database

A public, searchable database of civil lawsuits involving sexual assault and law-enforcement
agencies in the US and Canada — a research project of the [Policing Project at NYU School of
Law](https://www.policingproject.org/), examining the prevalence of sexual assault lawsuits in
police departments, including whether the agency participates in the
[30x30 Initiative](https://30x30initiative.org/).

## What's here

| Path | Purpose |
|---|---|
| [`PLANNING.md`](PLANNING.md) | Full build plan: architecture, schema, ingestion pipeline, accuracy framework |
| [`data/`](data/) | Seed dataset (87 incidents, compiled from news-media searches, July 2026) |

## How it works (planned)

- **Seed:** 87 incident records imported from the spreadsheet, then enriched by AI research
  agents (descriptions, outcomes, criminal status, archive links) with every field verified by
  two independent passes.
- **Growth:** a weekly GitHub Actions pipeline discovers new cases via news search, screens them
  against fixed inclusion criteria, deduplicates (one record per incident), verifies every
  column, and either publishes or queues for human review.
- **Accuracy:** each column is held to ≥95% accuracy, measured by human audits against cited
  sources and reported publicly on the site's methodology page.
- **Stack:** Next.js on Vercel · Supabase (Postgres) · GitHub Actions · Claude API.

## Key methodology rules

1. One row per **incident** — not per article, plaintiff, or filing.
2. Time window: suits filed ~2021–present (or resolved in that window).
3. Civil and criminal proceedings are tracked as **separate fields**.
4. Descriptions are strictly factual; allegations always read as allegations unless there is a
   conviction, guilty plea, admission, or jury finding.
5. Outcomes use a controlled vocabulary; "no resolution found in coverage" is distinct from
   "ongoing," and unresolved cases are re-verified on a schedule.
6. 30x30 membership is matched conservatively (same city **and** state/province).
7. Every source link is paired with an archive.org snapshot at ingestion time.

See [`PLANNING.md`](PLANNING.md) for the complete ruleset and build phases.

## Status

🚧 Planning complete — build not yet started.
