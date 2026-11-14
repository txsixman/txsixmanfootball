-- Push alerts tied to the account (ADR 0054). A signed-in fan's browser can be linked to the account: the account's follows
-- (migration 0012, the same on every device) then drive alerts to every linked browser of that account. A browser that is not
-- linked keeps working as migration 0008 made it, by its own programs.
--
-- The link is one nullable column, push_subscription.user_id. Nothing else about the table changes for the API roles: row-level
-- security with no policy and no table grants, so the roles reach it only through functions. push_follow and push_unfollow
-- (0008, 0018) are untouched. Three signed-in functions are new, each acting on auth.uid() alone:
--   link_push_subscription(endpoint, p256dh, auth)  links this browser's subscription to the account
--   unlink_push_subscription(endpoint)              sign-out: the account's alerts stop on that browser
-- and unfollow_program and delete_my_account are replaced (create or replace keeps their grants).
--
-- A push endpoint is a capability URL (whoever holds it can push to that browser), so as in 0008 knowing it is the proof of
-- owning the browser. The site calls link_push_subscription on the visitor's own session, server side, so the database ties
-- the endpoint to auth.uid() and never to a user id the browser sends.

alter table push_subscription add column user_id uuid references profile (user_id) on delete cascade;
create index push_subscription_user_idx on push_subscription (user_id) where user_id is not null;
comment on column push_subscription.user_id is
  'The account this browser is linked to (null: a per-browser subscription, as before). Linked rows are alerted for the account''s follows as well as their own programs; deleted with the account.';

-- A linked browser needs no programs of its own (the account's follows are the source), so `programs` may now be empty; an
-- unlinked one still needs at least one, as before (an unlinked empty row could never be sent anything).
alter table push_subscription drop constraint push_subscription_programs_check;
alter table push_subscription add constraint push_subscription_programs_check check (cardinality(programs) between 0 and 25);
alter table push_subscription add constraint push_subscription_unlinked_has_programs check (user_id is not null or cardinality(programs) > 0);

-- Link this browser to the signed-in fan's account. Creates the subscription row if the browser has none yet. The browser's own
-- programs (the ones it followed before it was linked) move onto the account, so nothing is lost and the account is the one
-- list: following or unfollowing on any device is what every linked browser then alerts for. A program that does not fit
-- (the account already follows 100) stays on this browser's own list, and the function returns that list so the page keeps it.
-- A browser linked to another account loses that account's link and keeps none of its programs: those were that account's
-- follows already, and handing them to this one would show them to a stranger.
-- At most 5 browsers per account: a sixth link replaces the account's least recently active one.
create function link_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  existing push_subscription;
  own text[] := '{}';
  left_over text[] := '{}';
  slug text;
  had boolean;
begin
  if uid is null then
    raise exception 'link_push_subscription: not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from profile where user_id = uid) then
    raise exception 'link_push_subscription: finish sign-up first' using errcode = '42501';
  end if;
  -- The same lock as follow_program, so the cap of 100 holds beside a follow that arrives at the same time.
  perform pg_advisory_xact_lock(hashtextextended('follow:' || uid::text, 0));
  select * into existing from push_subscription where endpoint = p_endpoint;
  had := found;
  if had then
    if existing.user_id is null or existing.user_id = uid then
      own := existing.programs;
    end if;
  elsif (select count(*) from push_subscription) >= 5000 then
    -- As push_follow (migration 0018): a full table makes room by deleting the least recently active subscription no push has reached.
    delete from push_subscription
     where endpoint = (select endpoint from push_subscription where confirmed_at is null order by updated_at, endpoint limit 1);
    if (select count(*) from push_subscription) >= 5000 then
      raise exception 'link_push_subscription: no room for new subscriptions' using errcode = '53400';
    end if;
  end if;
  if (not had or existing.user_id is distinct from uid) and (select count(*) from push_subscription where user_id = uid) >= 5 then
    delete from push_subscription
     where endpoint = (select endpoint from push_subscription where user_id = uid order by updated_at, endpoint limit 1);
  end if;
  foreach slug in array own loop
    if exists (select 1 from follow where user_id = uid and program_slug = slug) then
      continue;
    elsif (select count(*) from follow where user_id = uid) < 100 then
      insert into follow (user_id, program_slug) values (uid, slug);
    else
      left_over := left_over || slug;
    end if;
  end loop;
  insert into push_subscription (endpoint, p256dh, auth, programs, user_id)
  values (p_endpoint, p_p256dh, p_auth, left_over, uid)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, programs = excluded.programs, user_id = uid, updated_at = now();
  return left_over;
end
$$;

-- Sign-out: stop the account's alerts on this browser. Only the signed-in fan's own link can be undone: the endpoint the
-- browser sends is matched to auth.uid(), so a made-up or someone else's endpoint changes nothing. The row is deleted, unless
-- the browser still has programs of its own that did not fit on the account (see above): then it stays, unlinked, and
-- keeps alerting for those only, as any signed-out browser would.
create function unlink_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'unlink_push_subscription: not signed in' using errcode = '42501';
  end if;
  delete from push_subscription where endpoint = p_endpoint and user_id = uid and cardinality(programs) = 0;
  update push_subscription set user_id = null, updated_at = now() where endpoint = p_endpoint and user_id = uid;
end
$$;

-- Unfollow (migration 0012), and also drop the program from this account's linked browsers' own lists, so an unfollow stops
-- its alerts everywhere, even where the program was one that did not fit on the account when the browser was linked.
create or replace function unfollow_program(p_slug text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'unfollow_program: not signed in' using errcode = '42501';
  end if;
  delete from follow where user_id = auth.uid() and program_slug = p_slug;
  update push_subscription set programs = array_remove(programs, p_slug), updated_at = now()
   where user_id = auth.uid() and p_slug = any(programs);
end
$$;

-- Delete my account (migration 0012's function, kept whole): now also the account's push subscriptions, explicitly. The foreign
-- key would take them with the profile; this says it where the account's data is erased, and removes them before the profile.
create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'delete_my_account: not signed in' using errcode = '42501';
  end if;
  delete from push_subscription where user_id = uid;
  delete from profile where user_id = uid;
  if to_regclass('auth.flow_state') is not null then
    execute 'delete from auth.flow_state where user_id = $1' using uid;
  end if;
  if to_regclass('auth.audit_log_entries') is not null then
    execute 'delete from auth.audit_log_entries where payload->>''actor_id'' = $1 or payload->''traits''->>''user_id'' = $1' using uid::text;
  end if;
  if to_regclass('auth.users') is not null then
    execute 'delete from auth.users where id = $1' using uid;
  end if;
end
$$;

revoke all on function link_push_subscription(text, text, text) from public;
revoke all on function unlink_push_subscription(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') and to_regprocedure('auth.uid()') is not null then
    grant execute on function link_push_subscription(text, text, text) to authenticated;
    grant execute on function unlink_push_subscription(text) to authenticated;
  end if;
end
$$;
