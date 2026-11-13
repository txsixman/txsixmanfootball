-- Live scores during a game (ADR 0021). One row per game under way: the score the game-day read (Results watch, every 10
-- minutes) last saw before the final, so a page can show it without a rebuild. Public facts only (two program slugs, two
-- scores, the period, when it was read); no names, no source, no winner.
--
-- Like every table, it is closed to Supabase's API roles (migration 0005): row-level security on, no policy, no table
-- right. A browser reads it only through live_scores(), a read-only security-definer function granted to anon and
-- authenticated (the pattern of the fan reads, 0013 to 0015), so the live check (checkLive) needs no exception. Only the
-- writer (packages/db/live.mjs, run by Results watch as the database owner) changes the rows, which are replaced on every
-- run: a game that went final or vanished is deleted, and any row older than 6 hours is dropped.

create table live_score (
  -- The site's shared game key (lib/games.ts gameKey): the game date, then both program slugs, sorted: "2026-11-13|a|b".
  game_key text primary key check (length(game_key) <= 200 and game_key ~ '^\d{4}-\d{2}-\d{2}\|[a-z0-9]+(-[a-z0-9]+)*\|[a-z0-9]+(-[a-z0-9]+)*$'),
  home text not null check (length(home) <= 80 and home ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  away text not null check (length(away) <= 80 and away ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  home_score integer not null check (home_score between 0 and 200),
  away_score integer not null check (away_score between 0 and 200),
  -- "Q3", "Half" and the like, when the read knows it; null when it does not.
  period text check (period is null or (length(period) between 1 and 12 and period !~ '[<>&"]')),
  read_at timestamptz not null,
  source text not null default 'robot' check (source in ('robot'))
);
alter table live_score enable row level security;
comment on table live_score is
  'The score of each game under way, as the game-day read last saw it. Replaced every run; public; unconfirmed (ADR 0021).';

-- The games under way, for the browser: public facts only, read-only, nothing from any other table. Rows read over
-- 6 hours ago are left out even before the writer's next run removes them.
create function live_scores()
returns table (game_key text, home text, away text, home_score int, away_score int, period text, read_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.game_key, l.home, l.away, l.home_score, l.away_score, l.period, l.read_at
    from live_score l
   where l.read_at > now() - interval '6 hours'
   order by l.game_key
   limit 200;
$$;

revoke all on function live_scores() from public;

-- The API roles exist only on Supabase (not on the tests' plain Postgres), so the grants wait for them.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on live_score from anon, authenticated;
    grant execute on function live_scores() to anon, authenticated;
  end if;
end
$$;
