# ADR 0021: Live scores from the game-day read

**Status:** Accepted Nov 13, 2026 (the owner: "Build maxpreps end to end"). Adds to ADRs 0015 and 0019: the same pages,
the same requests, one more thing taken from them. Every other rule of ADRs 0004, 0008, 0009, 0010 and 0013 stands.

## Context
The game-day read (`maxpreps.mjs --tonight`, every 10 minutes noon to midnight Central on playoff game days) already
opens one schedule page per unscored bracket game and keeps only finals. A game under way shows on that same page with a
score for both teams and no result yet. Until now that score was thrown away, so a visitor saw "7:30 PM" until the final
was committed, a rebuild and a deploy later.

## Decision
- **What is read:** on the pages already read, a game of tonight with a score for both teams and no result is "live". The
  reader writes those games, and only those that are tonight's still-unscored bracket games between two schools in our
  alignments, to a JSON file (`--live-out <file>`): the site's game key (date, then both program slugs, sorted), both slugs,
  both scores, the period when known, and when it was read. Nothing else is taken from the page: no name, link, place,
  narrative or player (ADR 0008).
- **Where it goes:** the table `live_score` (migration 0016), one row a game, replaced on every run by
  `packages/db/live.mjs` in one transaction: rows in the file are written, rows not in it are deleted (a game that went
  final or vanished stops being live), and any row read over 6 hours ago is deleted. The write runs inside Results watch
  right after the read, as the database owner, only when the repo variable `LIVE` is true and the database secret is set;
  a failure is reported and never stops the finals from being committed. A live score is never committed to either repo
  and never triggers a rebuild. Only finals still commit, as before.
- **Who may read it:** `live_score` is closed to the API roles like every other table (migration 0005): row-level
  security on, no policy, no table right for `anon` or `authenticated`. They read it only through `public.live_scores()`
  (migration 0016), a read-only `security definer` function (stable, `search_path` pinned, EXECUTE revoked from PUBLIC and
  granted to both) that returns the table's rows read in the last 6 hours, at most 200. It is listed with the other public
  reads in `checkLive`, so the post-load check and the API-role tests need no exception.
- **How it shows:** the game page and the `/scores` board call `POST <Supabase URL>/rest/v1/rpc/live_scores` in the browser
  with the public publishable key, the same URL and key push alerts use (`lib/supabase-public.ts`, one module for both; no
  sign-in setting such as `FAN_SIGNIN` is involved), every 60 seconds while the tab is visible. A game with
  a live row and no final shows "Live · Q3 · 14–28 · Unconfirmed" (the period only when known; scores in the order the page
  lists the teams), the two teams with their scores, and when it was read, in Central time. It names no winner and no
  leader (ADR 0004: a robot-read score is unconfirmed), uses no betting word and names no source (ADRs 0009 and 0010). A
  game that has a final ignores its live row. A failed request or a row that fails its checks shows nothing extra. A row
  read more than 90 minutes ago is not shown either: the reads replace rows every 10 minutes, so an older one means they stopped.
- **No early "Live 0–0".** A game not yet started may list 0–0. The reader writes no 0–0 row without a period, and the
  browser ignores a 0–0 row with no period. While `PERIOD_INDEX` is null that is every 0–0 game; it shows once the period
  is known and a game really is 0–0.
- **The period is not known yet.** Nobody has seen a real in-progress MaxPreps page. The reader's constant
  `PERIOD_INDEX` is null, so the period is null and pages show the score alone. Each night run's summary already lists the
  fields of a game under way (`inProgressShape`); the first such summary says which contest index holds the period, and
  setting that constant (and its mapping in `periodText`) is the only change needed. It is never guessed.

## Consequences
- A score reaches a visitor within about 10 minutes of the game's page showing it (plus GitHub's start delay), without a
  commit, rebuild or deploy.
- No new request to MaxPreps: the same pages, one a game a run, with the same manners (ADR 0015).
- The API roles gain one function (`live_scores()`) and no table right. The data is public facts about games under way and
  carries no user, source or contact detail; a visitor can read it and nothing else, and cannot change it.
- Every visit to `/scores` or a game page with an unfinished bracket game asks Supabase about live games. If the project is
  unreachable (a free project pauses after 7 days without activity) the request fails and nothing extra shows.
- Page tests never reach the real project: `e2e/live-route.ts` answers the request with `[]` for every spec that opens a
  scoreboard or game page, and `e2e/live-scores.spec.ts` answers it with fixtures.
- A game page whose bracket row has no final yet and whose teams MaxPreps lists differently than our alignments (no
  slug match) shows no live line: the reader keeps only games it can name by our slugs, as for finals.
- Regular-season games are not covered, as in ADR 0019: the files list a game only once it is played.
- Stop on request, as ADR 0015: remove `--live-out` from the workflow and the table stops filling; the rows age out in 6 hours.
