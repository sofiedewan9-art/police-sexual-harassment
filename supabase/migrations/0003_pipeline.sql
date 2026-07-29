-- Pipeline bookkeeping: every candidate URL the ingestion job has processed,
-- so weekly runs never re-screen the same article.
create table if not exists pipeline_seen (
  url text primary key,
  title text,
  disposition text,          -- excluded | duplicate | inserted | error
  detail text,
  seen_at timestamptz not null default now()
);
alter table pipeline_seen enable row level security;
-- no public policies: service-role only
