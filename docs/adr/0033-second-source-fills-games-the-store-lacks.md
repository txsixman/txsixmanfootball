# ADR 0033: The second source fills only regular-season games the store lacks, through the store's own merge

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Adds to ADRs 0031 and 0032. ADRs 0004,
0010, 0017, 0025 and 0029 stand.

## Context
- The second source's history read (ADR 0032) keeps a season's six-man games in the private repo, in
  `davecampbells-history-<year>/games.csv`. Its feed has games for 2026 only.
- Compared with the store (ADR 0031), most of its games are the same game with the same score. A few are games
  MaxPreps does not list at all.
- ADR 0032 set the merge rule: MaxPreps wins, the second source only fills, and disagreements stay private.
- This ADR is the step that applies that rule.

## Decision
- **The tool.** `node tools/league-watch/dc-fill.mjs <year> --private <private repo> [--dry-run]` is run by hand after
  a history read. It is never run by a workflow.
- **A game is added only when all of these hold:**
  - the store (`maxpreps-<year>/games.csv` and `playoffs.csv`) has no game of that date and pair;
  - the store has no game of that pair within 3 days either side (a date one source has wrong is not a second game);
  - it is dated before the season's first bracket game in `playoffs.csv` (a bracket game is never guessed into the
    regular season);
  - both teams are in the season's alignments;
  - the second source has a score. Its 0-0 placeholder is no score (ADR 0032), and so is a game both sides forfeited.
- **How it is written:** as the reader writes a regular-season game.
  - Names and division come from the alignments: the home school's division.
  - `round` is `season`, `neutral` is `false`, and `end_reason` is `unknown`.
  - A forfeit is 1-0 to the side that did not forfeit, as MaxPreps records one (`apps/web/lib/forfeit.ts`).
  - `source_url` is the second source's team page, and `notes` says the row came from the history read. `publish.mjs`
    drops both, so no page names a source (ADR 0010). The private copy keeps where each row came from.
- **Through the store.** The rows go through `store.mjs`'s `mergeStored`, as fill-only rows:
  - nothing already stored is touched, and no unplayed game is dropped (`readTeam` is always false);
  - the tool fails unless every row comes back as added.

  After that a filled game is an ordinary stored row. A later MaxPreps read showing a different score only proposes a
  change, which applies after two reads (ADR 0031).
- **The private report:** one row a second-source game in `davecampbells-history-<year>/history-check.csv`. Each row
  holds the date, both programs, both sources' scores in our home and away order, and a verdict:
  - `added`;
  - `agree` or `differs` (the store's game stands);
  - `near-date`, `playoff-time`, `not-aligned` or `no-score`.

  The run prints counts only, never a team or a score.
- **Publishing:** the season's next Results watch commit publishes the store through `publish.mjs`, as it does every
  read. A dry run writes the report and leaves the store alone.

## Consequences
- 2026 gains the few regular-season games MaxPreps never listed. Like every robot-read score, they show as unconfirmed
  (ADR 0004), and two sources confirm nothing under ADR 0011.
- `differs` rows are where one of the two sources is wrong. They are not acted on here. A person can check one and fix it
  through `data/corrections`.
- If the second source's permission is withdrawn, filled rows stay in the store like any other row. Removing them is a
  reviewed commit to the private repo: `notes` marks each one.
- Tests use invented fixtures only (`dc-fill.test.mjs`).
