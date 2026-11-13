# ADR 0030: Game-day reads catch up on the last three game nights

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Amends ADRs 0015, 0019 and 0024. Their other
rules stand.

## Context
- A game-day read (`maxpreps.mjs --tonight`) looks only for bracket games dated tonight that have no score yet. The
  `due` gate in Results watch counts only those too.
- A final that MaxPreps posts after a night's last read was therefore never read again by a game-day read. Only a
  full read found it.
- On Nov 13, 2026, only 4 of Thursday's 13 bracket games had scores on the site. There were no reads during Thursday's
  games, and the one full read ran at 8:35 AM Central. Friday's late finals would have been lost the same way on
  Saturday.

## Decision
- **Earlier nights count.** A game-day read and its `due` count include the unscored bracket games of tonight and of
  the 3 game nights before it (`dueGames`, `CATCH_UP_NIGHTS`).
  - A game night is a date with any bracket row.
  - Their finals merge into `playoffs.csv` and `games.csv` exactly as tonight's do: only an empty score is filled.
  - Live scores (ADR 0021, and the second source of ADR 0025) stay tonight's only.
- **Evening catch-up.** Any tick in the game-night window (18:00 to 06:10 UTC) now reads when an earlier night's game
  is unscored. Nothing new is needed for this.
- **Daytime catch-up.** The game-day clock adds one tick at 15:03 UTC (9:03 AM Central) in November and December. It
  starts a game-day read, and the `due` gate lets that read run only when a game of the last 3 nights is unscored.
- **Leaving the list.** A game postponed or never scored drops off after 3 game nights. The morning and full reads
  still look for it.

## Consequences
- A late final is in by the next morning at the latest, without a full read.
- A night with an unscored earlier game reads a few more pages: one page a game, each page once a read, the same
  2.5-second gap (ADR 0008).
