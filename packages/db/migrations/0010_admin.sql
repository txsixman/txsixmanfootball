-- Admin console v1 (backlog item 6): one signed-in admin may append rows to audit_log, through one function, and nothing else.
--
-- Who is an admin: a row in admin_user, matched to the caller's Supabase Auth user id (auth.uid(), the id inside the
-- signed-in user's own JWT). The console also checks the same id on the server (ADMIN_USER_ID), so neither check
-- depends on public sign-ups being off: a signed-in stranger passes neither. The owner's id goes in by hand after he
-- creates his account (docs/admin-console.md); this migration inserts none.
--
-- What an admin may do: call record_admin_audit(), which appends one audit_log row with actor = auth.uid(). There is no
-- table grant, no policy and no sequence right for the API roles: a direct INSERT is refused before it reaches the
-- table, so a refused caller never burns an id (a table INSERT would call nextval() first and leave a gap). The
-- function's checks run first, then its own insert. audit_log stays append-only (its triggers, migration 0001, refuse
-- update, delete and truncate, even for the owner). Migration 0005 revoked everything else from the API roles;
-- supabase.yml's live check (load.mjs checkLive) expects nothing but the two functions below.
--
-- Supabase's auth schema does not exist on the tests' plain Postgres (PGlite). The functions are plpgsql so their
-- bodies, which call auth.uid(), are not resolved until they run; the grants are made only where the API roles exist.

create table admin_user (
  user_id uuid primary key
);
alter table admin_user enable row level security;
comment on table admin_user is
  'Supabase Auth user ids allowed to use the admin console. No policy and no grant: only is_admin() (security definer) reads it.';

create function is_admin() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return exists (select 1 from admin_user where user_id = auth.uid());
end
$$;
revoke all on function is_admin() from public;

-- Append one audit row as the signed-in admin and return its id. Refuses anyone else before touching the table, and
-- bounds what one row may hold, so a stolen admin session cannot fill the database through it.
create function record_admin_audit(p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb, p_reason text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_id bigint;
begin
  if not is_admin() then
    raise exception 'record_admin_audit: not allowed' using errcode = '42501';
  end if;
  if p_entity is null or length(p_entity) not between 1 and 64
     or length(coalesce(p_reason, '')) > 500
     or length(coalesce(p_before::text, '')) > 20000 or length(coalesce(p_after::text, '')) > 20000 then
    raise exception 'record_admin_audit: bad input' using errcode = '22023';
  end if;
  insert into audit_log (actor, entity, entity_id, before, after, reason)
  values (auth.uid(), p_entity, p_entity_id, p_before, p_after, p_reason)
  returning id into new_id;
  return new_id;
end
$$;
revoke all on function record_admin_audit(text, uuid, jsonb, jsonb, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function is_admin() to authenticated;
    grant execute on function record_admin_audit(text, uuid, jsonb, jsonb, text) to authenticated;
  end if;
end
$$;
