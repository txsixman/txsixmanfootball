# ADR 0028: A stuck read and the second source's quiet problems are posted too

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Adds to ADR 0027's robot-alert issue and to
ADRs 0024, 0025 and 0026. Their other rules stand.

## Context
ADR 0027 posts a run that fails. Three problems would still go unseen.
- **A stuck read.** A Results watch read stuck waiting to start counted as "a read is queued", so the game-day clock
  skipped every tick behind it, all night.
- **The second source's steps never fail their run.** They run with `continue-on-error` (ADRs 0025, 0026), so these
  showed only in a run summary:
  - a refusal from the feed;
  - a season with no feed id;
  - a cross-check whose matching has broken, where every game reads as missing.

## Decision
- **A stuck read is counted as stuck.** A read is stuck when it has waited over 60 minutes to start, or run over 90
  (its jobs' limits add up to about 70). It no longer covers a tick: the clock starts a new read, which waits behind it
  or replaces it if it is the one waiting, and posts `read-stuck` (the clock's job gets `issues: write`).
- **The second source's problems are named, then posted.** Its steps write one word for each problem to a file. The
  `maxpreps` job passes the words on as an output, and the notify job posts each with its fixed text:
  - `second-source-refused`: the feed answered 403 or 429.
  - `second-source-no-season`: no feed season id from August on.
  - `second-source-no-agreement`: 10 or more checked games of the past game nights in the window, and none agree.
- **Only fixed text.** A named problem posts only the fixed sentence in `ops-alert.mjs` (`REASONS`) and the run link.
  The same problem is posted at most once every 12 hours, since it is a condition, not one run's failure.

## Consequences
- A stuck read costs at most one skipped hour, not a night.
- A refusal, a missing season id or a broken cross-check reaches the owner within a run, at most once every 12 hours.
  The steps still never fail Results watch, and nothing on the site changes.
- Tests: `gameday-clock.test.mjs` (stuck runs), `ops-alert.test.mjs` (named problems) and `davecampbells.test.mjs`
  (the season and agreement rules, the problems file), on fakes only.
