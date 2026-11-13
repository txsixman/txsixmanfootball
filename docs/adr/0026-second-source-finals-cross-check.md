# ADR 0026: The second source's finals cross-check MaxPreps, in a private report

**Status:** Proposed Nov 13, 2026; the owner confirmed first-hand the same day that the written permission behind ADR
0025 also covers reading finals, and approved this use. Accepted when its pull request is merged.
Adds one use of the feed ADR 0025 reads: the finals of bracket games, compared with MaxPreps' in a report kept in the
private data repo. Every rule of ADR 0025 stands for these reads. ADRs 0004, 0010, 0011 and 0017 stand; nothing on the
site changes.

## Context
Every robot-read final has one source, MaxPreps (ADR 0008). ADR 0011 confirms a score only when three sources agree,
and marks a game Disputed when sources disagree, but until now there was no second source to compare against. ADR
0025 named this as the next step: finals from the same feed, with a report of the games where the two disagree.

## Decision
- **What is read:** on every Results watch run that reads (game-day ticks and the morning reads), after the MaxPreps
  read, `tools/league-watch/davecampbells.mjs --finals <private playoffs.csv> --report <private davecampbells-<season>/>`
  takes the bracket games MaxPreps has scored in the last three game nights, skipping MaxPreps forfeits and games
  already settled. For one mapped team a game it asks the feed for the team's id (once; the id is then kept in the
  private repo) and for `GET /api/public/game-schedules?...&status=Final,Completed,Finished,Forfeit,Double
  Forfeit&sort=NEWEST`. That is the status list already known; there is no separate probe of the feed.
- **What counts as a final:** status Final, Completed or Finished, in any case. A forfeit (by status or a side's flag)
  is skipped. A matched game whose status is none of these logs its field names once, never its values.
- **Verdicts,** one row a game in `davecampbells-<season>/finals-check.csv` in the private repo:
  - `agree` or `disagree`, comparing the two finals in the bracket row's home and away order;
  - `dc-missing`: no final in the feed yet;
  - `dc-forfeit`;
  - `unmatched`: no mapped team, or no id.
  The row keeps both programs' slugs, both sources' scores, the verdict and when it was first and last checked, and
  nothing else from the feed. `agree` and `dc-forfeit` are settled unless MaxPreps' score changes. Every other verdict is
  checked again on later runs while the game is within the three nights.
- **Manners:** ADR 0025's client is unchanged: our user agent, 2.5 seconds apart, `/api/public/` only, no redirect, and
  a 403 or 429 stops the run at once with nothing written. At most 8 teams are asked a run, oldest games first.
- **Private only:**
  - The report and the team ids go into the private repo's commit (`.github/scripts/commit-results.sh`), never into
    this repo; `publish.mjs` is unchanged.
  - The public run summary shows counts only, never a team or a score.
  - A disagreement is reported only as that count: no issue or email is raised, and `DATA_PRIVATE_TOKEN` is unchanged.
- **Switch:** the step runs only when the repo variable `SECOND_FINALS` is `true`, with `continue-on-error`, apart
  from ADR 0025's `SECOND_LIVE`.

## Consequences
- Nothing on the site changes: no Disputed mark, and no change to a page or a confirmation. The report collects for a
  few weeks; a later ADR decides what a disagreement does on the site. Two sources confirm nothing under ADR 0011,
  which needs three.
- About 2 requests per checked team per run, most runs none (games settle).
- The report's `unmatched` and `dc-missing` counts show where the team map (`davecampbells-teams.json`) needs rows.
- If the permission is withdrawn, set `SECOND_FINALS` (and `SECOND_LIVE`) to anything else.
- Tests use invented fixtures only (`davecampbells.test.mjs`, `commit-results.test.mjs`); no test calls the feed.
