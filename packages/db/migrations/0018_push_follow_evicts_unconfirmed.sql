-- push_follow's 5,000-row cap (migration 0008) let an anonymous caller fill the table with made-up subscriptions and lock
-- every real browser out. Now a full table makes room for a new browser by deleting the least recently active
-- subscription that no push has ever reached, and refuses (53400, as before) only when all 5,000 are confirmed.
--
-- "Confirmed" is the push service having accepted a message for the endpoint: the sender (tools/push/send-finals.mjs, as
-- the database owner) sets confirmed_at on the first success. A made-up endpoint never gets there (the service answers
-- 404 or 410 and the sender deletes it), so a flood can only crowd out other unconfirmed rows, never a browser that has
-- received an alert. Existing rows start unconfirmed and confirm on their next alert. No access changes: the table keeps
-- row-level security with no policy, and push_follow keeps its grants (create or replace preserves them).

alter table push_subscription add column confirmed_at timestamptz;
comment on column push_subscription.confirmed_at is
  'When a push service first accepted a message for this endpoint; null until then. Unconfirmed rows are what push_follow evicts when the table is full.';

create or replace function push_follow(p_endpoint text, p_p256dh text, p_auth text, p_programs text[]) returns void
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
    delete from push_subscription
     where endpoint = (select endpoint from push_subscription where confirmed_at is null order by updated_at, endpoint limit 1);
    if (select count(*) from push_subscription) >= 5000 then
      raise exception 'push_follow: no room for new subscriptions' using errcode = '53400';
    end if;
  end if;
  insert into push_subscription (endpoint, p256dh, auth, programs)
  values (p_endpoint, p_p256dh, p_auth, slugs)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, programs = excluded.programs, updated_at = now();
end
$$;
