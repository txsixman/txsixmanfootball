# ADR 0017: The code is public; the robot's raw captures are private

**Status:** Accepted Nov 12, 2026 (the owner). Adds to ADR 0008 (where the reader's files live); ADR 0008 is otherwise
unchanged.

## Context
The repo goes public as `txsixman/txsixmanfootball`, a fresh history with no earlier commits. Its game files held each
robot-read game's MaxPreps page (`source_url`), and the reader's working files (`teams.csv`, `outside.csv`,
`coverage.txt`) are raw third-party captures, not facts the site shows.

## Decision
- **Public repo:** `data/seed/maxpreps-<season>/games.csv` and `playoffs.csv` keep the facts the site shows (date,
  teams, score, site, round, end) and drop `source_url` and `notes`. `tools/league-watch/publish.mjs` writes them from
  the reader's folder and fails on a quoted cell, a missing column or a wrong cell count.
- **Private repo `txsixman/data-private`:** the reader's own `maxpreps-<season>/` folders, complete. `PRIVATE_DATA`
  (a checkout of it) points the reader, the ratings and the database loader at it.
- **The token** (`DATA_PRIVATE_TOKEN`, fine-grained, that one repo) is used only by push-to-main, schedule and dispatch
  runs: `main.yml` (ratings table, hosted database), `results-watch.yml`, `supabase.yml`. Pull requests never run with
  it; CI's data job fails if a pull-request workflow names it or passes `secrets: inherit`
  (`.github/scripts/token-guard.sh`).
- **Results watch commits the private repo first, then the public one**, and every run republishes from the private
  files, so a run whose public push failed is repaired by the next with no capture lost.
- **Cut-over is the repo variable `LIVE`.** Before it, schedules do nothing, and alerts, the hosted database and the
  ratings-table commit are skipped; a Results watch dispatch with `write` pushes both repos as a proof.

## Consequences
- A pull request cannot rebuild the published ratings exactly (no hidden teams without `outside.csv`); the DB tests load
  the public files instead. The push-to-main jobs rate and load from the private files.
- The hosted database keeps each game's source page; the public repo does not.
- Reader logs in public Actions runs can name a MaxPreps page when a read is retried or skipped.
