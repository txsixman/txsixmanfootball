-- The owner's reach over posts nobody reported (ADR 0084). /admin/moderation listed only reported and hidden posts
-- (admin_moderation_overview, migration 0027), so a post the owner saw, that no fan had reported, could not be hidden:
-- the owner's account has no fan profile, so it cannot report. This adds one read: the newest posts still showing, from the last
-- 7 days, each with its place and how many reports it has, so the page can offer Hide, Mute and Ban on any of them
-- (admin_hide_post, admin_mute, admin_set_ban, unchanged). Admin-only (admin_guard), read-only, at most 100 rows. It returns
-- what the flagged list already returns (author's display name and id, text, place), never an email or birth year.

create function admin_recent_posts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(r order by r.created_at desc, r.id) from (
      select p.id, p.author_id, pr.display_name as author, p.game_key, p.thread_id, p.title, p.body, p.created_at,
             (select count(*) from post_flag f where f.post_id = p.id)::int as flags
        from post p join profile pr on pr.user_id = p.author_id
       where p.hidden_at is null and not pr.banned and p.created_at > now() - interval '7 days'
       order by p.created_at desc, p.id limit 100) r), '[]');
end
$$;
comment on function admin_recent_posts() is
  'The owner''s list of the newest posts still showing (7 days, at most 100), so one nobody reported can be hidden. Admin-only.';

revoke all on function admin_recent_posts() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function admin_recent_posts() to authenticated;
  end if;
end
$$;
