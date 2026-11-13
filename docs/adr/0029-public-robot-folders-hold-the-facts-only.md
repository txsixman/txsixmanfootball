# ADR 0029: A robot-read folder in the public repo holds the two fact files only, checked in code

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Adds to ADR 0017. Its other rules stand.

## Context
ADR 0017 keeps the reader's captures in the private data repo, but one environment line kept them there:
- The results reader (`tools/league-watch/maxpreps.mjs`) and the ratings (`services/ratings/rows.py`) read and write under
  `PRIVATE_DATA`, and fall back to `data/seed` without it. A local run is meant to work that way.
- Results watch's commit staged the whole `data/seed/maxpreps-<season>/` folder.

Had the job's `PRIVATE_DATA` line been lost, a read would have written its captures (`teams.csv` with source links,
`outside.csv`, `coverage.txt`) into that folder, and the robot's commit would have pushed them to the public repo.

## Decision
- **The two fact files only.** A folder `data/seed/maxpreps-<year>` may hold `games.csv` and `playoffs.csv` and nothing
  else, and a robot-read folder must be named `maxpreps-<year>`.
  - `apps/web/scripts/check-data.mjs` fails on anything else (Finder's `.DS_Store` aside). It runs on every pull request,
    on main and in the robot's commit, so a hand-made pull request is caught as well as a robot run.
  - A backfill folder that needs another file fails this check on purpose. That would need a new decision.
- **Staged by name.** Results watch's commit stages those two files by name, never the folder, so a stray file is
  never pushed even if a check were skipped.
- **CI refuses to run without the private data.** In CI (`CI=true`), these refuse to run without `PRIVATE_DATA`, with a
  message that names it:
  - a read that writes captures (`maxpreps.mjs` default and `--tonight`; `--due` and `--canary` write none);
  - the season's table (`run.py --season`), which in CI is the published one.
  A local run without it is unchanged and still writes to `data/seed`.

## Consequences
- Losing `PRIVATE_DATA` in a workflow now fails the run, and is posted to the robot-alert issue (ADR 0027), instead of
  publishing captures or a table made without the outside games.
- `main.yml` stages `data/ratings` only, and `supabase.yml` commits nothing, so neither needed a change beyond the refusal
  above.
- Tests: `check-data.test.mjs` (the allow-list), `commit-results.test.mjs` (a stray capture is never pushed),
  `maxpreps.test.mjs` and `test_private_data.py` (the refusal), on invented files only.
