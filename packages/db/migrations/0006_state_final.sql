-- State championship finals (backlog item 4): one row per league, season, class and division, with both teams named
-- as the source names them. A team links to a program only when the name matches one; schools that closed or merged
-- wait for lineage (ADR 0003) and keep their name meanwhile. Every row cites its source (ADR 0002).

create table state_final (
  id uuid primary key default gen_random_uuid(),
  league text not null,
  season int not null check (season between 1900 and 2100),
  conference text not null default '',
  division text not null default '',
  champion_name text not null,
  runner_up_name text not null,
  champion_program_id uuid references program,
  runner_up_program_id uuid references program,
  champion_score smallint check (champion_score >= 0),
  runner_up_score smallint check (runner_up_score >= 0),
  score_note text,
  notes text,
  source_document_id uuid not null references source_document,
  unique (league, season, conference, division),
  check (champion_name <> runner_up_name)
);

alter table state_final enable row level security;
