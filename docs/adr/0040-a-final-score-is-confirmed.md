# ADR 0040: A final score is confirmed

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. The owner asked for it on Nov 13: "if they are
final mark as confirmed everything shows unconfirmed". It supersedes the parts of ADRs 0004, 0008, 0011 and 0013 that call
a robot-read or corrected score unconfirmed, and the "Score reported" rule of ADR 0037 for those scores.

## Context
- Every robot-read or corrected score was "unconfirmed" (`lib/games.ts`, `lib/game-pages.ts`).
  - So no page named a winner, scores had dashed styling, and about 25 pages carried "Scores are not confirmed here".
  - In practice that covered every score the site has, because nearly all of them are robot-read.
- A game that is over with both scores present is a result. The site's caution belongs to live scores, which still move.

## Decision
1. **A final is confirmed.** The game is over and both scores are present, whether read by the robot, captured by hand or
   corrected.
   - It shows a solid "Final" with the confirmed check.
   - The scoreboard and the game page mark the winner.
   - Its structured data carries the score (`lib/json-ld.ts`).
2. **A live score stays unconfirmed** until it is final: "Live · Q3 · 14–28 · Unconfirmed", no leader marked.
3. **A forfeit is confirmed** and still shows the word, never its 1-0 or 2-0 (ADR 0004's forfeit rule stands).
4. **Disputed: a final the sources give different winners.** Listed in `data/seed/disputed/<year>.csv` (`game_date,home,away`,
   teams as the bracket and results rows spell them), which `check-data.mjs` checks and `lib/disputed.ts` reads.
   - The list is settled by hand from the second source's finals check. That report itself stays private: the web build
     never reads private files.
   - Only a different winner goes on it. A final whose margin differs between sources stays a normal confirmed final.
   - A disputed final shows its score with no winner. Its status is "Score reported", and the bracket pages mark it "Disputed".
   - It starts with the 5 finals of 2026 whose winner the sources disagree on, after the build session's check (Nov 14).
   - `check-data.mjs` fails on a row that matches no game in that season's `games.csv` or `playoffs.csv`, or in a hand
     capture. A misspelled row would otherwise leave the game showing a winner without anyone noticing.
   - Records, standings and series still count a disputed game by its score as listed. The page marks no winner, and a
     correction (ADR 0011) settles the record.
5. **A 0-0 is no score, never a final.** The store already writes it blank; the loaders also refuse it.

- **Wording:** every "not confirmed here" and "Scores are not confirmed here and may change" line is removed. Where a caveat
  still helps (the bracket pages, results, standings, rankings, records, the footer and the terms), it reads "Scores may be
  corrected if a mistake is found."
- **Kept:** the pages that list scores without naming a winner (bracket lists, Results, program schedules, series, week in
  review, the embed, push alerts) still list them that way. They show the score, and the game page names the winner.

## Consequences
- The "Score reported" section and status from ADR 0037 now hold only a disputed final.
- `scripts/disputed.test.mjs` covers the list: a match in either team order, a missing file meaning none, and a bad
  header or row failing the build. `check-data.test.mjs` checks that a misspelled or wrongly dated row fails.
- The tests that asserted "Unconfirmed" on a final now assert the reverse.
  - The game page test checks that the winner is marked.
  - The structured-data test checks the final score in its description.
  - The playoff specs check that a scored game reads "Final" or "Forfeit".
