-- Email alerts for followed teams (ADR 0053). A signed-in fan who is an adult (see email_adult) may opt in to emails about
-- the teams the account follows: a game's kickoff, its final, and the next-round game once the bracket sets it. Never on by
-- default. The tables are built for more than one kind of email: `email_kind` names it, so a later kind (the weekly digest)
-- adds only its own sender.
--
-- Nothing here gives Supabase's API roles a table right (migration 0005). Like every table: row-level security on, no policy,
-- no grant. The site reaches the opt-ins through three functions, each acting on auth.uid()'s own rows (email_my_settings,
-- email_set_optins) or on a random unsubscribe token (email_unsubscribe, below). The email addresses stay in Supabase Auth: the
-- sender reads them through the functions at the end of this file, which only the role `email_sender` may run.
--
-- Deleting the account (migration 0011's delete_my_account) deletes the profile, and the foreign keys below take the opt-ins
-- and the record of what was sent with it. email_game_event holds public game facts only and is not about anyone.

create type email_kind as enum ('game_alerts', 'weekly_digest');

-- Which teams a fan wants email about. program_slug '*' means every team the account follows (now and later); a slug is
-- one team, which the fan must follow. Unfollowing a team stops its emails whatever is here (the sender joins `follow`).
create table email_optin (
  user_id uuid not null references profile (user_id) on delete cascade,
  kind email_kind not null,
  program_slug text not null check (program_slug = '*' or (program_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(program_slug) <= 80)),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, program_slug)
);
alter table email_optin enable row level security;
comment on table email_optin is
  'A fan''s email opt-ins: a kind and a followed team, or ''*'' for every followed team. Own rows only, through email_set_optins and email_my_settings.';

-- What was sent, so nothing goes twice. One row per user and email: item is '<alert>:<event_key>' for a game alert
-- (a digest would use its week). Append-only in practice: no function updates or deletes a row; it goes with the account.
create table email_sent (
  user_id uuid not null references profile (user_id) on delete cascade,
  kind email_kind not null,
  item text not null check (length(item) between 1 and 260),
  -- 'rejected': the email service refused this one for good (a 4xx that is not "slow down"); kept so it is not tried again every run.
  outcome text not null default 'sent' check (outcome in ('sent', 'rejected')),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, item)
);
alter table email_sent enable row level security;
comment on table email_sent is 'Emails already sent, by user, kind and item (game alerts: alert:event_key). Appended by email_mark_sent only.';

-- The capability behind every unsubscribe link: one random token per fan and kind, made when they first opt in and kept (so an old
-- email's link still answers) until the account is deleted. Closed to the API roles like every table; the only function that
-- returns a token is email_pending_game_alerts, which only the sender role can run. Knowing the token is the whole proof.
create table email_unsubscribe_token (
  user_id uuid not null references profile (user_id) on delete cascade,
  kind email_kind not null,
  token uuid not null unique default gen_random_uuid(),
  primary key (user_id, kind)
);
alter table email_unsubscribe_token enable row level security;
comment on table email_unsubscribe_token is 'One random unsubscribe token per fan and email kind. Never returned to the API roles; read by email_unsubscribe and email_pending_game_alerts.';

-- The game events the sender has seen (kickoff, final, next-round game), each once, with when it was first seen. A fan is
-- emailed only about an event first seen after they opted in and followed the team, and within the last 24 hours (Resend's
-- idempotency window), so turning the feature on never sends the season's past. Public facts only: two program slugs and
-- the teams' names as the pages spell them. The very first recording is a baseline: first_seen_at is -infinity, nothing is due.
create table email_game_event (
  alert text not null check (alert in ('kickoff', 'final', 'next_game')),
  -- A final or kickoff: the game's key (lib/games.ts gameKey: date, then both slugs, sorted). A next-round game: season,
  -- round and both slugs.
  event_key text not null check (length(event_key) <= 200 and event_key ~ '^[a-z0-9|:._-]+$'),
  home_slug text not null check (home_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(home_slug) <= 80),
  away_slug text not null check (away_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(away_slug) <= 80),
  home_name text not null check (length(home_name) between 1 and 80 and home_name !~ '[<>\r\n]'),
  away_name text not null check (length(away_name) between 1 and 80 and away_name !~ '[<>\r\n]'),
  round text check (round is null or round ~ '^[a-z0-9-]{1,20}$'),
  home_score integer check (home_score between 0 and 200),
  away_score integer check (away_score between 0 and 200),
  kickoff_at timestamptz,
  first_seen_at timestamptz not null default now(),
  primary key (alert, event_key)
);
alter table email_game_event enable row level security;
comment on table email_game_event is 'Game events the email sender has seen, once each (kickoff, final, next-round game). Public facts only.';

-- An adult, for sure: a birth year gives an age within a year, and no minor's data goes to a third party (ADR 0018), so
-- only a birth year at least 19 years back counts (Central time, as create_profile does). Not callable by the API roles.
create function email_adult(p_birth_year int) returns boolean
language sql stable as $$
  select p_birth_year is not null and extract(year from now() at time zone 'America/Chicago')::int - p_birth_year >= 19
$$;
revoke all on function email_adult(int) from public;

-- The signed-in fan's own email settings: whether they may opt in, and what they have opted in to (a row each; none when
-- nothing is on). Never the birth year or the address.
create function email_my_settings() returns table (eligible boolean, kind text, program_slug text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'email_my_settings: not signed in' using errcode = '42501';
  end if;
  return query
    select email_adult(p.birth_year), o.kind::text, o.program_slug
      from profile p left join email_optin o on o.user_id = p.user_id
     where p.user_id = uid
     order by o.kind, (o.program_slug = '*') desc, o.program_slug;
end
$$;

-- Replace what this fan has opted in to for one kind: p_slugs holds followed teams and/or '*'. An empty list turns the
-- kind off. Refuses a fan who is not an adult, is banned, or names a team the account does not follow. Rows kept keep their
-- date, which is what the sender measures an event against.
create function email_set_optins(p_kind text, p_slugs text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  slugs text[];
  k email_kind;
begin
  if uid is null then
    raise exception 'email_set_optins: not signed in' using errcode = '42501';
  end if;
  begin
    k := p_kind::email_kind;
  exception when invalid_text_representation then
    raise exception 'email_set_optins: not a kind' using errcode = '22023';
  end;
  select coalesce(array_agg(distinct s order by s), '{}') into slugs from unnest(coalesce(p_slugs, '{}')) s;
  if cardinality(slugs) > 101 or exists (select 1 from unnest(slugs) s where s is null or (s <> '*' and (s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(s) > 80))) then
    raise exception 'email_set_optins: not a team' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('email:' || uid::text, 0));
  if cardinality(slugs) > 0 and not exists (select 1 from profile where user_id = uid and not banned and email_adult(birth_year)) then
    raise exception 'email_set_optins: not available to this account' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(slugs) s where s <> '*' and not exists (select 1 from follow f where f.user_id = uid and f.program_slug = s)) then
    raise exception 'email_set_optins: follow the team first' using errcode = '22023';
  end if;
  delete from email_optin where user_id = uid and kind = k and not (program_slug = any(slugs));
  if cardinality(slugs) > 0 then
    insert into email_unsubscribe_token (user_id, kind) values (uid, k) on conflict do nothing;
  end if;
  insert into email_optin (user_id, kind, program_slug) select uid, k, s from unnest(slugs) s on conflict do nothing;
end
$$;

-- One-click unsubscribe (RFC 8058): no session. The link in an email carries only the fan's random token (email_unsubscribe_token);
-- the site's route POSTs it here as the anonymous role with the public key, no service key. It turns off that fan's opt-ins of
-- that token's kind, and answers the same, with nothing returned, for a token that matches nothing, so it cannot be used to learn
-- who has an account or an opt-in. Idempotent. Nothing a caller can send names a fan or a kind: only a token someone was emailed
-- (122 random bits) does anything.
create function email_unsubscribe(p_token uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from email_optin o using email_unsubscribe_token t
   where t.token = p_token and o.user_id = t.user_id and o.kind = t.kind;
end
$$;

revoke all on function email_my_settings() from public;
revoke all on function email_set_optins(text, text[]) from public;
revoke all on function email_unsubscribe(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function email_my_settings() to authenticated;
    grant execute on function email_set_optins(text, text[]) to authenticated;
    grant execute on function email_unsubscribe(uuid) to anon, authenticated;
  end if;
end
$$;

-- ---- The sender (tools/email, run by the Email alerts workflow) -------------------------------------------------------
-- A role of its own, with no table right and no login until the owner gives it a password (docs/email-alerts.md): it can run the
-- three functions below and nothing else. The functions run as the database owner, so they can read auth.users for the
-- one address a due email needs; the role itself never can. Supabase's API roles cannot run them (checkLive fails if they can).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'email_sender') then
    create role email_sender nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls connection limit 3;
  end if;
end
$$;
alter role email_sender set statement_timeout = '30s';

-- Record the game events a run found (a jsonb array of {alert, event_key, home_slug, away_slug, home_name, away_name, round,
-- home_score, away_score, kickoff_at}), each once. Returns how many were new. The first call ever is a baseline (see
-- email_game_event); so is any call with p_baseline set, which the owner uses to skip past a backlog.
create function email_record_game_events(p_events jsonb, p_baseline boolean default false) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  baseline boolean := p_baseline or not exists (select 1 from email_game_event);
  added integer;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 3000 then
    raise exception 'email_record_game_events: not a list of at most 3000 events' using errcode = '22023';
  end if;
  insert into email_game_event (alert, event_key, home_slug, away_slug, home_name, away_name, round, home_score, away_score, kickoff_at, first_seen_at)
  select e.alert, e.event_key, e.home_slug, e.away_slug, e.home_name, e.away_name, e.round, e.home_score, e.away_score, e.kickoff_at,
         case when baseline then '-infinity'::timestamptz else now() end
    from jsonb_to_recordset(p_events) as e(alert text, event_key text, home_slug text, away_slug text, home_name text, away_name text,
                                           round text, home_score int, away_score int, kickoff_at timestamptz)
  on conflict (alert, event_key) do nothing;
  get diagnostics added = row_count;
  return added;
end
$$;

-- Who is due which game alert: one row per fan and event, for events first seen in the last 24 hours, after the fan opted in
-- and followed the team, never one already sent, for adults who are not banned and whose address is confirmed. `followed_slug`
-- is the team of theirs the event is about. Returns the address (the one place it leaves Supabase Auth, to the sender) and the fan's unsubscribe token (the one function that returns it).
create function email_pending_game_alerts(p_limit integer default 500)
returns table (user_id uuid, email text, alert text, event_key text, home_slug text, away_slug text, home_name text, away_name text,
               round text, home_score integer, away_score integer, kickoff_at timestamptz, followed_slug text, unsubscribe_token uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  -- plpgsql, not sql: the body names auth.users, which the tests' plain Postgres does not have until a test makes it.
  return query
    select distinct on (f.user_id, e.alert, e.event_key)
           f.user_id, u.email::text, e.alert, e.event_key, e.home_slug, e.away_slug, e.home_name, e.away_name,
           e.round, e.home_score, e.away_score, e.kickoff_at, f.program_slug, t.token
      from email_game_event e
      join follow f on f.program_slug in (e.home_slug, e.away_slug)
      join email_optin o on o.user_id = f.user_id and o.kind = 'game_alerts' and o.program_slug in ('*', f.program_slug)
      join email_unsubscribe_token t on t.user_id = f.user_id and t.kind = 'game_alerts'
      join profile p on p.user_id = f.user_id and not p.banned and email_adult(p.birth_year)
      join auth.users u on u.id = f.user_id and u.email is not null and u.email_confirmed_at is not null
     where e.first_seen_at > now() - interval '24 hours'
       and e.first_seen_at >= greatest(f.created_at, o.created_at)
       and not exists (select 1 from email_sent s where s.user_id = f.user_id and s.kind = 'game_alerts' and s.item = e.alert || ':' || e.event_key)
     order by f.user_id, e.alert, e.event_key, f.program_slug
     limit greatest(1, least(coalesce(p_limit, 500), 2000));
end
$$;

-- Record that an email was sent, or refused for good (the only write to email_sent). Quietly does nothing for an account deleted meanwhile.
create function email_mark_sent(p_user uuid, p_kind text, p_item text, p_outcome text default 'sent') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into email_sent (user_id, kind, item, outcome)
  select p_user, p_kind::email_kind, p_item, p_outcome where exists (select 1 from profile where user_id = p_user)
  on conflict do nothing;
end
$$;

revoke all on function email_record_game_events(jsonb, boolean) from public;
revoke all on function email_pending_game_alerts(integer) from public;
revoke all on function email_mark_sent(uuid, text, text, text) from public;
grant execute on function email_record_game_events(jsonb, boolean) to email_sender;
grant execute on function email_pending_game_alerts(integer) to email_sender;
grant execute on function email_mark_sent(uuid, text, text, text) to email_sender;
