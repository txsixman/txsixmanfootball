# ADR 0004: Box-score scoreboard, and only a confirmed final names a winner

**Status:** Accepted Nov 10, 2026 (the owner delegated the design decision: "you test and decide with agents").

## Context
Three design directions were built on the same invented demo games (`apps/web/lib/demo-games.ts`): A "Box Score"
(dense two-line rows), B "Friday Ticket" (ticket-stub cards), C "Scorebug" (TV-style cards). Each was measured on a
375px phone and a 1280px desktop with Playwright and axe, then judged by three independent critic agents: a fan on a
phone at a Friday game, a check of whether each score tells the truth, and a product designer.

Measured on the phone: A fit 7 games on the first screen in a 1,282px page; C 5 games in 2,564px; B 2 games in
4,277px. None had accessibility violations or sideways scrolling.

Rankings: designer A, C, B; truth A, C, B; fan C, A, B. A is the only direction that holds up for 100+ games on a
Friday and extends naturally to ratings tables, the almanac and score entry.

The truth critic found all three crowning a winner on a score that was not confirmed (B and C also on a disputed
one). Scores come from volunteers, so that is the most damaging mistake the page can make.

## Decision
- Ship direction A, with borrowings: C's filled navy score for the leader, full-width words for Disputed and
  Unconfirmed, red total column and Live, Final and Later jump bar; B's big "Tonight" title and W/L forfeit marks.
- Rules, enforced in `apps/web/lib/score-display.ts` and tested in `apps/web/e2e/scores.spec.ts`:
  - Only a **confirmed final** names a winner. Unconfirmed and disputed scores crown nobody.
  - Only a **confirmed live** game highlights its leader.
  - A **forfeit** shows W and L, never the recorded 1-0 as a score.
  - A game ended by the **45-point rule** shows dashes for the quarters not played and says why it ended.
  - Every state has words or a shape, never colour alone.
- Type: Inter for reading, Barlow Condensed for numbers and labels. Red, white and blue tokens unchanged.

## Consequences
- `/scores` and `/scores/[id]` run on invented demo games until real captured games exist; both say so on the page.
- The team filter is client-side. With hundreds of games it may need to move to the server.
- The lab routes and the unused fonts from B and C were removed.
