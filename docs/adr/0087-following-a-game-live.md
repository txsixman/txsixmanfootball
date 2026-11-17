# ADR 0087: Following a game live (game page, scoreboard, Tonight), Nov 16, 2026

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It changes how pages show a game that is under
way or just over, not what any page says about a result. ADRs 0021, 0036, 0038, 0039, 0043, 0044 and 0080 stand: the live
route, the polling interval (every minute while the tab is visible and a game may be on) and the "Unconfirmed, no leader"
rules are unchanged, and no page asks for more than before.

## Context
Reviewed as a fan on a phone on a game night (Nov 19 to 21 are the next ones):
- **The game page jumped.** The live line sat above the score and arrived after load, pushing the score and everything below
  down by about 50 px (and back when a game left the table). The top band said "In progress" in blue whether or not a score
  had come in.
- **A game past kickoff with no score said little.** The band read "In progress"; the score area was two dashes. After four
  hours it read "Score not reported yet" with no word on what to do.
- **A stale read looked live.** A score is shown up to 90 minutes after it was read; at 40 minutes the page still said "Live".
  Nothing said how long ago it was read except a clock time.
- **A final said nothing about what comes next.** The page linked "Next playoff game" with no day, site or opponent, and
  (rightly, ADR 0004) never said who it was for.
- **The scoreboard listed a game under way with no score yet under "Later".**
- **Tonight kept the site's organization order whatever was on.** A TAPPS game in the third quarter sat under a UIL list of
  finals, and the page had no count of what was live.

## Decision
- **The game page holds a place for the live line from the first paint** (`min-h-[3.75rem]`, `aria-live="polite"`), for a game
  with no final that has a date. The place is never blank: before kickoff "Not started · Kickoff 7:00 PM CT"; inside the
  four-hour window with no row "In progress · No live score yet. This page checks every minute."; past the window "Score not
  reported yet · Kickoff was 7:00 PM CT. No score has come in. Reload later to check."; a game with no time "Kickoff time not
  listed". `pendingNote` in `lib/kickoff.ts`, worked out in the browser at the moment of viewing (ADR 0036). The line under
  the score for the projection holds its place the same way. A score arriving or leaving moves nothing (`e2e/game-night-live.spec.ts`
  measures the score's and the details' positions across both).
- **The top band is one line in every state.** A game the live read has a score for turns red and reads "Live" with
  "Updated 3 min ago" at its right (`updatedAgo`: "just now", minutes, then the clock time past an hour); a finished read
  reads "Final" (ADR 0043); anything else keeps its kickoff status. The existing line under it ("Live · Q3 · 4:12 left · as of
  7:42 PM CT · Unconfirmed") is unchanged.
- **A read two reads old says so.** `LIVE_STALE_MS` is 25 minutes (the writer replaces rows every 10). A row older than that is
  still shown, until the existing 90-minute limit, with "may be behind" after "as of …" on the game page, the scoreboard and
  Tonight, and in the band. A finished row is never "behind". `LiveView` gains `stale`.
- **After a confirmed final of this season's playoffs: "What's next for <winner>".** `app/scores/[id]/whats-next.tsx`, from
  the bracket as built (`loadBrackets`): the winner's earliest game still to play (listed or set by the bracket, ADR 0047)
  with the round, the opponent (or "the winner of X–Y"), the day, kickoff and site as the data has them ("Day and time not
  listed yet", "Site not listed yet"), linked to that game's page, else to the bracket. A later game already played that the
  winner won is passed over to the one after; one it lost, or one with no confirmed winner, shows nothing; no later game
  listed shows "Moves on to the <next round>. The opponent, day and site are set as the bracket fills in."; the last round
  and a past season show nothing. Only a confirmed final (ADR 0040) names a winner, so a disputed or unconfirmed score never
  gets the box. The rule is `lib/whats-next.ts` (pure, `scripts/whats-next.test.mjs`).
- **The scoreboard lists a game under way with no score yet under "Live now"**, its row saying "In progress" and "No live score
  yet. Checked every few minutes.", counted in the Live jump. A game the clock cannot place (the server, the first render)
  stays under "Later".
- **Tonight stays one list per organization (ADR 0012) but puts what is on first.** Organizations are ordered by the clock: one
  with a game in progress, then one with games to come, then one with a game not reported, then one with only finals; ties
  keep the site's order (`orgRank`). A sticky strip at the top counts, across every organization, Live, Up next, Final (and No
  score when there is one) and jumps to the first organization that has each; it counts games, never mixes them. A game under
  way with no score or past its window says so on its row.
- **No new request, no new interval.** All of it reads the one live read each page already makes. There is no refresh button:
  the pages refresh themselves every minute while a game may be on and again when the tab returns, which is the limit ADR
  0080 set.

## Consequences
- Every game page for a game with no final and a date is about 60 px taller than before, the held place, which is filled with
  the kickoff note rather than left blank; layout shift on the page stays 0 (the note's text changes in place) and the script cost
  is a few hundred bytes (`lib/kickoff.ts` and `lib/live-scores.ts` were already on these pages).
- A past-kickoff game's page says plainly that no score has come in and to reload: the window ends at four hours and the
  page stops asking then, so reloading is the true instruction.
- "What's next" reads the bracket at build time, like the rest of the page: it is as current as the last results commit, and a
  rebuild each game night (the robot's commits) keeps it so.
- Tonight's organization order now changes with the clock after load (the first paint is the site's order with every game
  with no final under "Up next", the same everywhere); the strip's counts change with it.
