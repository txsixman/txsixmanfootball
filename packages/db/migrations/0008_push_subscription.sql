-- Browser push alerts for a followed program's finals (web-push). A row is one browser's push subscription: the push
-- service's endpoint URL, the browser's two public keys, and the program slugs it follows. Nothing else: no name, email,
-- phone, IP address or account. Deleting the row (push_unfollow, or the sender when the push service says the
-- subscription is gone) is how alerts stop.
--
-- Row-level security with no policy: Supabase's API roles can neither read nor write the table. The site's sign-up
-- calls push_follow / push_unfollow, the only rights this migration grants them (beside migration 0005's lockdown).
-- The sender (tools/push/send-finals.mjs, in Results watch) reads the table as the database owner.

create table push_subscription (
  -- Only the browsers' own push services, so the sender never posts to any other address.
  endpoint text primary key check (
    length(endpoint) <= 1024
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/[A-Za-z0-9_:./%=+?&-]+$'
  ),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'),
  programs text[] not null check (cardinality(programs) between 1 and 25),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table push_subscription enable row level security;
comment on table push_subscription is
  'One browser''s push subscription: endpoint, keys, followed program slugs. No personal details.';

-- Follow programs (replacing what this browser followed before). Refuses a bad slug, more than 25 programs, and new
-- browsers past 5,000 rows, which bounds what an anonymous caller can add.
create function push_follow(p_endpoint text, p_p256dh text, p_auth text, p_programs text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  slugs text[];
begin
  select coalesce(array_agg(distinct p order by p), '{}') into slugs from unnest(p_programs) p;
  if exists (select 1 from unnest(slugs) p where p is null or p !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p) > 80) then
    raise exception 'push_follow: a program is not a slug' using errcode = '22023';
  end if;
  if not exists (select 1 from push_subscription where endpoint = p_endpoint)
     and (select count(*) from push_subscription) >= 5000 then
    raise exception 'push_follow: no room for new subscriptions' using errcode = '53400';
  end if;
  insert into push_subscription (endpoint, p256dh, auth, programs)
  values (p_endpoint, p_p256dh, p_auth, slugs)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, programs = excluded.programs, updated_at = now();
end
$$;

-- Stop every alert for this browser. Knowing the endpoint is the proof of ownership: it is a long random URL only
-- the browser and its push service hold.
create function push_unfollow(p_endpoint text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from push_subscription where endpoint = p_endpoint;
$$;

revoke all on function push_follow(text, text, text, text[]) from public;
revoke all on function push_unfollow(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function push_follow(text, text, text, text[]) to anon, authenticated;
    grant execute on function push_unfollow(text) to anon, authenticated;
  end if;
end
$$;
