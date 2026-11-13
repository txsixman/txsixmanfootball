# ADR 0032: Past seasons from the second source: its feed has games for the current season only

**Status:** Proposed Nov 13, 2026. The owner confirmed first-hand the same day that the written permission behind ADR
0025 also covers reading past seasons, and asked for history as far back as the feed goes. Accepted when its pull
request is merged.
Adds one use of the feed ADR 0025 reads: a season's finished games, read by hand into the private repo. Every rule of
ADR 0025 stands for these reads. ADRs 0004, 0010, 0017, 0026, 0029 and 0031 stand.

## Context
- The site's history comes from MaxPreps, read season by season (ADR 0008). MaxPreps misses some games.
- The second source's public feed lists its own high school football seasons (`/api/public/seasons`). On Nov 13,
  2026 it listed 2018 to 2026, plus a placeholder season named 1900.
- For each season the feed offers a game list (`/api/public/game-schedules`). We checked that list three ways: by
  team, by school, and for the whole season. It was empty for every past season:
  - 2025, for all 78 mapped teams;
  - 2024, 2021 and 2018, on spot checks.
  - The same teams list their 2026 games.
- For past years the feed gives each team's win-loss record only. That is a record, not games, and is not read.

## Decision
- **The reader, for whatever season has games:**
  - `tools/league-watch/davecampbells.mjs --seasons` lists the feed's seasons (year, id, sport, school type).
  - `--history <year> --private <private data repo>` reads the high school boys football season of that year. For each
    team in `davecampbells-teams.json` it asks for the team's id and its finished games
    (`status=Final,Completed,Finished,Forfeit,Double Forfeit`, every page).
  - `--team <year> <their slug>` is the diagnostic: one team's game count and status names in a season, with counts
    only, and no values beyond the status.
  - All three are run by hand, never by a workflow.
- **What is kept:** a game where both teams are ours.
  - A team is ours by the map, or else by its school name when that matches exactly one program in our published
    seasons or the lineage table (`sameSchool`, as the finals check uses). When our name adds a town to the feed's,
    the town must be in the feed's own team slug too, so a same-named school in another town is never taken for ours.
  - A program renamed after that season is written under the name it had then (`data/seed/lineage/programs.csv`).
  - One row a game in `davecampbells-history-<year>/games.csv` in the private repo (its own folder: Results watch
    replaces `davecampbells-<year>/` with its own copy on every commit): date (Central), home and away program
    slugs, both scores, and each side's forfeit flag.
  - Never a ranking, poll, spread or the `winner` field.
  - A final of 0-0 that is not a forfeit is the feed's placeholder, so it is written with no score.
  - Skipped and counted:
    - an 11-man or unknown opponent;
    - a game that is not finished;
    - a forfeit that names no side.
- **Merge rule,** for the fill step that comes next, agreed with the session that owns the store (ADR 0031):
  - MaxPreps wins wherever both sources have a game on the same date with the same two programs.
  - The second source only adds games that the store does not have. It never changes or blanks a stored score.
  - Where the two disagree (scores, or the same pair a day or two apart), nothing is added. The game goes into
    `davecampbells-history-<year>/history-check.csv` in the private repo.
  - An added game reaches `data/seed/maxpreps-<year>/` only through `publish.mjs`'s columns, so no page names a source
    (ADR 0010). The private copy keeps where each row came from.
- **Manners:** ADR 0025's client, unchanged:
  - our user agent, requests 2.5 seconds apart;
  - `/api/public/` only, no redirects;
  - a 403 or 429 stops the run at once.

  About two requests a mapped team, so a season takes about 7 minutes.

## Consequences
- **No backfill of 2018 to 2025 from this source.** The oldest season with games is 2026. If the feed later lists
  past games, `--history <year>` reads them with no change.
- The current season can fill regular-season games MaxPreps lacks, once the fill step lands.
- A game between two teams the map does not name, where neither is matched by school name, is missed. Rows added to
  `davecampbells-teams.json` widen coverage.
- Filled games stay unconfirmed on the site, like every robot-read score (ADR 0004).
- If the permission is withdrawn, the private files stay private and nothing more is read.
- Tests use invented fixtures only (`davecampbells.test.mjs`); no test calls the feed.
