# ADR 0036: Kickoff times, and a game's status worked out when it is viewed

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. The owner asked for both on Nov 13. Adds to
ADRs 0004, 0021 and 0029.

## Context
- The site showed a game's date only. Its pages are static, so a status fixed at build time ("Tonight, no score yet")
  goes stale while the page is open.
- MaxPreps' schedule data holds a start field, but the reader has never stored it, and no one has checked what it holds on
  a live page.
- The second source's feed gives each game's scheduled kickoff in UTC. Its permission covers its schedule data, and
  `davecampbells.mjs` already matches its games to bracket rows (the finals check, the live read).

## Decision
- **The facts file:** `data/seed/game-details/<year>.csv`, with columns `date,home,away,kickoff_utc,site_name,site_city`.
  - A blank field is not known. The site columns are filled by the next change (game sites); until then they are blank.
  - It is a folder, not a file at the top of `data/seed`, because `check-data.mjs` reads each entry there as a folder.
  - The teams are as the bracket rows spell them. No column names a source.
  - It sits outside `maxpreps-<year>/`, which keeps only its two files (ADR 0029).
  - `check-data.mjs` checks it.
- **Filled by** `node tools/league-watch/davecampbells.mjs --kickoffs <private playoffs.csv> --out data/seed/game-details/<year>.csv`.
  - It reads the feed's live and upcoming games of one mapped team a bracket game with no score, dated today or later.
  - Each game it finds gets that game's kickoff. A fresh value replaces a kept one, a blank keeps it; other rows stay.
  - Same rules as every read of that feed: `/api/public` only, an honest user agent, 2.5 s apart, stop at once on 403 or 429.
  - MaxPreps' own start time is not used until the reader has been checked against a live page. When it is, MaxPreps comes
    first and this file only fills gaps.
- **Status is worked out in the browser** when the page is viewed, and again every minute (`app/kickoff-status.tsx`,
  `lib/kickoff.ts`):
  - before kickoff: "Starts 7:00 PM CT";
  - from kickoff until 4 hours after with no final: "In progress", plus the live score where the live read has one
    (ADR 0021, marked "Unconfirmed");
  - more than 4 hours after with no final: "Score not reported yet";
  - no time known: "Time not listed" through the game's day in Central time, then "Score not reported yet";
  - a final shows its score, as before.
- **No hydration mismatch:** the server's HTML holds only what never changes (the date, and the kickoff time or "Time
  not listed").
- **Where it shows:** Scores, Tonight, each game page, a program's schedule and next game, the bracket pages and
  Playoffs this round.
- Nothing here names a winner or a leader.

## Consequences
- 21 of the 42 bracket games still to play on Nov 13 had a kickoff in the feed. The rest show "Time not listed".
- The file is updated by hand for now. A scheduled read before each game day is the next step: the Results watch's
  morning read could run `--kickoffs` and publish the file with its commit.
- Tests:
  - `scripts/kickoff.test.mjs`: the status at fixed clock times (before, during, after, no time), with no betting word
    and no winner;
  - `davecampbells.test.mjs`: the kickoff rows and the merge;
  - `e2e/kickoff.spec.ts`: every game not yet played shows a status once the page runs, the label moves with the clock
    without a reload, and phone screenshots.
