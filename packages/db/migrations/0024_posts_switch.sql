-- The posts switch (ADR 0052). Sign-in and follows launch first; comments, forum posts, flags and score reports open about a
-- week later. The site's own flag (FAN_POSTS) closes the pages and routes, but a signed-in fan holds a real Supabase session
-- and the anon key and project address are public, so the posting functions can be called straight at Supabase, past every
-- route of the site. The database therefore has its own switch, one row, closed until the owner opens it.
--
-- Every function that writes a post, a flag, a thread, a reply or a score report starts with fan_actor() (migrations 0013 to
-- 0015), so the check lives there and nothing else changes: with the switch closed each of them raises posts_closed before
-- it reads a profile, a lock or a count. The owner's overrides (admin_*) and every public read stay as they were.
--
-- The table has row-level security, no policy and no grant, like every other table: only the owner (the SQL editor, or the
-- load) can change it, and every change is written to audit_log. To open posts:
--   update site_switch set is_on = true where name = 'posts';
-- and close them again with is_on = false.

create table site_switch (
  name text primary key check (name ~ '^[a-z_]{1,40}$'),
  is_on boolean not null default false,
  changed_at timestamptz not null default now()
);
alter table site_switch enable row level security;
comment on table site_switch is 'Switches the owner flips by hand (ADR 0052). posts: fan comments, forums and score reports. Closed until opened.';
insert into site_switch (name) values ('posts');

-- Every change is logged: who is not known here (the owner changes it as the database owner), when and what are.
create function site_switch_audit() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.changed_at := now();
  if new.is_on is distinct from old.is_on then
    insert into audit_log (entity, before, after, reason)
      values ('site_switch', jsonb_build_object('name', old.name, 'on', old.is_on), jsonb_build_object('name', new.name, 'on', new.is_on), 'switch changed');
  end if;
  return new;
end
$$;
create trigger site_switch_change before update on site_switch for each row execute function site_switch_audit();
create trigger site_switch_no_delete before delete on site_switch for each row execute function forbid_change();
create trigger site_switch_no_truncate before truncate on site_switch for each statement execute function forbid_change();

-- fan_actor() as migration 0013 made it, with the switch checked first. The signature is the same, so every caller is unchanged.
create or replace function fan_actor(out uid uuid, out established boolean)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  p profile%rowtype;
begin
  if not coalesce((select is_on from site_switch where name = 'posts'), false) then raise exception 'posts_closed' using errcode = '42501'; end if;
  uid := auth.uid();
  if uid is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into p from profile where user_id = uid;
  if not found then raise exception 'profile_required' using errcode = '42501'; end if;
  if p.banned then raise exception 'banned' using errcode = '42501'; end if;
  if p.muted_until is not null and p.muted_until > now() then raise exception 'muted' using errcode = '42501'; end if;
  established := p.created_at <= now() - interval '7 days';
end
$$;
