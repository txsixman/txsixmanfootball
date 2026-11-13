# ADR 0027: Robot failures are posted to one issue, and the game-day clock queues its next run first

**Status:** Proposed Nov 13, 2026, for robot failures that would otherwise go unseen; accepted when its pull request is
merged. Amends ADR 0024: the clock now queues the next run when a run starts, not when it ends. A failed run is now
reported by the robot-alert issue, not by GitHub's email. Every other rule of ADR 0024 stands.

## Context
- **Failures emailed no one.** GitHub emails a run's outcome to the person who started it. Since ADR 0024, the game-day
  clock starts Results watch, and each clock run starts the next. Those runs are the `github-actions` bot's: the 18:03
  UTC read on Nov 13, 2026 shows the bot as both actor and triggering actor. GitHub's notification docs cover only
  "runs that you've triggered" and scheduled runs, so a failed read, a cross-file data failure or a failed clock run
  would email no one.
- **The chain could stop unseen.** The clock handed on only at the end of a run. A run cancelled, timed out or left
  without its runner, or an API call that never answered, stopped the chain, and a cancelled run is not even reported
  as failed.

## Decision
- **One public issue collects robot alerts.** A `notify` job in `results-watch.yml` and `gameday-clock.yml` runs when a
  job it watches fails or is cancelled (a timeout counts). It runs `.github/scripts/ops-alert.mjs`, which:
  - comments on the one open issue the bot opened with the title "Robot alert: a scheduled job needs a look"
    (label `ops-alert`), or opens it;
  - lets GitHub email the owner, who watches the repo.
- **What the issue may say.** The repo is public, so the text names only:
  - the workflow, and each failed job and step, by our own names;
  - the run link.
  It never names a score, a school or a source.
- **Repeats are quiet.** The same problem (workflow, jobs and steps) is posted at most once every 3 hours, so a failure
  that repeats every 10 minutes sends one email, not sixty.
- **Closing the issue.** The owner closes it once things are fixed; the next alert opens a new one.
- **Token rights.** The notify jobs use the workflow's own token with `issues: write` and `actions: read`; no other
  token.
- **The clock queues its next run first.** Each clock run queues the next one before its first tick. The next run waits
  under `concurrency: gameday-clock` and starts however this run ends.
  - A failure fails the run (posted as above) and makes the queued run a retry; a newer queued run replaces the older
    one.
  - A retry that fails too cancels the queued run, and the chain stops.
  - A run that starts outside November and December, or after the season's last final, queues nothing.
  - To stop the clock by hand: cancel the queued run, then the running one.
- **Every API call times out after 30 seconds,** so a call that never answers fails the run instead of hanging it until
  the job limit.

## Consequences
- A robot failure reaches the owner whoever started the run: one issue, one email per problem every 3 hours at most.
- The clock survives a lost runner, a timeout or a cancelled run; the next run starts within a minute or two.
- The issue is public; its text is fixed by the script and carries no data.
- Tests: `ops-alert.test.mjs` (what is posted, de-duplication, opening and commenting) and `gameday-clock.test.mjs` (the
  next run queued first, retry and cancel, timeouts), on fakes only.
