-- A team can be listed by more than one league in a season (ADR 0012): Grayson Christian is on TCAF's and TAIAO's
-- 2026 lists. team_season keeps one row a program a season (games point at it), with the league its file lists first;
-- this table holds every league that lists the team that season, each with its own place and source.
create table team_season_league (
  team_season_id uuid not null references team_season on delete cascade,
  league text not null,
  division text,
  region text,
  district text,
  source_document_id uuid not null references source_document,
  primary key (team_season_id, league)
);
alter table team_season_league enable row level security;

-- Every sourced team-season so far is in exactly one league.
insert into team_season_league (team_season_id, league, division, region, district, source_document_id)
select id, league, division, region, district, source_document_id from team_season where source_document_id is not null;
