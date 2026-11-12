---
paths:
  - "data/**"
  - "packages/db/**"
  - "services/**"
---

Before adding any data source or import, check its row in plan section 7.1 and ADR 0002.

- Every imported fact keeps its source (a `source_document` row or a citation).
- Facts from SixManFootball.com enter only through a signed partnership.
- MaxPreps: game results from team schedule pages only, by `tools/league-watch/maxpreps.mjs` (ADR 0008). Pages
  never name or link any source; the source stays on the row (ADRs 0009, 0010). SixManFootball.com is never read. CalPreps is
  not used.
- Fixtures and tests use invented schools and people.
- Player data stays minimal: name, class year, jersey and opt-in stats, as reported by schools.
