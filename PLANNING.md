# Planning Doc — Public Database of Police Sexual Assault Lawsuits

**Project:** Searchable, sortable, filterable public database of civil lawsuits involving sexual
assault/harassment and law-enforcement agencies (US & Canada), for the Policing Project at NYU
School of Law, with a 30x30 Initiative membership flag on every record.

**Decisions already made (confirmed 2026-07-27):**

| Decision | Choice |
|---|---|
| Seed data | The attached xlsx (87 rows) is the seed; every row gets a research/enrichment pass |
| Stack | Next.js front end + Supabase (Postgres) + Vercel hosting |
| Pipeline runtime | GitHub Actions cron (weekly discovery; monthly re-verification) |
| Accuracy target | **Each column individually ≥95% accurate**, measured field-by-field on human-audited samples |

---

## 1. What we actually have (seed-data audit)

The brief described a clean 191-incident CSV. The real file (`data/SH Lawsuits and media
articles.xlsx`) is different, and the plan accounts for that:

| Finding | Consequence for the plan |
|---|---|
| **87 lawsuit rows**, not 191 | Import all 87; the ingestion pipeline is how the database grows toward (and past) full coverage |
| Columns are only: Agency, Year, 30x30, Country, State, Links, sparse Notes | Descriptions, lawsuit type, agency category, criminal status, structured outcome, and settlement amounts must be **researched and written per record** during enrichment (Phase 2) |
| Outcome is free text inside the Year cell (e.g. `"2021 (settled $1.8M in Oct 2022)"`) | Parse on import, then verify/normalize against sources into the controlled vocabulary |
| ~9 rows missing Year, several missing Agency/Country, 9 missing the 30x30 flag | Enrichment fills these; anything unresolvable goes to the human-review queue, never auto-published |
| **5 cells hold multiple stacked article titles but Excel kept only the first URL** (cells F20, F25, F33, F41, F46) | Recover the lost URLs by searching the surviving title text; store all links per record |
| 1 Australia row (NSW Police) | Out of scope (US/Canada only) → imported as `excluded`, visible only in admin |
| Some rows may be investigations/coverage, not filed suits (e.g. Rowlett TX) | Enrichment verifies a civil suit or formal claim actually exists; otherwise → review queue |
| Side sheets: "What Works" (3 resource links), "News not specific" (2 general articles) | Not lawsuit records → feed the methodology/resources page |
| 4 Notes flag borderline records (corrections agency; voyeurism/privacy rather than assault; inmate perpetrators) | Preserved as record notes + drive the `agency_category` / inclusion flags |

## 2. Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  GitHub Actions (cron)      │        │  Vercel                      │
│  • weekly: discovery run    │        │  • Next.js app (public site) │
│  • monthly: re-verify       │───────▶│  • /admin review queue       │
│    unresolved outcomes      │  writes│    (Supabase Auth protected) │
│  • Claude API sub-agents    │        └──────────────┬───────────────┘
│  • Google News RSS + GDELT  │                       │ reads/writes
│  • archive.org snapshots    │        ┌──────────────▼───────────────┐
└─────────────────────────────┘        │  Supabase (Postgres)         │
                                       │  • incidents, sources,       │
                                       │    agencies_30x30, revisions,│
                                       │    review_queue, audits      │
                                       │  • full-text search (tsvector)│
                                       │  • RLS: public read published │
                                       └──────────────────────────────┘
```

- **New Supabase project** (separate from the Survivor bot's) and a new GitHub repo
  (`police-sa-lawsuits`), auto-deploying to Vercel on push — same operational pattern you
  already run.
- News discovery uses **free sources first** (Google News RSS, GDELT); Bing/other paid news APIs
  are optional later.
- All AI extraction/verification calls use the **Claude API** from the Actions runner.

## 3. Database schema (core tables)

**`incidents`** — one row per incident (brief's rule 1)
- `id`, `slug`
- `agency` (official name), `agency_category` — enum: `police / sheriff / state_police /
  corrections / juvenile / federal / campus / transit / other`
- `country` (`US`/`CA`), `state_province` (2-letter)
- `lawsuit_type` — enum: `civilian / internal / class_action`
- `year_filed` (int, nullable), `year_filed_approx` (bool, for `~` years),
  `multiple_filings` (bool + `filing_year_range` text, for bundled suits)
- `outcome_status` — controlled vocabulary enum: `settled / plaintiff_verdict /
  defense_verdict / dismissed / ongoing / no_resolution_found`
  (with `outcome_detail` text: grounds, appeal status, dates)
- `settlement_amount` (numeric, USD-normalized; `settlement_amount_original` + currency for CAD),
  `settlement_date`
- `criminal_status` — separate track, enum: `none_filed / charged / convicted / pleaded_guilty /
  acquitted / charges_dropped / unknown` + `criminal_detail` text
- `is_30x30` (bool), `thirty_by_thirty_match_note` (text, for ambiguous matches)
- `description` (strictly factual per rule 5), `notes`
- `officer_names` (text[], only names already in public reporting — never victims)
- `incident_date_approx` (for dedup)
- `status` — enum: `published / needs_review / excluded`
- `last_verified` (date), `confidence` (per-field JSON of verifier agreement)
- `search_vector` (tsvector, GIN-indexed)

**`sources`** — one row per article link
- `incident_id`, `url`, `archive_url` (archive.org snapshot), `title`, `publisher`,
  `published_date`, `added_at`, `is_dead_link` (bool, re-checked by pipeline)

**`agencies_30x30`** — the parsed 30x30 list (~370 agencies from the brief)
- `name`, `city`, `state_province`, `country` — conservative matching is *same city AND state*;
  known traps encoded in tests: Vancouver WA ≠ Vancouver BC; San Diego PD ≠ SD County Sheriff;
  Kansas City = Missouri.

**`review_queue`** — items awaiting human decision
- `incident_id` (nullable for brand-new candidates), `reason` (`low_confidence / borderline_agency /
  single_source / disputed / correction_request / field_disagreement`), `payload` (JSON),
  `resolved_by`, `resolution`

**`revisions`** — full audit trail: every field change, by whom (pipeline run id / admin user), when.

**`accuracy_audits`** — the measurement backbone (§7): audit batch, record id, column, AI value,
human-adjudicated value, correct (bool).

**`correction_requests`** — public form submissions (name/email optional, record, message) → feeds
`review_queue`.

## 4. Web app (public, read-only)

- **Main table view:** full-text search across all fields; sort on any column; filters for
  state/province, country, year filed, lawsuit type, agency category, outcome status, 30x30
  (Yes/No), settlement-amount range. URL-encoded filter state (shareable links).
- **Record detail page:** factual description, civil status + criminal status shown as two
  separate labeled tracks, all source links each paired with its archive.org link,
  `last verified` date, notes/flags (e.g. "outside strict police-department definition").
- **Methodology page:** reproduces the compilation rules verbatim (one row per incident, time
  window, three case types, agency scope, factual-language policy, outcome vocabulary and
  the settled/ongoing/no-resolution-found distinction, criminal-vs-civil independence,
  conservative 30x30 matching, archive-link policy) **plus** the accuracy framework and current
  audited accuracy per column.
- **CSV export button** (respects active filters).
- **Corrections/contact page:** form for agencies or parties to request review of a record
  (defamation-risk mitigation); submissions land in the review queue and get a response SLA note.
- **Stats strip** (counts by outcome, 30x30 split) — descriptive counts only, no
  pattern-drawing language anywhere in UI copy.

**Design:** match 30x30initiative.org — extracted from their live theme: primary `#525ddc`,
navy `#0e2c5e`, purple `#6c43e1`, accent yellow `#fdc512`, light gray `#f8f8f8` backgrounds.
Their fonts (Eloquia, TiemposHeadline) are commercial, so use free look-alikes: **DM Sans** or
Inter for body/UI, a Tiempos-adjacent serif (**Source Serif 4** or Lora) for headlines.
Clearly branded as a Policing Project research product, *referencing* 30x30 — not impersonating
either organization.

**Legal/ethical guardrails baked into the app:**
- Victims never named beyond cited public reporting; "Jane Doe" framing preferred. A pipeline
  lint rejects descriptions containing names not present in cited sources' own text.
- Allegation language enforced: unless `criminal_status ∈ {convicted, pleaded_guilty}` or a
  jury finding/admission is on record, descriptions must attribute ("the suit alleges…").
  A dedicated verifier sub-agent checks every description for this before publish.
- Site-wide disclaimer + per-record "request a correction" link.

## 5. Ingestion & verification pipeline (GitHub Actions)

**Weekly discovery run:**
1. **Discover** — query Google News RSS + GDELT with the query families from the brief
   (officer/deputy/trooper/jailer × lawsuit/sued/settlement × sexual assault/harassment/rape;
   internal-plaintiff variants; Canada "civil claim/police service" variants; state-by-state
   expansions rotated across weeks to stay within rate limits).
2. **Screen** (Claude, cheap pass) — does the article describe an actual filed civil suit or
   formal claim (notice of claim, EEOC/human-rights complaint)? Criminal charges alone → reject.
   Sexual assault/harassment central to the claim? US/Canada? Filed or resolved in window
   (2021→present, or earlier filing with in-window resolution)?
3. **Deduplicate** — match against existing records on agency + officer name(s) + incident
   date/window (rule 1: new articles about an existing suit attach as new `sources` rows, they
   never create a record; related suits from one incident merge into one record).
4. **Extract & draft** — a Claude agent drafts the full record (all schema fields + strictly
   factual description) from all gathered sources.
5. **Verify — independent sub-agents per column** (the brief's requirement, and the engine of
   the 95% guarantee): for each of the 10 audited columns (§7), **two independent verifier
   agents** re-derive the value from the sources alone, without seeing the extractor's draft.
   - 3-way agreement (extractor + both verifiers) → field accepted.
   - Any disagreement → field flagged; record goes to `review_queue`, not published.
   A separate **language verifier** checks the description for allegation-attribution and
   victim-naming compliance.
6. **Outcome search** — dedicated follow-up search per new case for resolution coverage
   (never trust filing coverage alone); sets `outcome_status` + `last_verified`.
7. **30x30 match** — deterministic city+state match against `agencies_30x30`; near-misses
   (name matches, geography ambiguous) → flagged with a match note + review queue.
8. **Archive** — request an archive.org Save-Page-Now snapshot for every source URL; store
   `archive_url`. Retry queue for archive failures.
9. **Publish or queue** — fully verified records auto-publish; anything low-confidence
   (borderline agency type, single-source story, disputed allegations, any field disagreement)
   queues for human review in `/admin`.

**Monthly re-verification run:** every record with `outcome_status ∈ {ongoing,
no_resolution_found}` — and any record `last_verified` > 6 months ago — gets a fresh outcome
search; changes go through the same verifier gate; `last_verified` updates either way.
Dead-link checker re-tests source URLs and swaps display preference to archive links.

**Admin review UI** (`/admin`, Supabase Auth, your account + optional colleagues): queue list,
side-by-side AI draft vs. sources, per-field accept/edit/reject, one-click publish/exclude.
Every action writes to `revisions`.

## 6. Seed import & enrichment (the 87 rows)

1. **Parse xlsx** → staging: split `Year` into `year_filed` / `result` / `dollar_amount`
   (handles `~`, ranges, "Certified 2021", CAD amounts); carry Notes; extract the one stored
   hyperlink per cell + the orphaned article titles from the 5 multi-link cells.
2. **Recover lost URLs** — search each orphaned title, confirm the article matches, attach.
3. **Enrich every record** (research agents, same per-column verifier gate as the pipeline):
   write the description; determine lawsuit type, agency category, criminal status; normalize
   outcome + amounts; fill missing years/agencies/states; set the 9 missing 30x30 flags via the
   deterministic matcher; snapshot every URL to archive.org; set `last_verified`.
4. **Triage:** Australia row → `excluded`; suspected non-lawsuits → verify or queue; borderline
   notes rows → categorized + flagged per the brief's filterable-scope rule.
5. **Because the seed is only 87 records, we human-audit 100% of it** (§7) — this both
   guarantees seed quality and produces the gold set that calibrates the pipeline.

## 7. Accuracy framework — per-column ≥95%

**Metric definition:** for each audited column, accuracy = (records where the published value
matches the human-adjudicated value from the cited sources) ÷ (records audited). The 10 audited
columns: `agency`, `agency_category`, `country`, `state_province`, `year_filed`, `lawsuit_type`,
`outcome_status`, `settlement_amount`, `criminal_status`, `is_30x30`. Each must independently
be ≥95%. (Descriptions are audited pass/fail on the two compliance rules rather than scored.)

**Three layers:**

1. **Prevention** — the 2-independent-verifier gate (§5.5): a value only publishes when three
   independent derivations agree. Disagreement → human review. This is what makes 95% *achievable*.
2. **Measurement** —
   - *Seed:* full census audit of all 87 records in the `/admin` audit mode (you confirm or
     correct each field against the sources; corrections are themselves the fix). Result: exact
     per-column accuracy for the seed, and a **gold set** for regression-testing the pipeline.
   - *Ongoing:* monthly stratified random sample of pipeline-published records — 40 records/month
     (or all, while volume is lower). Per-column results appended to `accuracy_audits`.
   - *Statistical note:* with a 40-record sample, ≥39 correct gives a one-sided 95% lower
     confidence bound above ~88%; cumulative audits across months tighten this. The dashboard
     reports both the point estimate and the lower bound so the 95% claim is honest.
3. **Response** — any column whose rolling accuracy dips below 95%: its verifier prompt/logic is
   revised, the failing pattern is added to the regression gold set, and affected records are
   re-run. The methodology page shows current audited accuracy per column and last-audit date.

**Regression harness:** before any prompt/pipeline change ships, it must re-extract the gold set
at ≥95% per column in CI.

## 8. Build phases

| Phase | Deliverable | Est. effort |
|---|---|---|
| **0. Infra** | GitHub repo, Supabase project + schema/RLS migrations, Vercel project, secrets | small |
| **1. Seed import** | xlsx parser → staging records; 30x30 list parsed into `agencies_30x30`; lost-URL recovery | small-medium |
| **2. Seed enrichment** | Research + per-column verification of all 87 records; archive snapshots | the big AI-driven step |
| **3. Public app** | Table/search/filters/sort, detail pages, methodology, CSV export, corrections form, 30x30-styled design | medium |
| **4. Admin** | Review queue UI + full-census seed audit mode | medium |
| **5. Pipeline** | GitHub Actions discovery + verification + archive + publish/queue; monthly re-verify job | medium |
| **6. Accuracy dashboard** | Audit tooling, per-column stats on methodology page, gold-set regression CI | small-medium |

Sequencing: 0 → 1 → (2 ∥ 3) → 4 → *seed census audit happens here* → 5 → 6. The site can go
live to reviewers after Phase 4; public launch after the seed audit confirms per-column ≥95%.

## 9. Credentials & costs

Needed from you at build time:
- **Supabase**: create one new project (free tier is fine to start) — or I can, if the CLI is
  logged in.
- **Vercel**: connect the new repo (same account as the Survivor project).
- **Anthropic API key** as a GitHub Actions secret (`ANTHROPIC_API_KEY`).
- **GitHub repo** (can be private with a public site).

Running costs (estimates): Vercel + Supabase free tiers ≈ $0; seed enrichment ≈ $10–30 of
Claude API one-time (87 records × research + 2 verifiers × 10 columns); weekly pipeline ≈
$2–10/run depending on news volume; archive.org free.

## 10. Risks & open items

- **Defamation surface** — mitigated by allegation-language enforcement, corrections mechanism,
  archive-backed sourcing, and the human gate on anything disputed. Worth a once-over by
  Policing Project counsel before public launch.
- **The brief's example** of accusers later charged with false reporting: pipeline keeps such
  records in `review_queue` with a `disputed` reason and the record page must reflect the
  full public record.
- **Google News RSS/GDELT recall** — free discovery will miss some cases; acceptable at start,
  Bing News API can be added later as a paid booster.
- **archive.org Save-Page-Now rate limits** — snapshots run through a retry queue; some
  paywalled pages won't archive cleanly (flagged on the record).
- **Eloquia/Tiempos fonts are commercial** — using free look-alikes unless NYU has licenses.
- **CAD settlements** — stored in original currency + USD-normalized field for the range filter
  (conversion date noted).
- **Naming/domain** for the public site — TBD by you (works fine on a `*.vercel.app` URL until
  then).
