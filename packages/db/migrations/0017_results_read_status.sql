-- When Results watch last finished a game-day read (ADR 0038). One row, replaced by packages/db/live.mjs in the same
-- transaction that writes live_score, on every game-day run (even one that finds no game under way). A page reads it to say
-- "Scores checked 4 min ago". It cannot come from a commit's time: Results watch commits only when a final changes.
--
-- Like every table, it is closed to Supabase's API roles (migration 0005): row-level security on, no policy, no table
-- right. A browser reads it only through results_read_at(), a read-only security-definer function granted to anon and
-- authenticated (the pattern of live_scores(), 0016), so the live check (checkLive) needs no exception.

create table read_status (
  -- The one row: the primary key can only be true.
  id boolean primary key default true check (id),
  read_at timestamptz not null
);
alter table read_status enable row level security;
comment on table read_status is
  'The time of the last game-day read: one row, replaced every run, no history (ADR 0038).';

-- The time of the last read, for the browser: a bare timestamp, null when there is no row.
create function results_read_at()
returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select (select s.read_at from read_status s);
$$;

revoke all on function results_read_at() from public;

-- The API roles exist only on Supabase (not on the tests' plain Postgres), so the grants wait for them.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on read_status from anon, authenticated;
    grant execute on function results_read_at() to anon, authenticated;
  end if;
end
$$;
