# ADR 0024: A game-day clock in GitHub starts the night's reads

**Status:** Proposed Nov 13, 2026, for game nights that need no one's computer; accepted when its pull request is merged.
Adds a way to start Results watch's game-day read. ADRs 0015, 0019 and 0021 stand as they are: what a read does is
unchanged, and `results-watch.yml` is unchanged.

## Context
Results watch's game-day reads were meant to start from its `schedule` cron lines, every 10 minutes of a playoff game
night (ADR 0019). GitHub's `schedule` events have never fired in this repo, not even after the cron lines were pushed
again (Nov 13, 2026). Since then a loop on the owner's Mac has started the reads (`gh workflow run results-watch.yml -f
tonight=true` every 10 minutes). A Mac that sleeps, shuts its lid or restarts means no scores that night.

## Decision
- **`.github/workflows/gameday-clock.yml`, started by hand, keeps the clock.** Each tick (:03, :13 ... :53 UTC), from
  18:00 to 06:10 UTC in November and December, it starts Results watch with `tonight=true`. A tick is skipped when a read
  is queued or running, when GitHub's own schedule started one in the last 12 minutes (if schedules start to work, the
  clock stands down), or when any read started in the last 8 minutes (the Mac's loop, a run by hand). Results watch's
  `due` job makes a tick with no game left a short check.
- **One run keeps the clock about 5.5 hours, then starts the next run and exits,** within GitHub's 6-hour job limit.
  `concurrency: gameday-clock` keeps one clock at a time: the next run waits and starts as the last one ends.
- **The chain stops by itself** when a run starts or ends outside November and December (UTC), or when every league
  and division in the season's `playoffs.csv` has a scored final and no game is left. It is started again by hand each
  season.
- **Its own token, no secrets** (`actions: write` to start workflows, `contents: read`). GitHub's docs say events made
  with the workflow's token start no new runs, except `workflow_dispatch` and `repository_dispatch`, which always do.
  So no personal access token is stored.
- **A failure is loud:** a dispatch or a run listing that fails ends the run as failed, so GitHub emails the owner. It
  hands on once, as a retry; a retry that fails too ends the chain rather than fail every 10 minutes all night.
- **The logic is a tested script,** `.github/scripts/gameday-clock.mjs`, with `gameday-clock.test.mjs` (the window, the
  ticks, the skip rules, the end of the season, failures and the hand-on, on a fake clock). Every tick's verdict goes to
  the run's summary. `dry_run` decides every tick and starts nothing, to prove it by hand.

## Consequences
- Game nights no longer depend on the Mac. Its loop stays as a second starter until the clock has run a night; the
  8-minute rule keeps the two from starting the same tick twice, and Results watch's own concurrency group queues any
  overlap.
- Free: standard GitHub-hosted runners cost nothing on a public repo. A run is nearly all sleep, about 11 runner-hours
  a day in November and December.
- If this repo went private, its sleeping runs would be billed by the minute, about 11 hours a day, far past the free
  plan's included minutes: stop the clock or move it before that.
- A missed tick costs at most 10 minutes; a failed chain is emailed and the reads fall back to the Mac's loop or a run
  by hand.
