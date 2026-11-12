-- Fan profiles (ADR 0018). One row per signed-in fan: a public display name, the birth year (never shown, never sent
-- to anyone), and the dates that gate links, flags and score reports. No real name, email, age, school or location:
-- the email stays in Supabase Auth.
--
-- Row-level security with no policy and no table grants: Supabase's API roles reach this table only through the
-- functions below, each acting on auth.uid()'s own row. Later rounds (follows, score reports, comments, forums) read
-- profiles through their own security-definer functions and never expose birth_year.

create table profile (
  user_id uuid primary key,
  display_name text not null check (display_name ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{1,22}[A-Za-z0-9]$'),
  birth_year smallint not null check (birth_year between 1900 and 2100),
  created_at timestamptz not null default now(),
  -- Set by the automatic mute (3 hidden posts in 30 days) or by the owner from /admin.
  muted_until timestamptz,
  banned boolean not null default false
);
create unique index profile_display_name_key on profile (lower(display_name));
alter table profile enable row level security;
comment on table profile is
  'A fan''s display name and birth year (never shown). No real name, email, age, school or location (ADR 0018).';

-- Deleting the Supabase Auth user deletes the profile (and, through it, everything later rounds key to the user).
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'auth' and tablename = 'users') then
    alter table profile add constraint profile_user_fk foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end
$$;

-- Sign-up's last step. Refuses anyone under 13 and stores nothing about them: a birth year 13 years back needs the fan
-- to say the 13th birthday has passed (asked, never stored). The caller then deletes the Auth user (delete_my_account).
create function create_profile(p_display_name text, p_birth_year int, p_turned_13 boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  age int := extract(year from now() at time zone 'America/Chicago')::int - p_birth_year;
begin
  if uid is null then
    raise exception 'create_profile: not signed in' using errcode = '42501';
  end if;
  if p_birth_year is null or age < 13 or (age = 13 and not coalesce(p_turned_13, false)) or age > 120 then
    raise exception 'create_profile: under 13' using errcode = '22023';
  end if;
  insert into profile (user_id, display_name, birth_year) values (uid, btrim(p_display_name), p_birth_year);
end
$$;

-- The signed-in fan's own profile, without the birth year.
create function my_profile() returns table (display_name text, created_at timestamptz, muted_until timestamptz, banned boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select p.display_name, p.created_at, p.muted_until, p.banned from profile p where p.user_id = auth.uid();
end
$$;

-- Delete my account: the Auth user (email, sign-in) and, by cascade, the profile and everything keyed to it. Also how
-- an under-13 sign-up is erased.
create function delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'delete_my_account: not signed in' using errcode = '42501';
  end if;
  delete from profile where user_id = uid;
  if exists (select 1 from pg_tables where schemaname = 'auth' and tablename = 'users') then
    execute 'delete from auth.users where id = $1' using uid;
  end if;
end
$$;

revoke all on function create_profile(text, int, boolean) from public;
revoke all on function my_profile() from public;
revoke all on function delete_my_account() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') and to_regprocedure('auth.uid()') is not null then
    grant execute on function create_profile(text, int, boolean) to authenticated;
    grant execute on function my_profile() to authenticated;
    grant execute on function delete_my_account() to authenticated;
  end if;
end
$$;
