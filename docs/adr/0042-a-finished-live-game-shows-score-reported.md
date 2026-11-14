# ADR 0042: A game the live read saw finish shows "Score reported" until the final is read

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It extends ADR 0021 (live scores) and leaves
ADR 0040 (a final score is confirmed) as it is: this row is a read, not our final.

## Context
- On the Nov 13 playoff night, the second live source (ADR 0025) listed several UIL games as Finished at 8:45 PM CT while
  the pages still said "In progress": the live read asked only for Live and Upcoming games, so a game dropped out of it
  the moment it ended, often an hour before the MaxPreps read wrote the final (many six-man games end early on margin).
- Saturday's slate has 14 games from 2 PM CT, so the gap repeats.

## Decision
- The second live read also asks for the finished statuses (Final, Completed, Finished; forfeits are still skipped). A
  game it calls finished keeps its last score, with `finished` set and no period. A finished 0-0 is not kept.
- `live_score` gains `finished boolean not null default false`, and `live_scores()` returns it (migration 0019). The
  writer (`packages/db/live.mjs`) writes it with the score, in the same transaction. Rows from the MaxPreps reader carry
  no flag (it shows no game under way, Nov 13), which means under way.
- When both sources hold a row for a game, the higher total wins as before; on a tie, the row that says finished, then
  the one with a period.
- Pages show such a game as "Score reported": dashed, "Unconfirmed", no winner, never "In progress" and never "Final".
  On the scoreboard it is listed and counted under Reported, not Live (`asLive` in `lib/live-scores.ts`). The line beside
  it reads "Score reported · as of 9:05 PM CT", the time of our read.
- When the MaxPreps read writes the final, the game leaves tonight's due list, its live row is deleted on that run, and
  the stored final (confirmed or disputed, ADR 0040) takes its place once the site rebuilds.

## Consequences
- Between that run and the rebuild (a few minutes) the game shows its kickoff status again, as it did before.
- A finished row is still a read: if the feed later lists the game as live again, the next run clears the flag.
- `lastUpdatedUtc` from the feed is not used: on Nov 13 it equalled the kickoff time in 17 of 19 games.

## Addendum (Nov 14, 2026): no quarter from the second source
- **Context:** the owner reported wrong quarters and false "OT". On the Nov 13 board at 8:26 PM CT, the second source's
  `summary.period` lagged the score: Kress at Jayton read Q1 at 75-6, 86 minutes after kickoff, and two 0-0 games read Q1
  56 and 86 minutes in. Two games of the same 6:30 PM kickoff read 5 at 116 minutes, which `periodLabel` showed as "OT":
  more likely an end-of-game state than two overtimes at once.
- **Decision:** live rows from the second source carry no period (null), so pages say "Live · as of 8:26 PM CT" with no
  quarter. MaxPreps rows already carry none. `periodLabel` stays, for a source that proves reliable, but maps only 1 to 4
  (Q1 to Q4), Halftime and "OT" in words; a number above 4 is null. A 0-0 game under way is not shown at all, since the
  period that would show kickoff has passed is not trusted.
- **Evidence for later:** each live run's summary counts the feed's raw period for the games under way, in bands of
  minutes since kickoff (0-30, 30-60, 60-90, 90-120, 120+), with no team or score. A period that climbs with the minutes
  across a few game nights is the case for showing it again, in a new ADR.
