-- The Account Center (ADR 0058): one page where a signed-in fan sees and changes what the site holds about them. This migration is
-- its database half: when the display name last changed, a label and a mute list on each linked browser, and the functions the
-- page calls. Every function is security definer, pins search_path, acts on auth.uid()'s own rows alone (another account's id,
-- endpoint or device id changes nothing and shows nothing), and is granted to the signed-in role only (as 0022 and 0023 did).
--
-- Nothing here returns the birth year (ADR 0018), a push endpoint, a push key or an email unsubscribe token. The page learns which
-- browser is "this one" by asking this_device(endpoint): the endpoint goes in, a random device id comes out, and the endpoint is
-- never sent back (a push endpoint is a capability URL, ADR 0054).

-- ---- Columns ---------------------------------------------------------------------------------------------------------------

-- A display name may change once every 30 days. Null until the first change, so the first change is free.
alter table profile add column name_changed_at timestamptz;

-- A device id the page can name without the endpoint, a short label ("Chrome on iPhone", never the User-Agent), when the browser
-- was linked, and the teams this browser is muted for. A volatile default is evaluated once per existing row, so every
-- subscription already there gets its own id.
alter table push_subscription add column id uuid not null default gen_random_uuid();
alter table push_subscription add constraint push_subscription_id_key unique (id);
alter table push_subscription add column device_label text check (device_label is null or char_length(device_label) between 1 and 40);
alter table push_subscription add column linked_at timestamptz;
alter table push_subscription add column muted text[] not null default '{}' check (cardinality(muted) <= 100);
comment on column push_subscription.id is 'A device id for the account page, so no endpoint ever leaves the database.';
comment on column push_subscription.device_label is 'Derived from the browser''s User-Agent when it was linked ("Chrome on iPhone"); the User-Agent itself is never stored. 40 characters at most.';
comment on column push_subscription.linked_at is 'When this browser was linked to the account (rows linked before this column: approximated by created_at). updated_at is "last used".';
comment on column push_subscription.muted is 'Program slugs this browser is not alerted for, though the account follows them (the sender, tools/push/send-finals.mjs, skips them).';
update push_subscription set linked_at = created_at where user_id is not null;

-- A browser that leaves an account (sign-out) or is linked to another one starts clean: the earlier account's label and mutes
-- must not follow the browser to whoever links it next. (A relink by the same account leaves user_id as it was, so nothing resets.)
create function push_subscription_relink_reset() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.muted := '{}';
  new.device_label := null;
  new.linked_at := null;
  return new;
end
$$;
create trigger push_subscription_relink before update on push_subscription
  for each row when (old.user_id is distinct from new.user_id) execute function push_subscription_relink_reset();

-- ---- The account --------------------------------------------------------------------------------------------------------

-- The signed-in fan's profile as the page shows it: the display name, when they joined, when the name last changed, and the day
-- the next change is allowed (null when one is allowed now). Never the birth year. No rows before sign-up is finished.
create function my_account()
returns table (display_name text, joined_at timestamptz, name_changed_at timestamptz, next_name_change_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'my_account: not signed in' using errcode = '42501';
  end if;
  return query
    select p.display_name, p.created_at, p.name_changed_at,
           case when p.name_changed_at is not null and p.name_changed_at + interval '30 days' > now() then p.name_changed_at + interval '30 days' end
      from profile p where p.user_id = auth.uid();
end
$$;

-- Change the display name: the same shape, word list, reserved names and uniqueness as sign-up (create_profile, migrations 0011
-- and 0013), and at most once every 30 days. Returns the day the next change is allowed. Naming the name already held changes
-- nothing and does not use the change. Errors, all with a short token in the message:
--   name_too_soon  (55000, the date the next change opens in DETAIL, an ISO timestamp)
--   name_taken     (23505)     name_shape, name_not_allowed, name_reserved  (23514)
-- A banned account cannot rename itself (the name is how a ban is recognised). No audit_log row: that table is append-only and
-- outlives the account, and a fan's own rename is not an owner override; the date on the profile is the record.
create function change_display_name(p_name text) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  p profile%rowtype;
  wanted text := btrim(p_name);
  opens timestamptz;
begin
  if uid is null then
    raise exception 'change_display_name: not signed in' using errcode = '42501';
  end if;
  -- The row lock makes the 30-day rule hold when two requests arrive together.
  select * into p from profile where user_id = uid for update;
  if not found then
    raise exception 'change_display_name: finish sign-up first' using errcode = '42501';
  end if;
  if p.banned then
    raise exception 'change_display_name: banned' using errcode = '42501';
  end if;
  if p.name_changed_at is not null and p.name_changed_at + interval '30 days' > now() then
    opens := p.name_changed_at + interval '30 days';
  end if;
  if wanted is not distinct from p.display_name then
    return opens;
  end if;
  if opens is not null then
    raise exception 'change_display_name: name_too_soon' using errcode = '55000', detail = opens::text;
  end if;
  if wanted is null or wanted !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$' then
    raise exception 'change_display_name: name_shape' using errcode = '23514';
  end if;
  if moderation_name_blocked(wanted) then
    raise exception 'change_display_name: name_not_allowed' using errcode = '23514';
  end if;
  if moderation_reserved_name(wanted) then
    raise exception 'change_display_name: name_reserved' using errcode = '23514';
  end if;
  begin
    update profile set display_name = wanted, name_changed_at = now() where user_id = uid;
  exception when unique_violation then
    raise exception 'change_display_name: name_taken' using errcode = '23505';
  end;
  return now() + interval '30 days';
end
$$;

-- ---- Devices (linked browsers) ------------------------------------------------------------------------------------------

-- Give the caller's own linked browser its label, and the day it was linked if it has none. The link route calls it right after
-- link_push_subscription, with a label derived from the User-Agent (the User-Agent is never stored). A label is plain text of
-- at most 40 characters; null leaves the label as it is. The endpoint must be the caller's own linked row, or nothing happens.
create function label_push_subscription(p_endpoint text, p_label text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  lbl text := btrim(p_label);
begin
  if uid is null then
    raise exception 'label_push_subscription: not signed in' using errcode = '42501';
  end if;
  if lbl is not null and lbl !~ '^[A-Za-z0-9 ,.()+/-]{1,40}$' then
    raise exception 'label_push_subscription: not a label' using errcode = '22023';
  end if;
  update push_subscription
     set device_label = coalesce(lbl, device_label), linked_at = coalesce(linked_at, now())
   where endpoint = p_endpoint and user_id = uid;
end
$$;

-- The caller's linked browsers, most recently used first: a device id, a label, when it was linked and when it was last used.
-- Never the endpoint or the keys.
create function my_devices() returns table (id uuid, label text, linked_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'my_devices: not signed in' using errcode = '42501';
  end if;
  return query
    select s.id, coalesce(s.device_label, 'A browser'), coalesce(s.linked_at, s.created_at), s.updated_at
      from push_subscription s where s.user_id = auth.uid() order by s.updated_at desc, s.id;
end
$$;

-- Which of the caller's devices this browser is: the endpoint the browser holds in, its device id out (null when it is not
-- linked to this account). Knowing the endpoint is the proof it is this browser's; the endpoint is never returned.
create function this_device(p_endpoint text) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'this_device: not signed in' using errcode = '42501';
  end if;
  return (select s.id from push_subscription s where s.endpoint = p_endpoint and s.user_id = auth.uid());
end
$$;

-- Remove one of the caller's devices: its subscription row is deleted, so alerts to that browser stop. Any other id changes nothing.
create function remove_my_device(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'remove_my_device: not signed in' using errcode = '42501';
  end if;
  delete from push_subscription where id = p_id and user_id = auth.uid();
end
$$;

-- Remove every device of the account (the first step of "sign out of all devices"). Returns how many were removed.
create function remove_all_my_devices() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'remove_all_my_devices: not signed in' using errcode = '42501';
  end if;
  delete from push_subscription where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end
$$;

-- ---- Per-team mutes on one browser --------------------------------------------------------------------------------------

-- Mute (or unmute) one team's final-score alerts on the browser holding p_endpoint, which must be the caller's own linked row.
-- Returns that browser's muted teams afterwards, or null when the endpoint is not a browser linked to this account (nothing
-- changes). The account's follows stay as they are: a muted team is still followed, this browser just stays quiet about it.
create function set_push_mute(p_endpoint text, p_slug text, p_muted boolean) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  was text[];
  result text[];
begin
  if uid is null then
    raise exception 'set_push_mute: not signed in' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) > 80 or p_muted is null then
    raise exception 'set_push_mute: not a program slug' using errcode = '22023';
  end if;
  select s.muted into was from push_subscription s where s.endpoint = p_endpoint and s.user_id = uid for update;
  if not found then
    return null;
  end if;
  if p_muted then
    select coalesce(array_agg(distinct m order by m), '{}') into result from unnest(was || p_slug) m;
  else
    result := array_remove(was, p_slug);
  end if;
  if cardinality(result) > 100 then
    raise exception 'set_push_mute: at most 100 muted teams' using errcode = '53400';
  end if;
  update push_subscription set muted = result where endpoint = p_endpoint and user_id = uid;
  return result;
end
$$;

-- The teams muted on the browser holding p_endpoint (the caller's own linked row), or null when it is not linked to this account.
create function my_push_mutes(p_endpoint text) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'my_push_mutes: not signed in' using errcode = '42501';
  end if;
  return (select s.muted from push_subscription s where s.endpoint = p_endpoint and s.user_id = auth.uid());
end
$$;

-- ---- Download my data -----------------------------------------------------------------------------------------------------

-- Everything the database holds about the caller that is theirs to read, as one JSON document. The email address and the sign-in
-- providers live in Supabase Auth, so the route adds them. NEVER here: the birth year (a sentence says it is stored and why),
-- push endpoints and keys, email unsubscribe tokens. Posts include any a moderator hid (flagged `hidden`): they are the person's own words.
create function export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  p profile%rowtype;
begin
  if uid is null then
    raise exception 'export_my_data: not signed in' using errcode = '42501';
  end if;
  select * into p from profile where user_id = uid;
  if not found then
    raise exception 'export_my_data: finish sign-up first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', jsonb_build_object(
      'display_name', p.display_name,
      'joined_at', p.created_at,
      'name_changed_at', p.name_changed_at,
      'birth_year', 'Stored to check your age at sign-up and for email alerts. It is never shown to anyone and is not included in this file.'),
    'follows', coalesce((select jsonb_agg(jsonb_build_object('program', f.program_slug, 'followed_at', f.created_at) order by f.created_at, f.program_slug)
                           from follow f where f.user_id = uid), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('label', coalesce(s.device_label, 'A browser'), 'linked_at', coalesce(s.linked_at, s.created_at),
                                                           'last_used_at', s.updated_at, 'muted_teams', s.muted) order by s.updated_at desc, s.id)
                           from push_subscription s where s.user_id = uid), '[]'::jsonb),
    'email_settings', coalesce((select jsonb_agg(jsonb_build_object('kind', o.kind, 'team', o.program_slug, 'since', o.created_at) order by o.kind, o.program_slug)
                                  from email_optin o where o.user_id = uid), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('game', x.game_key, 'text', x.body, 'posted_at', x.created_at, 'edited_at', x.edited_at,
                                                             'hidden', x.hidden_at is not null) order by x.created_at, x.id)
                            from post x where x.author_id = uid and x.game_key is not null), '[]'::jsonb),
    'forum_threads', coalesce((select jsonb_agg(jsonb_build_object('board', t.board, 'title', x.title, 'text', x.body, 'posted_at', x.created_at,
                                                                  'edited_at', x.edited_at, 'hidden', x.hidden_at is not null) order by x.created_at, x.id)
                                 from post x join forum_thread t on t.id = x.thread_id where x.author_id = uid and x.title is not null), '[]'::jsonb),
    'forum_replies', coalesce((select jsonb_agg(jsonb_build_object('thread', x.thread_id, 'text', x.body, 'posted_at', x.created_at,
                                                                  'edited_at', x.edited_at, 'hidden', x.hidden_at is not null) order by x.created_at, x.id)
                                 from post x where x.author_id = uid and x.thread_id is not null and x.title is null), '[]'::jsonb),
    'score_reports', coalesce((select jsonb_agg(jsonb_build_object('game', case when g.playoff_round is null then g.game_date::text else g.season::text || '-' || g.playoff_round end
                                                                          || '-' || pa.slug || '-at-' || ph.slug,
                                                                  'home_score', r.home_score, 'away_score', r.away_score, 'reported_at', r.reported_at)
                                                  order by r.reported_at, r.id)
                                 from fan_score_report r
                                 join game g on g.id = r.game_id
                                 join team_season h on h.id = g.home_ts join program ph on ph.id = h.program_id
                                 join team_season a on a.id = g.away_ts join program pa on pa.id = a.program_id
                                where r.reporter_id = uid), '[]'::jsonb)
  );
end
$$;

-- ---- My activity ----------------------------------------------------------------------------------------------------------

-- The caller's own comments, forum threads and replies, and score reports, newest first, at most p_limit (1 to 100, default 20),
-- each with a short excerpt and the page it lives on. It shows what the public could see of them: a post a moderator hid, a post
-- by a banned account, and a reply in a thread that is hidden are left out, exactly as the public reads leave them out
-- (list_comments, forum_posts). A score report is never shown on its own, but it is the reporter's own, so it is listed.
-- The site hides the whole section while posts are off (FAN_POSTS); this function does not look at that switch.
-- href is null for a score report whose game no longer resolves to a page.
create function my_activity(p_limit int default 20)
returns table (kind text, id uuid, body_excerpt text, created_at timestamptz, href text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  lim int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if uid is null then
    raise exception 'my_activity: not signed in' using errcode = '42501';
  end if;
  return query
    select a.k, a.pid,
           case when char_length(a.raw) > 140 then left(a.raw, 137) || '...' else a.raw end,
           a.at, a.link
      from (
        select 'comment'::text as k, p.id as pid, btrim(regexp_replace(p.body, '\s+', ' ', 'g')) as raw, p.created_at as at, '/scores/' || p.game_key as link
          from post p join profile pr on pr.user_id = p.author_id
         where p.author_id = uid and p.game_key is not null and p.hidden_at is null and not pr.banned
        union all
        select case when p.title is not null then 'thread' else 'reply' end, p.id, btrim(regexp_replace(coalesce(p.title, p.body), '\s+', ' ', 'g')), p.created_at,
               '/forums/thread/' || p.thread_id::text
          from post p join profile pr on pr.user_id = p.author_id
         where p.author_id = uid and p.thread_id is not null and p.hidden_at is null and not pr.banned and forum_thread_visible(p.thread_id)
        union all
        select 'score_report', r.id,
               'Score report: ' || pa.slug || ' ' || r.away_score || ', ' || ph.slug || ' ' || r.home_score, r.reported_at,
               '/scores/' || (case when g.playoff_round is null then g.game_date::text else g.season::text || '-' || g.playoff_round end || '-' || pa.slug || '-at-' || ph.slug)
          from fan_score_report r
          join game g on g.id = r.game_id
          join team_season h on h.id = g.home_ts join program ph on ph.id = h.program_id
          join team_season w on w.id = g.away_ts join program pa on pa.id = w.program_id
         where r.reporter_id = uid
      ) a
     order by a.at desc, a.pid
     limit lim;
end
$$;

-- ---- Access -----------------------------------------------------------------------------------------------------------------

revoke all on function my_account() from public;
revoke all on function change_display_name(text) from public;
revoke all on function label_push_subscription(text, text) from public;
revoke all on function my_devices() from public;
revoke all on function this_device(text) from public;
revoke all on function remove_my_device(uuid) from public;
revoke all on function remove_all_my_devices() from public;
revoke all on function set_push_mute(text, text, boolean) from public;
revoke all on function my_push_mutes(text) from public;
revoke all on function export_my_data() from public;
revoke all on function my_activity(int) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function my_account() to authenticated;
    grant execute on function change_display_name(text) to authenticated;
    grant execute on function label_push_subscription(text, text) to authenticated;
    grant execute on function my_devices() to authenticated;
    grant execute on function this_device(text) to authenticated;
    grant execute on function remove_my_device(uuid) to authenticated;
    grant execute on function remove_all_my_devices() to authenticated;
    grant execute on function set_push_mute(text, text, boolean) to authenticated;
    grant execute on function my_push_mutes(text) to authenticated;
    grant execute on function export_my_data() to authenticated;
    grant execute on function my_activity(int) to authenticated;
  end if;
end
$$;
