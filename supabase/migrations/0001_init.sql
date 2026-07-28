-- Schema for the police sexual assault lawsuits database.
-- Run via Supabase SQL editor or `supabase db push`.

create type agency_category as enum (
  'police', 'sheriff', 'state_police', 'corrections', 'juvenile',
  'federal', 'campus', 'transit', 'other'
);

create type lawsuit_type as enum ('civilian', 'internal', 'class_action');

create type outcome_status as enum (
  'settled', 'plaintiff_verdict', 'defense_verdict', 'dismissed',
  'ongoing', 'no_resolution_found'
);

create type criminal_status as enum (
  'none_filed', 'charged', 'convicted', 'pleaded_guilty',
  'acquitted', 'charges_dropped', 'unknown'
);

create type record_status as enum ('published', 'needs_review', 'excluded');

create type review_reason as enum (
  'low_confidence', 'borderline_agency', 'single_source', 'disputed',
  'correction_request', 'field_disagreement', 'not_a_lawsuit', 'out_of_scope'
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  agency text not null,
  agency_category agency_category,
  country text check (country in ('US', 'CA')),
  state_province text,
  lawsuit_type lawsuit_type,
  year_filed int,
  year_filed_approx boolean not null default false,
  multiple_filings boolean not null default false,
  filing_year_range text,
  outcome_status outcome_status,
  outcome_detail text,
  settlement_amount numeric,               -- USD-normalized
  settlement_amount_original numeric,
  settlement_currency text default 'USD',
  settlement_date date,
  criminal_status criminal_status,
  criminal_detail text,
  is_30x30 boolean,
  thirty_by_thirty_match_note text,
  description text,
  notes text,
  officer_names text[] not null default '{}',
  incident_date_approx text,               -- free-form window used for dedup
  status record_status not null default 'needs_review',
  confidence jsonb not null default '{}'::jsonb,  -- per-field verifier agreement
  last_verified date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(agency, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(outcome_detail, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(criminal_detail, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D') ||
    setweight(to_tsvector('english', array_to_string(officer_names, ' ')), 'B')
  ) stored
);

create index incidents_search_idx on incidents using gin (search_vector);
create index incidents_status_idx on incidents (status);
create index incidents_state_idx on incidents (country, state_province);
create index incidents_year_idx on incidents (year_filed);
create index incidents_outcome_idx on incidents (outcome_status);

create table sources (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  url text not null,
  archive_url text,
  title text,
  publisher text,
  published_date date,
  is_dead_link boolean not null default false,
  added_at timestamptz not null default now(),
  unique (incident_id, url)
);

create table agencies_30x30 (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  state_province text not null,
  country text not null default 'US',
  unique (name, city, state_province)
);

create table review_queue (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete cascade,
  reason review_reason not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text
);

create table revisions (
  id bigint generated always as identity primary key,
  incident_id uuid not null references incidents(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by text not null,            -- 'pipeline:<run id>' or admin email
  changed_at timestamptz not null default now()
);

create table accuracy_audits (
  id bigint generated always as identity primary key,
  batch text not null,                 -- e.g. 'seed-census', '2026-09-sample'
  incident_id uuid not null references incidents(id) on delete cascade,
  column_name text not null,
  ai_value text,
  human_value text,
  is_correct boolean not null,
  audited_by text not null,
  audited_at timestamptz not null default now()
);

create table correction_requests (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) on delete set null,
  name text,
  email text,
  organization text,
  message text not null,
  created_at timestamptz not null default now(),
  handled boolean not null default false
);

-- Row-level security: public may read published records and their sources,
-- and may file correction requests. Everything else requires the service role.
alter table incidents enable row level security;
alter table sources enable row level security;
alter table agencies_30x30 enable row level security;
alter table review_queue enable row level security;
alter table revisions enable row level security;
alter table accuracy_audits enable row level security;
alter table correction_requests enable row level security;

create policy public_read_published on incidents
  for select using (status = 'published');

create policy public_read_sources on sources
  for select using (
    exists (
      select 1 from incidents i
      where i.id = sources.incident_id and i.status = 'published'
    )
  );

create policy public_read_30x30 on agencies_30x30
  for select using (true);

create policy public_file_correction on correction_requests
  for insert with check (true);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger incidents_updated_at
  before update on incidents
  for each row execute function set_updated_at();
