-- Older and hand-captured games often have a date but no kickoff time.

alter table game add column game_date date;
alter table game add column source_document_id uuid references source_document;
