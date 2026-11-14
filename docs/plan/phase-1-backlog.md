# Phase 1 backlog: Data core (Dec 7, 2026 to Feb 14, 2027)

Written Nov 10, 2026 from plan v1.1 section 18 and what Phase 0 actually built. **Gate G2, Feb 14, 2027:** 100% of
current programs registered; at least 90% of UIL champions sourced.

Ordered by what unblocks the most. Hours are rough, for one person with Claude Code.

| # | Item | Needs | Hours | Done when |
|---|---|---|---|---|
| 1 | **Supabase project** (free tier until the alpha), schema v0 applied, `.mcp.json`, secrets kept out of the repo | The owner creates the account | 3 | Migrations run on it from CI; RLS test passes there |
| 2 | **Program registry, all leagues**: TCAL, TCSAAL and independents added; TAIAO and TCAF watched like TAPPS | ADR 0005 reads where a league page allows it | 12 | Every current six-man program has a row with a source |
| 3 | **Aliases and lineage** (ADR 0003): old names, mergers, closed schools, for programs that played six-man since 1938 | Item 2 | 10 | Each program page lists its other names with sources |
| 4 | **Champions 1938 to 2026 (H1, first half)**: every UIL state champion and runner-up, each with a cited source | Item 3 | 20 | G2's 90% of UIL champions sourced; a public-domain or UIL source per row |
| 5 | **Import tools**: one importer for alignments, games and champions, each run audited (`audit_log`) | Item 1 | 8 | Re-runs are no-ops; every insert has an audit row |
| 6 | **Admin console v1, data half**: sign-in for the owner only, correct a game, merge two programs, all audited. (The game-night queues are Phase 3) | Item 1 | 15 | An edit shows on the site after the next build and leaves an audit row |
| 7 | **Regular-season 2026 results**: done by the MaxPreps reader (ADR 0008); close the coverage gaps | | 2 | Every school with a 2026 team is reached |
| 8 | **Ratings with games per team**, and a methodology note | Item 7 | 4 | `/ratings` shows how much each rating rests on |

About 72 hours. At 10 hours a week the phase has about 100.

## Found in the data audit (Nov 14, 2026)
- **Missing private-league bracket games**: some TAPPS, TAIAO and TCAF playoff games of past seasons are not in the
  playoff files (for example San Marcos Academy's 2021 TAPPS Division I games), because a past season reads only the
  schools in today's alignments. Find them from the schedule pages of the schools that are listed, with the bracket's
  later rounds as the check.
- **Same pair and score, more than 2 days apart**: five likely copies the duplicate rule (2 days) does not catch
  (2018 Veribest at Bronte, 2019 McLean and White Deer, 2021 Rule at Throckmorton, 2024 Abbott and Aquilla, 2025 Ira at
  Robert Lee). Each needs a reviewed void with evidence, not a wider rule.
- **Same-night doubles kept as known exceptions** (`data/integrity-exceptions.json`): 2018 Rotan and Rankin, 2020
  Lorenzo, 2022 Christian Heritage Classical, 2026 Logos Prep. Void the wrong game once a source says which.

## Moved out of Phase 1
- **Score-entry form**: the plan puts score entry in Phase 3 (reporter app, web form, SMS). A form before then has no
  reporters to use it. Until then games enter through the capture files.
- **Plan v1.2**: written Nov 11, 2026 (`v1.2.md`). Item 2's TCAL, TCSAAL and independents come from public pages
  only; no outreach (ADR 0014).

## Cut first if Phase 1 runs long (plan section 5.2 spirit)
1. Item 8's methodology note (ship the number, explain later).
2. Lineage for closed schools with no current program.
3. TCSAAL and independents (G2 counts current programs; mark them "not yet listed").
