-- Posts launch hardening (ADRs 0060 to 0062), before the posts switch opens. Nothing here opens posts: site_switch
-- (migration 0024) stays as it is.
--   1. A per-minute limit on top of the 10-minute and 24-hour ones (ADR 0060), so a burst is stopped in the first minute.
--   2. Betting talk refused in posts and titles, like slurs (ADR 0060): the site never uses betting words, and fans' posts
--      show on its pages. The terms are moderation_term rows of a new kind, 'betting'; the site's twin is
--      apps/web/lib/moderation/check.ts (wordlist.json, the shared vectors.json).
--   3. The owner can hide a post and mute an account by hand, and sees every flagged post that is not hidden yet, each
--      change written to audit_log (ADR 0061). Nothing waits on him: flags still hide posts on their own.
--   4. Fan score reports listed for the owner beside the corrections (ADR 0062). A report still never changes a game: the
--      table is append-only and no function writes game from it; the list is read-only.

-- -------------------------------------------------------------------------------------------------- 1. per minute
-- The same signature as migration 0013's, so every caller is unchanged. The callers pass their 10-minute and 24-hour
-- counts; the 1-minute count is read here, for auth.uid() (every caller ran fan_actor() first, which sets nothing else).
-- Limits per minute, then 10 minutes, then 24 hours; the first number is a new account's (under 7 days):
--   post (new posts, replies and edits): 2/4, 3/8, 12/100; thread: 1/2, 1/3, 3/20; flag: 3/5, 5/10, 20/100;
--   report: 2/3, 2/5, 6/30.
create or replace function fan_rate_check(p_kind text, p_established boolean, p_recent int, p_day int) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  lim int[];
  uid uuid := auth.uid();
  since timestamptz := now() - interval '1 minute';
  minute_n int;
begin
  lim := case p_kind || ':' || p_established::text
    when 'post:false' then array[3, 12, 2]
    when 'post:true' then array[8, 100, 4]
    when 'thread:false' then array[1, 3, 1]
    when 'thread:true' then array[3, 20, 2]
    when 'flag:false' then array[5, 20, 3]
    when 'flag:true' then array[10, 100, 5]
    when 'report:false' then array[2, 6, 2]
    when 'report:true' then array[5, 30, 3]
  end;
  if lim is null then raise exception 'fan_rate_check: unknown kind %', p_kind; end if;
  if p_recent >= lim[1] or p_day >= lim[2] then raise exception 'rate_limited'; end if;
  minute_n := case p_kind
    when 'post' then (select count(*) from post where author_id = uid and created_at > since)
                   + (select count(*) from post_edit e join post p on p.id = e.post_id where p.author_id = uid and e.edited_at > since)
    when 'thread' then (select count(*) from post where author_id = uid and title is not null and created_at > since)
    when 'flag' then (select count(*) from post_flag where flagger_id = uid and created_at > since)
    when 'report' then (select count(*) from fan_score_report where reporter_id = uid and reported_at > since)
  end;
  if minute_n >= lim[3] then raise exception 'rate_limited'; end if;
end
$$;
revoke all on function fan_rate_check(text, boolean, int, int) from public;

-- ------------------------------------------------------------------------------------------------------ 2. betting
alter table moderation_term drop constraint moderation_term_kind_check;
alter table moderation_term add constraint moderation_term_kind_check check (kind in ('word', 'squash', 'threat', 'betting'));
-- Whole words or phrases on the folded text, as kind word is matched. "bet" alone ("I bet we win"), "spread" ("spread
-- offense"), "line" and "pick" ("offensive line", "pick six") are ordinary football talk and are left out.
insert into moderation_term (kind, term) values
  ('betting', 'against the spread'),
  ('betting', 'betmgm'),
  ('betting', 'bets'),
  ('betting', 'bettor'),
  ('betting', 'bettors'),
  ('betting', 'betting'),
  ('betting', 'bookie'),
  ('betting', 'bookies'),
  ('betting', 'bookmaker'),
  ('betting', 'bookmakers'),
  ('betting', 'cover the spread'),
  ('betting', 'covered the spread'),
  ('betting', 'draftkings'),
  ('betting', 'fanduel'),
  ('betting', 'gamble'),
  ('betting', 'gambler'),
  ('betting', 'gambling'),
  ('betting', 'money line'),
  ('betting', 'moneyline'),
  ('betting', 'odds'),
  ('betting', 'over under'),
  ('betting', 'parlay'),
  ('betting', 'parlays'),
  ('betting', 'point spread'),
  ('betting', 'sportsbook'),
  ('betting', 'sportsbooks'),
  ('betting', 'wager'),
  ('betting', 'wagered'),
  ('betting', 'wagering'),
  ('betting', 'wagers');

-- True when the folded text holds a betting term as a whole word or phrase. Twin of isBetting() in check.ts.
create function moderation_betting(p_text text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from moderation_term t
                  where t.kind = 'betting' and position(' ' || t.term || ' ' in ' ' || moderation_normalize(p_text) || ' ') > 0)
$$;
revoke all on function moderation_betting(text) from public;

-- Migration 0013's check with betting talk refused after slurs and threats. Same signature, so every caller is unchanged.
create or replace function post_text_check(p_text text, p_established boolean, p_max int default 2000) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t text := btrim(coalesce(p_text, ''));
  links int;
begin
  if t = '' or char_length(t) > p_max or t ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f‪-‮⁦-⁯]'
     or moderation_normalize(t) = '' then return 'bad_text'; end if;
  if moderation_blocked(t) then return 'blocked_text'; end if;
  if moderation_betting(t) then return 'betting_text'; end if;
  links := post_link_count(t);
  if not p_established and (links > 0 or moderation_strip(t) ~ '://|www\.') then return 'links_not_allowed'; end if;
  if links > 2 then return 'too_many_links'; end if;
  return null;
end
$$;
revoke all on function post_text_check(text, boolean, int) from public;

-- ------------------------------------------------------------------------------------------- 3. the owner's tools
-- Hide a post by hand. A post the owner hides is not "cleared", so flags and edits work on it as on any hidden post; showing
-- it again (admin_unhide_post) clears it. It counts toward its author's automatic mute like a post flags hid.
create function admin_hide_post(p_post uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  update post set hidden_at = now(), cleared_at = null where id = p_post and hidden_at is null;
  if not found then raise exception 'not_found'; end if;
  insert into audit_log (actor, entity, entity_id, before, after, reason)
    values (auth.uid(), 'post', p_post, '{"hidden": false}', '{"hidden": true, "by": "owner"}', left(p_reason, 500));
end
$$;

-- Mute an account by hand for 1 to 90 days (from now; a longer mute already set is kept). A ban is for longer.
create function admin_mute(p_user uuid, p_days int, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was timestamptz;
  v_until timestamptz;
begin
  perform admin_guard();
  if p_days is null or p_days not between 1 and 90 then raise exception 'bad_days'; end if;
  select muted_until into was from profile where user_id = p_user for update;
  if not found then raise exception 'not_found'; end if;
  v_until := now() + make_interval(days => p_days);
  if was is not null and was >= v_until then raise exception 'not_found'; end if;
  update profile set muted_until = v_until where user_id = p_user;
  insert into audit_log (actor, entity, entity_id, before, after, reason)
    values (auth.uid(), 'profile', p_user, jsonb_build_object('muted_until', was), jsonb_build_object('muted_until', v_until), left(p_reason, 500));
end
$$;

-- Migration 0013's overview with one more list: posts flagged at least once and not hidden, most flags first. Every flag
-- shows here, a new account's or a signed-in fan's whose flag does not count toward hiding (counted: the ones that do).
-- A post the owner cleared shows again only once someone flags it after he cleared it.
create or replace function admin_moderation_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  return jsonb_build_object(
    'hidden_posts', coalesce((select jsonb_agg(h order by h.hidden_at desc) from (
        select p.id, p.author_id, pr.display_name as author, p.game_key, p.thread_id, p.title, p.body, p.hidden_at,
               (select count(*) from post_flag f where f.post_id = p.id) as flags
          from post p join profile pr on pr.user_id = p.author_id where p.hidden_at is not null
         order by p.hidden_at desc limit 200) h), '[]'),
    'flagged_posts', coalesce((select jsonb_agg(q order by q.flags desc, q.last_flag_at desc) from (
        select p.id, p.author_id, pr.display_name as author, p.game_key, p.thread_id, p.title, p.body, p.created_at,
               count(f.*)::int as flags,
               count(f.*) filter (where fp.created_at <= now() - interval '7 days' and not fp.banned
                                    and (fp.muted_until is null or fp.muted_until <= now()))::int as counted,
               max(f.created_at) as last_flag_at
          from post p
          join profile pr on pr.user_id = p.author_id
          join post_flag f on f.post_id = p.id and (p.cleared_at is null or f.created_at > p.cleared_at)
          join profile fp on fp.user_id = f.flagger_id
         where p.hidden_at is null and not pr.banned
         group by p.id, pr.display_name
         order by count(f.*) desc, max(f.created_at) desc limit 200) q), '[]'),
    'restricted', coalesce((select jsonb_agg(r) from (
        select user_id, display_name, muted_until, banned from profile
         where banned or muted_until > now() order by display_name limit 200) r), '[]'));
end
$$;

-- --------------------------------------------------------------------------------------- 4. fan score reports
-- The owner's read-only list of games fans reported in the last 60 days, newest report first: the game's page address,
-- its status and score as the database has it, and each reported score with how many reports, how many of them count
-- (established, not banned), and whether it disagrees with the game's final. Never who reported. It changes nothing: a
-- correction is still the owner's own, made through the corrections form.
create function admin_fan_score_reports() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_guard();
  return coalesce((select jsonb_agg(g order by g.last_report_at desc) from (
      select gm.id,
             case when gm.playoff_round is null then gm.game_date::text else gm.season::text || '-' || gm.playoff_round end
               || '-' || pa.slug || '-at-' || ph.slug as game_key,
             gm.game_date, ph.slug as home, pa.slug as away, gm.status, gm.home_score, gm.away_score,
             max(r.reported_at) as last_report_at,
             (select jsonb_agg(s order by s.reports desc) from (
                select r2.home_score, r2.away_score, count(*)::int as reports,
                       count(*) filter (where r2.established and (p2.user_id is null or not p2.banned))::int as counted,
                       (gm.status = 'final' and gm.home_score is not null
                        and (r2.home_score, r2.away_score) is distinct from (gm.home_score, gm.away_score)) as disagrees
                  from fan_score_report r2 left join profile p2 on p2.user_id = r2.reporter_id
                 where r2.game_id = gm.id
                 group by r2.home_score, r2.away_score) s) as scores
        from fan_score_report r
        join game gm on gm.id = r.game_id
        join team_season h on h.id = gm.home_ts join program ph on ph.id = h.program_id
        join team_season a on a.id = gm.away_ts join program pa on pa.id = a.program_id
       where r.reported_at > now() - interval '60 days'
       group by gm.id, ph.slug, pa.slug
       order by max(r.reported_at) desc limit 200) g), '[]');
end
$$;

revoke all on function admin_hide_post(uuid, text) from public;
revoke all on function admin_mute(uuid, int, text) from public;
revoke all on function admin_moderation_overview() from public;
revoke all on function admin_fan_score_reports() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function admin_hide_post(uuid, text) to authenticated;
    grant execute on function admin_mute(uuid, int, text) to authenticated;
    grant execute on function admin_moderation_overview() to authenticated;
    grant execute on function admin_fan_score_reports() to authenticated;
  end if;
end
$$;
