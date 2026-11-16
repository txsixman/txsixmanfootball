# ADR 0077: Playoff weeks get a kickoff and site read every morning

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It widens the morning read of ADRs 0036,
0041, 0063, 0065 and 0067 from Friday to Sunday to every day while a playoff game is left, adds a morning tick to the
game-day clock (ADR 0024), and adds the one robot alert that names a game (an exception to ADR 0027's wording rule).

## Context
- The kickoff and site reads (`davecampbells.mjs --kickoffs`, `taiao.mjs --details`) ran only on the Friday to Sunday
  morning read, or on a dispatch that was not a game-day read.
- On Mon Nov 16, 2026 the area round's kickoffs and sites and the TAIAO semifinal details were filled by a hand run of
  those same reads. Coaches set most sites and kickoffs Saturday to Tuesday, so Monday to Thursday had no read at all.
- The regional round is Thanksgiving week (likely Thu Nov 26 to Sat Nov 28). A pairing the bracket sets by winners (ADR
  0067) has no playoffs.csv row until a MaxPreps listing is read, and only a morning read finds listings. A Thursday game
  with a kickoff in the game details but no listing was never due for a game-day read, so its final would wait until
  Friday's morning read.
- GitHub's `schedule` events fire only now and then in this repo; the game-day clock is the timer that is relied on.

## Decision
1. **A details read, Monday to Thursday.** Results watch has a third kind of read beside the morning and game-day reads:
   the details read (dispatch input `details`, or the cron `23 11 * 11-12 1-4`). It runs only the second source's
   kickoffs and sites (listed bracket games and bracket-built pairings) and the league bracket details (TAIAO), then the
   commit step, which merges them with the same never-overwrite merge (`--merge-details`, ADR 0041): a filled value or a
   correction is never replaced. It reads no MaxPreps page, no regular-season sites, no late finals and no live scores.
   The run's title says which read it is (`run-name`).
2. **"Playoff week" comes from the brackets, never from dates.** The `due` job counts the playoff games still to play
   (`bracket-due.mjs --playoff-week`): unscored playoffs.csv rows dated today or later, plus the next-round pairings the
   brackets set by winners. At 0 the details read is skipped with one short check, so after the State Championship it
   costs nothing.
3. **The game-day clock starts the morning read when the schedule does not.** Ticks from 13:00 to 14:59 UTC (7 to 9 AM
   Central) in November and December start the day's read unless one has started since 10:00 UTC: the details read on
   Monday to Thursday (Central), the plain morning read on Friday to Sunday. One read a day; once started, later ticks
   stand down.
4. **Built pairings dated by the game details are game-day games.** The game-day `--due` count and `--tonight` read add,
   in memory, each bracket-built pairing whose game details date it to tonight or the three game nights before as an
   unscored bracket row. Its final fills in as any other (with the game page as its source); a later listing of the same
   date and teams merges into it.
5. **Same politeness.** No new host and no new kind of request: the second source through `davecampbells.mjs` only (one
   request every 2.5 s, a 403 or 429 stops it, under the permission ADR 0025 records), TAIAO through `taiao.mjs`, which
   checks robots.txt every run and stops if the page is disallowed. SixManFootball.com, CalPreps, the Portal to Texas
   History and TAPPS's API are never read.
6. **An alert that names the game.** `.github/scripts/playoff-details.mjs` lists each unscored playoff game starting
   within 72 hours (a bracket-built pairing by its round's date when it has none) that the site would show without a
   kickoff or without a site, and comments on the robot-alert issue naming each: the two schools, league, division,
   round, Central date and what is missing. Never a score and nothing else from the data. The same games post at most
   once every 12 hours; a new or changed game posts at once. It runs after each morning and details read and with the
   hourly Site freshness check, and warns without failing either.

## Schedule in a playoff week (Central standard time)
| Day | Reads |
|---|---|
| Mon to Thu, 5:23 AM (schedule) or 7 to 9 AM (clock) | details read: kickoffs, sites, league bracket details; then the 72-hour alert |
| Fri to Sun, 5:23 AM (schedule) or 7 to 9 AM (clock) | full morning read, as before; then the 72-hour alert |
| Every day, 9:03 AM | catch-up game-day read (ADR 0030), unchanged |
| Every day, noon to 12:10 AM, every 10 minutes | game-day reads (ADRs 0015, 0019), now with dated built pairings |
| Every hour | Site freshness check and the 72-hour alert |

## Consequences
- A playoff game's kickoff and site show the morning after a coach sets them, any day of the week, with no hand run.
- The second source is asked about the week's playoff teams once more each Monday to Thursday morning: one team a game,
  2.5 s apart.
- A game still missing a kickoff or site three days out is named on the robot-alert issue, so it can be found by hand
  in time.
- The `details` input must be on `main` before the clock dispatches it (GitHub refuses an unknown input); it lands with
  the clock change in one pull request.
