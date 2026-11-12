-- Every lineage row cites its source (ADR 0002) and says in a line what that source records. No rows exist yet.
alter table program_lineage add column source_document_id uuid not null references source_document;
alter table program_lineage add column notes text;
