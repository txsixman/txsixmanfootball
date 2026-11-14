# ADR 0046: Late finals for bracket games, and an alert for any still missing

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It adds to ADR 0031 (the private store and
its two-read rule), ADR 0034 (forfeits) and ADR 0028 (ops alerts), and changes nothing they decided.

## Context
- After a game night, two bracket games of a league that runs its own bracket were still blank the next day. One had a
  final on the league's own bracket and nowhere the morning read looks. The other had moved to the next day.
- Nothing said so. The morning read fills only what MaxPreps has; the second-source fill (dc-fill) does not fill bracket
  games; and the page put a past game with no score under "Later", as if it were still to come.

## Decision
1. **Late-final fill.** After the morning read, a bracket game whose Central game night is over (from 6:00 AM Central the
   next morning, 12 hours past a 6:00 PM night) and that MaxPreps has not scored takes its final from:
   - the league's own bracket (TAIAO's page, read as a visitor's browser does: `tools/league-watch/taiao.mjs`), for that
     league's games, when the bracket dates the game on the stored row's date;
   - the second source (`tools/league-watch/davecampbells.mjs`, ADR 0042's rules), for a game with a mapped team, when
     the repository variable `SECOND_FINALS` is `true`.
   If both have a final they must agree, or nothing is filled. A forfeit is never filled this way (ADR 0034): not a game
   whose bracket text says forfeit, not one the feed flags, and not a 1-0, 2-0 or 0-0. It waits for MaxPreps or a hand
   capture.
2. **The fill goes through the store's own merge** (`store.mjs` `mergeStored`), into playoffs.csv and games.csv (which
   holds every played game, playoff games too), as an ordinary stored row with a note saying where it came from. A later MaxPreps read that differs is proposed and applies only after two reads (ADR 0031).
   Published files still carry no source and no note.
3. **Moved games.** A blank late game of that league that its bracket dates later is moved to that date in playoffs.csv,
   and the move is kept in the private store's `moved-games.csv`. Every read lays a game it finds on a moved game's old
   date onto the new one, so MaxPreps's old date never puts the row back. The game then counts by its new date. A move
   can also be added there by hand.
4. **Missing-finals alert.** A bracket game of a night that is over and still blank after the fill and the moves is
   missing. Missing games are named in the run summary only, fail the step,
   and raise the ops reason `missing-finals`; never on a page.
5. **Map rows** for the second source are added only on an exact name and town match. Where there is none, no row is
   added, and the league's bracket or a hand capture fills the game. A school is the same when the town matches and the
   repository's own MaxPreps alias already names that page as our school.
6. **The page:** a past game with no score is under "Score not reported yet" on the scores board, not "Later". It is
   worked out in the browser at the time of viewing, as ADR 0036's kickoff status is.

## Consequences
- The Results watch has a "Late finals and missing finals" step after the morning read (and on a dispatch that is not a
  game-night read). Its failure does not stop the publish.
- `taiao.mjs` reads the bracket tabs as well as the division tables; `--text` prints a tab's text for a hand check.
  `davecampbells.mjs --games-on` prints one team's games on a date, for a hand check; it saves nothing.
- A game the league's bracket and MaxPreps both lack, and the second source lacks or cannot match, is named by the alert
  each morning until it is filled by hand.
