# ADR 0003: School, program and team-season

**Status:** Accepted, Nov 10, 2026 (the owner).

## Decision
- **school** is the institution. Names are aliases with valid-from and valid-to years.
- **program** is the football lineage, with a permanent URL slug.
- **program_school** says which schools made up a program and when. This is how co-ops are stored.
- **program_lineage** links programs, many to many. A consolidation has two or more predecessors; a split has two or
  more successors.
- **team_season** is one program in one season, with its league, division, district and format (6, 8 or 11).
  Everything hangs on it.

## Why this differs from plan Appendix C
Appendix C gives each program one `predecessor_id`. That cannot store a consolidation of two programs, which section
7.6 names as a core case. It also has no link from program to school.

## Other changes from Appendix C
- `coach` and `venue` tables exist, so those references are real foreign keys.
- `end_reason` applies only to finals. Cancelled and suspended are statuses.
- `end_reason` gains `unknown`, because old results often do not say how a game ended. Ratings must not treat those
  games as normal endings.
- A game's two team-seasons must belong to the game's season, enforced by foreign key.
