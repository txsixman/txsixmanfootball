# ADR 0111: The game-day clock checks every minute, starts at 16:30 UTC, and its reads are short

**Status:** Accepted Nov 21, 2026. Amends ADR 0024 (the clock's hours and ticks), ADR 0027 (the alert's quiet rule) and ADR 0030
(the daytime catch-up). Their other rules stand.

## Context
Two game days (Nov 20 and 21, 2026) showed four faults.
- **The hours began too late.** The window began at 18:00 UTC (noon Central). A Saturday 11 AM Central kickoff (17:00 UTC) got no
  live read and no kickoff alert for an hour. The earliest real kickoff in the season's game details is 17:00 UTC.
- **Reads came every 20 minutes, not 10.** Ticks fell every 10 minutes and a tick was skipped while the last read was queued or
  running. Reads took 7 to 16 minutes, so after any read over 10 minutes the next start slipped a whole tick (for example 00:03,
  00:23, 00:33, 00:43, 01:03).
- **A read was long for what it did.** Each clock read ran the reader checks, the ratings model checks, the kickoffs and sites
  read and the regular-season sites read (about 2.5 minutes), and, on a read that committed a score, a report-only `deployed` job
  that waited up to 5 minutes for the deploy. The workflow's concurrency group held the next read until all of it ended.
- **The alert's quiet hid a new problem.** A failure was keyed by its workflow, jobs and failed steps and posted at most once every
  3 hours, so the same step failing again for a different cause was silent.

## Decision
- **Read hours start at 16:30 UTC** (10:30 AM Central, CST), half an hour before the earliest kickoff, and end at 06:10 UTC as
  before, in November and December. The morning checks (13:00 to 14:59 UTC) and the 15:00 catch-up stay before it and never overlap it.
- **The clock checks every minute** (a call to the run list each time, and none while it knows a read it started is under 9.5
  minutes old). It starts a read as soon as none is queued or running and the last read started 9.5 minutes ago (10 minutes less
  the seconds a run's creation falls after the check). Reads are 10 minutes apart, or as soon as a longer read ends: the gap is the
  larger of 10 minutes and the read's length. The guards stand: a read queued or running covers the check, GitHub's own schedule
  read in the last 12 minutes covers it, and a stuck read (ADR 0028) is replaced and posted at most once per gap. A read the clock
  just started counts at once, before the run list shows it. A check logs only when a read starts or the verdict changes.
  - The 15:00 to 15:09 catch-up (ADR 0030) is those checks starting one read by the same gap. The morning read starts at 13:00
    instead of 13:03.
  - The 5.5-hour run, the queued next run (ADR 0027) and the end of the season are unchanged.
- **A clock read is short.** A read the clock starts in the read hours is sent a new input, `clock` (Results watch declares it,
  default false), and skips the reader checks, the ratings model checks, the kickoffs and sites read and the regular-season sites
  read. CI runs the same tests on every push; the morning and details reads fetch kickoffs and sites. The morning reads, the
  catch-up and a hand dispatch are not marked and run every step. The `deployed` job does not run on a game-day read; the hourly
  Site freshness check still fails and emails when a deploy stays missing.
- **A new failure of the same step posts.** The alert's key (ADR 0027) now marks a job that ended as a timeout or cancel, and
  carries a fingerprint when a step gives one: Results watch hashes the data check's list of problems to 8 hex digits and passes
  them on. The same fingerprint stays quiet for 3 hours; a new one posts at once. The issue's text is unchanged and carries no
  cause: the hash sits only in the hidden key.

## Consequences
- A game that starts at 11 AM Central has a read before kickoff and its kickoff alert on time.
- Score reads come about every 10 minutes (the site's 25-minute stale cutoff for live scores was two missed reads, and is now
  less likely to be reached).
- About 480 calls to the run list on a game day; far below the token's hourly limit.
- A step failing for a different cause with no fingerprint (a step with no list of its own, such as the games load) still hides
  behind the last alert for 3 hours; its cause is in the run's log.
- Tests: `gameday-clock.test.mjs` (the window, the minute checks and the 10-minute gap on 7- and 12-minute reads, the inputs a read
  is sent, the workflow's skip rules) and `ops-alert.test.mjs` (the key and the fingerprint), on fakes only.
