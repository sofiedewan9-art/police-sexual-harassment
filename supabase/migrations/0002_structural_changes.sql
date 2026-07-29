-- Structural changes (2026-07-28):
-- 1. New lawsuit type: internal — police academy (subset of internal)
-- 2. repeat_offender flag: officer appears in 2+ records, or sources
--    describe a repeat offense
alter type lawsuit_type add value if not exists 'internal_academy';

alter table incidents
  add column if not exists repeat_offender boolean not null default false;
