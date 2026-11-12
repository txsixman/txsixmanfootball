-- Every imported fact keeps its source (ADR 0002).

create table source_document (
  id uuid primary key default gen_random_uuid(),
  url text unique not null,
  title text,
  retrieved_on date not null
);

alter table team_season add column source_document_id uuid references source_document;

alter table source_document enable row level security;
