# ADR 0009: Pages do not name where robot-read results come from

**Status:** Accepted Nov 10, 2026 (the owner: "Do not mark the source of the data we are pulling").
Narrows ADR 0002's "cite secondary sources" and ADR 0008's page labels **for robot-read game results only**.

## Decision
- Scores, playoff games, ratings and program pages show robot-read results with **no source name and no link** to
  where they were read. They still say **Unconfirmed** and that the score may change (ADR 0004 is unchanged).
- **The record keeps the source.** Every row still carries its `source_url` in the seed files and, later, the
  database, so a correction or takedown can find it (ADR 0008's stop-on-request rule is unchanged).
- Hand-entered games keep their league bracket label. School facts (alignment, colors, mascot, logo) keep their
  source links on program pages: those are the league's and the school's own pages (ADRs 0005, 0006).
- A page test fails if "MaxPreps" appears on `/scores`, `/ratings` or a program page.

## Consequences
- Readers cannot see where an unconfirmed score came from; the Unconfirmed label carries the warning alone.
- The attorney review (`docs/plan/legal-checklist.md`, item 1) should cover showing scraped results without credit.
