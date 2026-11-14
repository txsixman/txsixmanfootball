-- A live score left unchanged late in a game is final (ADR 0043). The rule: a game in the fourth quarter or later whose
-- score has not changed for an hour is over. The second live source often keeps a game in its Live list long after it ends,
-- so pages kept saying "Live" for a game that was done.
--
-- - score_changed_at: when the score last changed, as the live read saw it. live.mjs sets it to the read's time when a
--   row is new or its score differs from the stored row, and keeps it otherwise, so it carries across runs.
-- - late: the read saw the game in the fourth quarter or later (the feed's raw period 4 or more, or 2 hours since kickoff).
--   Written by the reader. The raw period itself is still never stored or shown (ADR 0042).
--
-- live_scores() now returns `finished` as the one flag every reader of live rows uses: the read saw the game finished, or
-- it is late and its score has not changed for 60 minutes. A 0-0 is never final by the second rule. Its result type is
-- unchanged, so the function is replaced in place and keeps the rights migration 0019 gave it; they are set again anyway.

alter table live_score add column score_changed_at timestamptz;
alter table live_score add column late boolean not null default false;
update live_score set score_changed_at = read_at where score_changed_at is null;

comment on column live_score.finished is
  'The read saw the game finished. live_scores() also reports a late game unchanged for 60 minutes as finished (ADR 0043).';
comment on column live_score.score_changed_at is
  'When the live read last saw this game''s score change (the read time of the first read with this score).';
comment on column live_score.late is
  'The read saw the game in the fourth quarter or later: the feed''s raw period 4 or more, or 2 hours since kickoff.';

create or replace function live_scores()
returns table (game_key text, home text, away text, home_score int, away_score int, period text, finished boolean, read_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.game_key, l.home, l.away, l.home_score, l.away_score, l.period,
         l.finished
           or (l.late
               and l.home_score + l.away_score > 0
               and now() - coalesce(l.score_changed_at, l.read_at) >= interval '60 minutes'),
         l.read_at
    from live_score l
   where l.read_at > now() - interval '6 hours'
   order by l.game_key
   limit 200;
$$;

revoke all on function live_scores() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function live_scores() to anon, authenticated;
  end if;
end
$$;
