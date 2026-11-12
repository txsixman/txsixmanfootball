-- Schema v0: plan Appendix C with the corrections in ADR 0003.
-- Six-man scoring checks are soft flags (plan Appendix B) and live in packages/core, not here.

create table school (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  city text,
  county text,
  lat double precision,
  lng double precision,
  colors text[],
  status text not null default 'active' check (status in ('active', 'closed', 'consolidated')),
  opened_year int,
  closed_year int
);

create table school_alias (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references school,
  name text not null,
  valid_from int,
  valid_to int,
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table program (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null
);

-- Which schools made up a program, and when. A co-op has more than one row at once.
create table program_school (
  program_id uuid not null references program,
  school_id uuid not null references school,
  from_season int not null,
  to_season int,
  primary key (program_id, school_id, from_season),
  check (to_season is null or to_season >= from_season)
);

-- Many to many: a consolidation has several predecessors, a split has several successors.
create table program_lineage (
  predecessor_id uuid not null references program,
  successor_id uuid not null references program,
  event text not null check (event in ('rename', 'consolidation', 'split', 'coop')),
  season int not null,
  primary key (predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);

create table coach (
  id uuid primary key default gen_random_uuid(),
  full_name text not null
);

create table venue (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision,
  lng double precision
);

create table team_season (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references program,
  season int not null,
  league text not null,
  division text,
  district text,
  format smallint not null check (format in (6, 8, 11)),
  head_coach_id uuid references coach,
  unique (program_id, season),
  unique (id, season)
);

create table game (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  kickoff timestamptz,
  venue_id uuid references venue,
  home_ts uuid not null,
  away_ts uuid not null,
  neutral boolean not null default false,
  game_type text check (game_type in ('nondistrict', 'district', 'playoff', 'bowl', 'scrimmage')),
  playoff_round text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'pregame', 'live', 'final', 'postponed', 'suspended', 'cancelled')),
  end_reason text
    check (end_reason in ('regulation', 'overtime', 'mercy_half', 'mercy_2h', 'forfeit', 'unknown')),
  end_period smallint,
  end_clock interval,
  periods jsonb,
  home_score smallint check (home_score >= 0),
  away_score smallint check (away_score >= 0),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  confirmed_at timestamptz,
  locked_at timestamptz,
  foreign key (home_ts, season) references team_season (id, season),
  foreign key (away_ts, season) references team_season (id, season),
  check (home_ts <> away_ts),
  constraint final_is_complete
    check (status <> 'final' or (end_reason is not null and home_score is not null and away_score is not null)),
  constraint end_reason_only_on_final check (end_reason is null or status = 'final')
);

-- Raw evidence. submitter_id gets its foreign key when accounts arrive in Phase 4; null means an unregistered number.
create table score_submission (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references game,
  submitter_id uuid,
  channel text not null check (channel in ('reporter_app', 'coach_portal', 'sms', 'web', 'admin')),
  payload jsonb not null,
  device_ts timestamptz,
  received_at timestamptz not null default now(),
  weight numeric(3, 2) not null check (weight between 0 and 1),
  idempotency_key text unique,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed', 'rejected'))
);

create table audit_log (
  id bigserial primary key,
  actor uuid,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  at timestamptz not null default now()
);

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% cannot be changed this way', tg_table_name;
end
$$;

create trigger audit_log_no_edit before update or delete on audit_log
  for each row execute function forbid_change();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function forbid_change();
create trigger score_submission_no_delete before delete on score_submission
  for each row execute function forbid_change();
create trigger score_submission_no_truncate before truncate on score_submission
  for each statement execute function forbid_change();

-- No policies yet, so everything is denied to non-owners. Public read policies arrive with the app.
alter table school enable row level security;
alter table school_alias enable row level security;
alter table program enable row level security;
alter table program_school enable row level security;
alter table program_lineage enable row level security;
alter table coach enable row level security;
alter table venue enable row level security;
alter table team_season enable row level security;
alter table game enable row level security;
alter table score_submission enable row level security;
alter table audit_log enable row level security;
