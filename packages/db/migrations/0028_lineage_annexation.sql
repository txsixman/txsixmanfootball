-- Lineage rows use TEA's own word for a district that was absorbed by another (ADR 0072): 'annexation' joins the
-- events of migration 0001. An annexed school is listed on the program it joined; its finals stay under its own name.
alter table program_lineage drop constraint program_lineage_event_check;
alter table program_lineage add constraint program_lineage_event_check
  check (event in ('rename', 'consolidation', 'annexation', 'split', 'coop'));
