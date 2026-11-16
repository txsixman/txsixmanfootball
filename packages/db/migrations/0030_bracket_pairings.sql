-- Comments on bracket-set games (ADR 0079). A playoff game's page (and its comment thread) is addressed
-- <season>-<round>-<away>-at-<home>. The site now gives a page to every next-round game the bracket has set by winners
-- before any listing has it (apps/web/lib/bracket-fill.ts), and addresses it in the bracket's own order (home the bracket
-- slot's first side), which for many already-listed later-round games is the reverse of the stored game row. Migration
-- 0013's add_comment refused both ("unknown_game"): resolve_game_key finds only a stored game, in the stored order.
--
--   - bracket_pairing: the comment keys of the current season's bracket-set games, both orders of each pairing, replaced
--     whole by packages/db/load.mjs on every load (loadBracketPairings). Row-level security, no policy and no grant: only
--     the security-definer function below reads it, so the API roles cannot read or write it.
--   - comment_game_known(key): true for a stored game's key (resolve_game_key, unchanged), for a stored PLAYOFF game's key
--     with its home and away swapped, or for a key in bracket_pairing. A key in none of those is still refused.
--   - add_comment: migration 0013's body, byte for byte, except the one check now asks comment_game_known. Signature and
--     grants are those of 0013 (create or replace keeps them); the helper is granted to nobody.
-- Score reports (0014: submit_score_report, fan_score_status) keep resolve_game_key as it is: they need the stored game and
-- its stored home and away, so a bracket-set or swapped key is still refused there.

create table bracket_pairing (
  season int not null,
  game_key text primary key check (game_key ~ '^[0-9]{4}-[a-z0-9-]{4,200}$' and left(game_key, 4)::int = season)
);
alter table bracket_pairing enable row level security;
comment on table bracket_pairing is 'Comment keys of the season''s bracket-set games, both orders (ADR 0079). Replaced whole by load.mjs. Read only by comment_game_known.';

create function comment_game_known(p_key text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_key is null or p_key !~ '^[0-9]{4}-[a-z0-9-]{4,200}$' then return false; end if;
  if resolve_game_key(p_key) is not null then return true; end if;
  -- A stored playoff game, its teams the other way round (the bracket's order, not the stored row's).
  if exists (
    select 1
      from game g
      join team_season h on h.id = g.home_ts join program ph on ph.id = h.program_id
      join team_season a on a.id = g.away_ts join program pa on pa.id = a.program_id
     where g.playoff_round is not null and g.season = left(p_key, 4)::int
       and p_key = g.season::text || '-' || g.playoff_round || '-' || ph.slug || '-at-' || pa.slug) then
    return true;
  end if;
  return exists (select 1 from bracket_pairing where game_key = p_key);
end
$$;

revoke all on function comment_game_known(text) from public;

-- A comment under a game page. Returns the new post's id.
create or replace function add_comment(p_game_key text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  problem text;
  c record;
  new_id uuid;
begin
  select * into a from fan_actor();
  if p_game_key is null or not comment_game_known(p_game_key) then raise exception 'unknown_game'; end if;
  problem := post_text_check(p_body, a.established);
  if problem is not null then raise exception '%', problem; end if;
  select * into c from fan_post_counts(a.uid);
  perform fan_rate_check('post', a.established, c.recent_n, c.day_n);
  insert into post (author_id, game_key, body) values (a.uid, p_game_key, btrim(p_body)) returning id into new_id;
  return new_id;
end
$$;
