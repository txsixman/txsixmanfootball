-- Comment counts for the score cards (ADR 0078). One public read: how many comments each of up to 200 game keys has,
-- so a score card can say a thread is active. A new read only: nothing in migrations 0013 to 0015 or ADR 0018 changes.
--   - The visibility rule is list_comments' (migration 0013, never redefined since): a post under that game key, not
--     hidden, by an author who is not banned. A muted author's comment still shows, so it still counts.
--   - Only keys with at least one visible comment come back. Only the first 200 array elements are looked at; the rest
--     are ignored, so one call is bounded whatever the caller sends.
--   - It returns a game key and a number. Nothing that identifies anyone, no text, no time.
--   - Like the other public reads it is not behind the posts switch (migration 0024); the site's route is (ADR 0052).

create function comment_counts(p_game_keys text[])
returns table (game_key text, comments int)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.game_key, count(*)::int
    from post p join profile pr on pr.user_id = p.author_id
   where p.game_key in (select k.key from unnest(p_game_keys) with ordinality as k(key, n) where k.n <= 200)
     and p.hidden_at is null and not pr.banned
   group by p.game_key
   order by p.game_key
$$;

revoke all on function comment_counts(text[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function comment_counts(text[]) to anon, authenticated;
  end if;
end
$$;
