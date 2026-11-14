# ADR 0038: "Scores checked", the time of the last game-day read

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Amends ADR 0021: the same writer, the same
transaction, one more row. Every other rule of ADRs 0004, 0008, 0009, 0010 and 0013 stands.

## Context
- Tonight and `/scores` are static pages. A visitor watching a game night cannot tell a score that has not changed from
  a read that has not happened. The pages say when they were built ("Page updated"), which on a game night is the last
  commit, not the last look at the scores.
- A commit's time would be wrong. Results watch commits only when a final changes, so a quiet half hour of game-day
  reads leaves the last commit half an hour old although the scores were checked a minute ago. Committing a timestamp on
  every run is no fix: each commit deploys the site, so every 10-minute run would deploy (ADR 0021 keeps live scores out
  of the repo for the same reason).
- ADR 0021 already sends something to the hosted database after each game-day read, in one transaction. The time of that
  run belongs beside it.

## Decision
- **The table:** `read_status` (migration 0017), exactly one row. The key is `id boolean primary key default true check
  (id)`, so a second row cannot exist; `read_at timestamptz not null`. It is replaced on every run, with no history.
  Row-level security is on, with no policy and no table right for `anon` or `authenticated`, as for every table
  (migration 0005) and for `live_score` (migration 0016).
- **The read:** `public.results_read_at()` returns that one timestamp (null when there is no row). It is read-only,
  `security definer`, `stable`, with `search_path` pinned, EXECUTE revoked from PUBLIC and granted to `anon` and
  `authenticated`: the pattern of `live_scores()`. It is listed with the other public reads in `checkLive`, so the
  post-load check and the API-role tests need no exception and name any other function or any table right as before.
- **The write:** `packages/db/live.mjs` upserts `read_status` first inside its existing transaction, on every game-day run,
  including one whose live file holds no game (the reader writes `[]` and the table is cleared as before). The time is that
  run's own clock, taken when `live.mjs` starts, a few seconds after the reader finished: the live file carries a read time
  for each game, not for the run. The upsert keeps the later of the stored and the new time, so two runs that finish out of
  order never move it back. A failed run rolls back with the rest and leaves the earlier time. Results watch already runs
  `live.mjs` after every game-day read, whether or not a game is under way. The morning read does not write the file, so it
  does not write the time.
- **How it shows:** a line of plain muted text under the heading of Tonight and of `/scores`. The browser calls
  `POST <Supabase URL>/rest/v1/rpc/results_read_at` with the public key (`lib/supabase-public.ts`), on load and every 60
  seconds while the tab is visible, and only once today's games have started: the page lists a game on today's game night
  (a night runs until 6 AM Central, `lib/game-night.ts`) that has reached its kickoff or has a final. On any other day, before the
  first kickoff, or while the tab is hidden, it asks for nothing. The copy, with `now` the viewer's clock and `read` the
  answer:
  - under 1 minute old: "Scores checked just now";
  - 1 to 59 minutes: "Scores checked 4 min ago";
  - 60 minutes or more: "Scores checked at 8:42 PM CT" (Central time, the site's time format);
  - more than 30 minutes past the day's first kickoff with no read newer than that point: "Scores may be behind";
  - nothing before the first kickoff, and nothing at all when the request fails or the answer is not a time or null.
    Never an error message.
- **The first kickoff** is the earliest kickoff the page lists for the night (ADR 0036). A game already played no longer
  lists its own, so once any game has a final the earliest one left stands in for it, which can only make "may be behind"
  appear later, never earlier. A night whose games list no kickoff and none played shows nothing.
- It names no source and no winner, and uses no betting word (ADRs 0004, 0009, 0010).

## Consequences
- A visitor can tell a quiet game from a stale page within about a minute, without a commit, rebuild or deploy.
- The API roles gain one more function (`results_read_at()`) and still no table right. It returns one time and carries no
  user, source or contact detail.
- Every visit to Tonight or `/scores` on a game night, after the first kickoff, makes one more small request to Supabase. If the
  project is unreachable (a free project pauses after 7 days without activity) the request fails and nothing shows.
- The line compares the recorded time with the viewer's clock, so a device whose clock is wrong reads wrong by that much.
  The time is the run's, not the page's: a score that has not changed in an hour still reads "checked 4 min ago".
- Results watch stops its game-day reads once every bracket game of the recent nights has a score (ADR 0030). After that
  the line keeps the last time ("Scores checked at 10:41 PM CT"), which is true.
- A night read that fails writes no newer time, so the line moves to "Scores may be behind" about half an hour after
  the first kickoff, and stays there until a read succeeds.
- Page tests never reach the real project: `e2e/live-route.ts` answers `results_read_at` with `null` for every spec that
  opens a scoreboard, and `e2e/scores-checked.spec.ts` answers it with fixtures at fixed clock times.
- Stop on request: remove the line from the two boards and the table stops mattering; `live.mjs` keeps writing one row.
