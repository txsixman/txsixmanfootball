# ADR 0043: A late live score left unchanged for an hour is final, and a finished live game shows "Final"

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. The owner's rule, Nov 14: "If a score has not
been reported within the fourth quarter or later after 1 hour it is final". It amends ADR 0042: a finished live row now
shows "Final" with the winner marked, not "Score reported". ADR 0042's addendum stands: the feed's period is never stored
or shown.

## Context
- The second live source (ADR 0025) often keeps a game in its Live list long after it ends, with a score that no longer
  moves. Pages kept saying "Live" for a game that was over, until the MaxPreps read wrote the final.
- ADR 0040 made a final score confirmed: the game is over and both scores are present. A finished live row fits that.

## Decision
1. **Late:** the read sees the game in the fourth quarter or later: the feed's raw period is 4 or more, or 2 hours have
   passed since kickoff. A game with no kickoff goes by the period alone. The reader writes `late` on the row
   (`isLate` in `tools/league-watch/davecampbells.mjs`); the raw period is used only for this test and is never stored.
   The MaxPreps live rows carry no period or kickoff, so they never say late; when both sources list a game, it is late
   if either row says so (`mergeLive`).
2. **Unchanged for an hour:** `live_score.score_changed_at` (migration 0020) is the read time of the first read with the
   current score. `packages/db/live.mjs` sets it on a new row or when either team's score differs from the stored row
   (compared team by team, so a swap of home and away is not a change), and keeps it otherwise, so it carries across runs.
3. **Final, in one place:** `live_scores()` returns `finished` true when the feed said finished (as before), or when the
   row is late and `now() - score_changed_at` is 60 minutes or more. A 0-0 is never final by the second rule. Every
   reader of live rows (the scoreboard, game, program and tonight pages) reads this one flag. The push sender reads
   stored finals only, so it is not affected.
4. **Pages:** a finished live row is a final (ADR 0040): "Final", confirmed, the winner marked, with "as of 9:45 PM CT"
   (the read's time). It sits with the finals on the scoreboard, never under Live or Score reported. The game page header
   says "Final", never "In progress". A program page shows the score solid, not dashed.
5. **The stored final still wins.** When the MaxPreps read writes the game's final, the game has a final and takes no
   live row. If the two scores differ, the stored final is what every page shows, and the live row is ignored.

## Consequences
- A game can show "Final" up to an hour after its last score change while the reads still list it as Live. A late score
  that changes after the hour (a stuck read catching up) makes the game live again on the next read, since the changed
  score resets `score_changed_at`.
- A final from the live read may differ from the stored final read later. The stored one replaces it with no note.
- If the live reads stop, a late row still turns final an hour after its last change, until it is 90 minutes old on a
  page (`LIVE_MAX_AGE_MS`) or 6 hours old in the table.
