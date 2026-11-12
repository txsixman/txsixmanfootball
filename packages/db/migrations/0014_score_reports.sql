-- Fan score reports (ADR 0018, superseding ADR 0011's "three or more agreeing sources" for fans). A signed-in fan may
-- report a final score for a game that has none yet. A report is never shown on its own: a fan score shows only when
-- two different accounts, each older than 7 days when they reported, agree, or when it matches the score the Results
-- watch later reads for that game. Even then it names no winner (ADR 0004).
--
-- Why a new table and not score_submission (migration 0001): that table is raw evidence for the later reporter, coach
-- and SMS channels, with a weight, a status and an untyped payload; its submitter has no foreign key and nothing keeps
-- one account from sending twice. A fan report needs typed scores (so "the same score" is a database fact), one report
-- per account per game, the reporter's age when they reported, a reporter that becomes null (not the report) when the
-- account is deleted, and nothing but a score. Both tables are append-only.
--
-- Access as in migration 0013: row-level security, no policy, no grant; the API roles use the two functions below.

create table fan_score_report (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references game (id),
  -- Set null, never deleted, when the fan deletes their account (privacy wins over nothing: the row holds no personal data).
  reporter_id uuid references profile (user_id) on delete set null,
  home_score smallint not null check (home_score between 0 and 199),
  away_score smallint not null check (away_score between 0 and 199),
  -- The reporter's account was older than 7 days when they reported. Only these reports can confirm a score.
  established boolean not null,
  reported_at timestamptz not null default now()
);
create unique index fan_score_report_once on fan_score_report (game_id, reporter_id) where reporter_id is not null;
create index fan_score_report_game_idx on fan_score_report (game_id);
create index fan_score_report_reporter_idx on fan_score_report (reporter_id, reported_at);
alter table fan_score_report enable row level security;
comment on table fan_score_report is 'Fans'' reported final scores (ADR 0018). Append-only; reporter_id becomes null when the account is deleted.';

-- Never edited, never deleted. The one change allowed is the foreign key's own: reporter_id to null, nothing else changed.
create function fan_score_report_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.reporter_id is not null and new.reporter_id is null
     and (to_jsonb(new) - 'reporter_id') = (to_jsonb(old) - 'reporter_id') then
    return new;
  end if;
  raise exception 'fan_score_report cannot be changed this way';
end
$$;
create trigger fan_score_report_no_edit before update on fan_score_report for each row execute function fan_score_report_guard();
create trigger fan_score_report_no_delete before delete on fan_score_report for each row execute function forbid_change();
create trigger fan_score_report_no_truncate before truncate on fan_score_report for each statement execute function forbid_change();

-- Report a final score for the game a /scores/<id> address names (resolve_game_key, migration 0013). Home and away are the
-- database's home and away, the same ones the game page shows. Only a game that is still scheduled, and only once it has
-- been played: 2 hours after its kickoff when the game has one, else from 6 PM Central on its day.
create function submit_score_report(p_game_key text, p_home int, p_away int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  gid uuid;
  g game%rowtype;
  opens timestamptz;
  n_recent int;
  n_day int;
begin
  select * into a from fan_actor();
  gid := resolve_game_key(p_game_key);
  if gid is null then raise exception 'unknown_game'; end if;
  select * into g from game where id = gid;
  if g.status <> 'scheduled' or g.home_score is not null or g.away_score is not null then raise exception 'game_closed'; end if;
  opens := case when g.kickoff is not null then g.kickoff + interval '2 hours'
                when g.game_date is not null then (g.game_date::timestamp + interval '18 hours') at time zone 'America/Chicago' end;
  if opens is null or now() < opens then raise exception 'too_early'; end if;
  if p_home is null or p_away is null or p_home not between 0 and 199 or p_away not between 0 and 199
     or (p_home = p_away and g.game_type = 'playoff') then
    raise exception 'bad_score';
  end if;
  select count(*) filter (where reported_at > now() - interval '10 minutes'), count(*) into n_recent, n_day
    from fan_score_report where reporter_id = a.uid and reported_at > now() - interval '24 hours';
  perform fan_rate_check('report', a.established, n_recent, n_day);
  begin
    insert into fan_score_report (game_id, reporter_id, home_score, away_score, established)
      values (gid, a.uid, p_home, p_away, a.established);
  exception when unique_violation then
    raise exception 'already_reported';
  end;
end
$$;

-- Public read: what the page may say about a game's fan reports. Never who reported, and never an unconfirmed score:
-- only how many reports came in, and a score once it is confirmed.
--   two_fans:      one score has been reported by 2 or more established accounts, and no other score has;
--   results_watch: the game now has a final score from the Results watch, and an established account's report says the same.
-- Once the Results watch has a score it takes precedence: reports that differ from it show nothing. Only reports that
-- count confirm anything: from an established account that is not banned now (a deleted account's report still counts).
create function fan_score_status(p_game_key text)
returns table (reports int, confirmed boolean, home_score int, away_score int, basis text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  gid uuid := resolve_game_key(p_game_key);
  g game%rowtype;
  n int;
  agreed record;
  agreed_count int;
begin
  if gid is null then
    return query select 0, false, null::int, null::int, null::text;
    return;
  end if;
  select * into g from game where id = gid;
  select count(*)::int into n from fan_score_report r where r.game_id = gid;
  if g.status = 'final' and g.home_score is not null and g.away_score is not null then
    if exists (select 1 from fan_score_report r left join profile p on p.user_id = r.reporter_id
                where r.game_id = gid and r.established and (p.user_id is null or not p.banned)
                  and r.home_score = g.home_score and r.away_score = g.away_score) then
      return query select n, true, g.home_score::int, g.away_score::int, 'results_watch'::text;
    else
      return query select n, false, null::int, null::int, null::text;
    end if;
    return;
  end if;
  select count(*)::int into agreed_count from (
    select r.home_score from fan_score_report r left join profile p on p.user_id = r.reporter_id
     where r.game_id = gid and r.established and (p.user_id is null or not p.banned)
     group by r.home_score, r.away_score having count(*) >= 2) s;
  if agreed_count = 1 then
    select r.home_score, r.away_score into agreed from fan_score_report r left join profile p on p.user_id = r.reporter_id
     where r.game_id = gid and r.established and (p.user_id is null or not p.banned)
     group by r.home_score, r.away_score having count(*) >= 2;
    return query select n, true, agreed.home_score::int, agreed.away_score::int, 'two_fans'::text;
  else
    return query select n, false, null::int, null::int, null::text;
  end if;
end
$$;

revoke all on function fan_score_report_guard() from public;
revoke all on function submit_score_report(text, int, int) from public;
revoke all on function fan_score_status(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated')
     and to_regprocedure('auth.uid()') is not null then
    grant execute on function submit_score_report(text, int, int) to authenticated;
    grant execute on function fan_score_status(text) to anon, authenticated;
  end if;
end
$$;
