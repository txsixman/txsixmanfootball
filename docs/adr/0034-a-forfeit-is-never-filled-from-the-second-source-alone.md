# ADR 0034: A forfeit is never filled from the second source alone

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Amends ADR 0033. Its other rules stand.

## Context
The first 2026 fill (ADR 0033) added 10 games MaxPreps did not list, and 8 of them were forfeits in the second source.
A forfeit names a winner and changes a team's record. A game that MaxPreps does not list fits a cancellation just as
well as a forfeit, so here only one source says the game happened at all. The 8 were taken out of the private store
the same hour, before any read published them.

## Decision
A forfeit is never filled from the second source alone. It waits for MaxPreps or a hand capture.
- `dc-fill.mjs` reports such a game with the verdict `forfeit` in the private `history-check.csv` and does not add it.
- That covers a forfeit by either side. A game both sides forfeited stays `no-score`.

## Consequences
- The fill adds played games only. A forfeit reaches the site when MaxPreps lists it or someone captures it by hand.
- Test: `dc-fill.test.mjs`, on invented fixtures.
