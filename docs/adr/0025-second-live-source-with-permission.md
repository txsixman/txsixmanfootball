# ADR 0025: A second live source, read with its owner's written permission

**Status:** Proposed Nov 13, 2026; the owner confirmed first-hand the same day that the written permission exists and
approved this use. Accepted when its pull request is merged.
Changes one line of ADR 0014 ("never Dave Campbell's API") for one use: live scores of tonight's bracket games, read from
Dave Campbell's Texas Football's public game-schedule feed under that site's written permission. Every other rule of ADRs
0004, 0008, 0009, 0010, 0013, 0015 and 0021 stands.

## Context
ADR 0008 ruled the site out because its scores load from `/api`, which its robots.txt disallows; ADR 0014 repeated it.
That reason was the missing permission, not the data. The site's owner has since given written permission to read the
feed. The permission itself is kept outside this repository; this record says only that it exists and what it covers.

Live scores (ADR 0021) come from one source, a MaxPreps schedule page read every 10 minutes. A game whose page is slow to
update shows nothing live. A second source that sees the same game fills that gap.

## Decision
- **What is read:** on a playoff night read (ADR 0015) only, after the MaxPreps read, `tools/league-watch/davecampbells.mjs
  --live <playoffs.csv> --merge <live.json>` takes tonight's still-unscored bracket games (the same Central game-night
  rule), and for one mapped team a game asks `GET /api/public/teams/<team>?seasonId=<season>` for the team's id and
  `GET /api/public/game-schedules?seasonId=<season>&teamId=<id>&status=Live,Upcoming` for its games. Nothing else on the
  site is asked for; the client refuses any path outside `/api/public/`.
- **What is kept:** for a game under way that is one of tonight's bracket games between two mapped programs: both
  program slugs, both scores, the period (Q1 to Q4, Halftime or OT; never a clock) and when it was read, in the live-row
  shape of ADR 0021. Never a point spread, ranking, poll, `winner` field, name, story or player. Forfeits are skipped.
- **Teams:** `tools/league-watch/davecampbells-teams.json` maps a program slug to that site's team slug, reviewed by hand.
  It starts with the 78 programs whose logo page in `identity.json` is that site's team page; more are added from the
  site's team sitemap by school name, one reviewed row at a time. A game with no mapped team is not read. When one team
  is mapped, the other is its opponent in tonight's bracket row, kept only if the feed's school name matches that
  program's slug (the same, or one is the other plus a town); otherwise the game is skipped.
- **Merging:** one row a game. Scores only rise during a game, so of two rows for the same game the higher total is the
  newer read; on a tie, the one with a period. The row never names a winner, and the site keeps showing it as unconfirmed.
- **Manners:** our own user agent (the results reader's), one request at a time at least 2.5 seconds apart, no redirect
  followed. A 403 or 429 stops the read at once with no retry. Nothing read is committed to this repository.
- **Switch:** the workflow step runs only when the repo variable `SECOND_LIVE` is `true`, with `continue-on-error`; a
  failure leaves the MaxPreps rows as they were.
- **Pages:** no page names the source (ADRs 0009, 0010). A live score stays "Unconfirmed" (ADR 0004).

## Consequences
- A live score can show when either source has it. At most two requests per mapped bracket game a run.
- The permission is the basis: if it is withdrawn, set `SECOND_LIVE` to anything else and the reads stop on the next run.
- Later, by a new ADR: finals from the same feed as a second source for ADR 0011's confirmation, with a report of games
  where the two sources disagree.
- Tests use invented fixtures only (`davecampbells.test.mjs`); no test calls the feed.
