# ADR 0044: The projection beside the outcome

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. The owner asked for it on Nov 13: "On all
scores we still need to show what was projected and what happened also". It supersedes, for a game with a projection, the
"Kept" rule of ADR 0040 that the list pages name no winner.

## Context
- A played game lost its projection on most pages, or showed one worked out from today's ratings, which already count the
  game. Only Results and the program season pages used the projection from before the game (`lib/pregame.ts`).
- A projection is most useful next to what happened: it shows how the ratings did, hits and misses alike.

## Decision
1. **Every game row and game page with a projection shows it beside the outcome**, in one line:
   - Final: "Projected: <team> by 7 · 74% chance to win · Final: <team> by 3". A miss reads as one.
   - Tied: "… · Final: tied".
   - Under way: "… · Now: 14–28 · Unconfirmed", or "… · Now: tied". A live score names no leader (ADR 0021, 0040).
   - A game the live read saw finish is a final (ADR 0043): "… · Final: <team> by 14". Only an unconfirmed final, if
     one is ever shown, reads "… · Reported: 14–28 · Unconfirmed", with no winner.
   - Disputed: the projection and "Disputed", no winner and no score in the line (ADR 0040).
   - Forfeit: the projection and "Forfeit", never its 1-0 or 2-0 (ADR 0004).
   - Not started: the projection alone.
   - The pages: /scores rows, the game page, Results rows, the program page and its season pages, My teams. The embed
     keeps the projection for the next game only.
2. **A played game's projection is the one from before it**: both teams' ratings at the end of the week before
   (`trend`), with that week's home edge and spread (`week_home_field`, `week_sigma`). It is never today's table.
   - `lib/pregame.ts` `projectBefore` is the one place it is worked out; Results, the game page, /scores, the program pages
     and My teams all read it.
   - A week's values are fit on the games through that Sunday (`services/ratings/run.py` `with_trend`), so rating the
     game itself, or any later game, leaves its projection unchanged.
   - A game is projected once both teams have played four games, as before. Ties and forfeits are shown with their
     projection too; they are still left out of judging how the ratings did (track record, records, week in review).
3. **Wording:** "chance to win", never "win probability" on a row; no betting word; no "upset" label on a game row or
   game page.
4. **Live games keep their projection**, under way and once the live read calls them final (ADR 0043 dropped it there;
   this keeps it). A game the live read follows is not rated yet, so its projection is today's, as before the game.

## Consequences
- `lib/outcome.ts` words the outcome; `scripts/projected-vs-result.test.mjs` covers each case, the week-before projection
  and that it does not change once the game is rated. `services/ratings/test_model.py` checks the same in the ratings fit.
- `e2e/projected-vs-result.spec.ts` checks /scores, a played playoff game's page, Results and the program pages.
- The Upset badge on /scores and the Upset fact on the game page are removed. The Records page's "Biggest upsets" list is
  not a game row and is unchanged.
- A game played before the ratings' first trend week, or with a team under four games, shows no projection. That is about
  half of each season's games, almost all in the first weeks.
- /scores/tonight is changed separately, with the live board.
