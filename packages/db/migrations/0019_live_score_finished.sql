-- A game the live read last saw finished (ADR 0042). The second live source drops a game from its Live list once it
-- ends, often well before the site's own final is read, so a page fell back to "In progress" for a game that was over.
-- The read now keeps such a game with its last score and `finished` set: pages show it as "Score reported", dashed and
-- naming no winner, until the stored final replaces it. Still a read, never a result: unconfirmed, no winner.
--
-- live_scores() gains the column. Its result type changes, so it is dropped and made again, with the same rights as in
-- migration 0016: no one but anon and authenticated may run it, and neither may touch the table.

alter table live_score add column finished boolean not null default false;
comment on column live_score.finished is
  'The read saw the game finished: its last score, shown as "Score reported" with no winner until the stored final.';

drop function live_scores();
create function live_scores()
returns table (game_key text, home text, away text, home_score int, away_score int, period text, finished boolean, read_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.game_key, l.home, l.away, l.home_score, l.away_score, l.period, l.finished, l.read_at
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
