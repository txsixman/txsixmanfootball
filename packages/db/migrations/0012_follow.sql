-- Signed-in fans' follows (ADR 0018): which programs an account follows, so "My teams" is the same on every device.
-- Push alerts stay per browser (migration 0008); this table holds no push address.
--
-- Row-level security with no policy and no table grants: Supabase's API roles reach the table only through the three
-- functions below, each acting on auth.uid()'s own rows. A follow belongs to a profile (finishing sign-up comes first)
-- and goes with it: delete_my_account() (migration 0011) deletes the profile, and the foreign key takes the follows.

create table follow (
  user_id uuid not null references profile (user_id) on delete cascade,
  program_slug text not null check (program_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(program_slug) <= 80),
  created_at timestamptz not null default now(),
  primary key (user_id, program_slug)
);
alter table follow enable row level security;
comment on table follow is
  'The programs a signed-in fan follows. Own rows only, through follow_program, unfollow_program and my_follows.';

-- Follow one program. Following twice is fine. At most 100 follows per account; the per-account lock makes that cap
-- hold when several requests (importing a browser's list) arrive at once.
create function follow_program(p_slug text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'follow_program: not signed in' using errcode = '42501';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) > 80 then
    raise exception 'follow_program: not a program slug' using errcode = '22023';
  end if;
  if not exists (select 1 from profile where user_id = uid) then
    raise exception 'follow_program: finish sign-up first' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('follow:' || uid::text, 0));
  if not exists (select 1 from follow where user_id = uid and program_slug = p_slug)
     and (select count(*) from follow where user_id = uid) >= 100 then
    raise exception 'follow_program: at most 100 follows' using errcode = '53400';
  end if;
  insert into follow (user_id, program_slug) values (uid, p_slug) on conflict do nothing;
end
$$;

create function unfollow_program(p_slug text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'unfollow_program: not signed in' using errcode = '42501';
  end if;
  delete from follow where user_id = auth.uid() and program_slug = p_slug;
end
$$;

-- The signed-in fan's own follows, oldest first.
create function my_follows() returns table (program_slug text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select f.program_slug, f.created_at from follow f where f.user_id = auth.uid() order by f.created_at, f.program_slug;
end
$$;

revoke all on function follow_program(text) from public;
revoke all on function unfollow_program(text) from public;
revoke all on function my_follows() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') and to_regprocedure('auth.uid()') is not null then
    grant execute on function follow_program(text) to authenticated;
    grant execute on function unfollow_program(text) to authenticated;
    grant execute on function my_follows() to authenticated;
  end if;
end
$$;

-- Delete my account, now also from the places Supabase's Auth keeps copies. Migration 0011's function removed the Auth user
-- and, by cascade, the profile and follows; but auth.flow_state (sign-in handshakes) and auth.audit_log_entries (a log whose
-- payload holds the email and IP) have no foreign key to auth.users, so they outlived it. This replaces the function (its
-- grant stays) and clears both first, where the tables exist (they do not on the tests' plain Postgres without stubs).
create or replace function delete_my_account() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'delete_my_account: not signed in' using errcode = '42501';
  end if;
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
