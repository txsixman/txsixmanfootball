-- The weekly team digest (ADR 0055). The digest is the second kind of email on migration 0022's pieces: `email_kind` already has
-- `weekly_digest`, and email_optin, email_sent, email_unsubscribe_token, email_set_optins, email_my_settings and email_unsubscribe
-- are kind-neutral. A fan opts in on /account with email_set_optins('weekly_digest', '{*}') (every team they follow, now and
-- later); nothing is on until they do, and the same function refuses an account that is not an adult (email_adult).
--
-- The one thing added is who is due this week's digest. The sender role (email_sender) runs exactly one new function and nothing
-- else new: it already runs email_mark_sent, which records `(user, 'weekly_digest', '<iso week>')` in email_sent, so a week is
-- never sent twice. Supabase's API roles cannot run it (it returns the address and the fan's unsubscribe token).

-- One row per fan due the digest for `p_week` ('2026-w47', the ISO week the email is sent in): opted in to the digest, an adult who
-- is not banned, with a confirmed address, not already recorded for that week. `followed_slugs` is the teams of theirs the digest
-- covers: every team they follow when they chose '*', else the followed teams they ticked. A fan who follows none comes back
-- with none (the sender sends nothing then). Returns the address (the one place it leaves Supabase Auth, to the sender) and the
-- fan's weekly_digest unsubscribe token, as email_pending_game_alerts does for the other kind.
create function email_pending_digests(p_week text, p_limit integer default 500)
returns table (user_id uuid, email text, followed_slugs text[], unsubscribe_token uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_week is null or p_week !~ '^\d{4}-w(0[1-9]|[1-4][0-9]|5[0-3])$' then
    raise exception 'email_pending_digests: not an ISO week like 2026-w47' using errcode = '22023';
  end if;
  -- plpgsql, not sql: the body names auth.users, which the tests' plain Postgres does not have until a test makes it.
  return query
    select o.user_id, u.email::text, coalesce(array_agg(distinct f.program_slug order by f.program_slug) filter (where f.program_slug is not null), '{}'), t.token
      from email_optin o
      join email_unsubscribe_token t on t.user_id = o.user_id and t.kind = 'weekly_digest'
      join profile p on p.user_id = o.user_id and not p.banned and email_adult(p.birth_year)
      join auth.users u on u.id = o.user_id and u.email is not null and u.email_confirmed_at is not null
      left join follow f on f.user_id = o.user_id and o.program_slug in ('*', f.program_slug)
     where o.kind = 'weekly_digest'
       and not exists (select 1 from email_sent s where s.user_id = o.user_id and s.kind = 'weekly_digest' and s.item = p_week)
     group by o.user_id, u.email, t.token
     order by o.user_id
     limit greatest(1, least(coalesce(p_limit, 500), 2000));
end
$$;

revoke all on function email_pending_digests(text, integer) from public;
grant execute on function email_pending_digests(text, integer) to email_sender;
