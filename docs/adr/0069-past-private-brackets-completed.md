# ADR 0069: Past private-league brackets keep games against schools outside today's alignments

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It widens ADR 0008's reader for past seasons
(TAPPS, TAIAO and TCAF only). It keeps ADR 0031's store rules, except that a past full reread names those brackets' rounds
again.

## Context
- A past season is read from the same team pages as the season under way (`maxpreps.mjs --season <year>`), and the reader
  kept a game only when both teams were in today's alignments. A game against any other school went to the private
  `outside.csv` (the ratings' hidden teams) without its bracket.
- Private-league schools come and go: they close, move to 11-man, or change leagues. So the 2018 to 2025 TAPPS, TAIAO and
  TCAF brackets lost every game against such a school. Example: San Marcos Academy's 2021 TAPPS Division I semifinal
  against a school no longer listed was missing, though San Marcos played the final.
- Measured on the stored files before this change (later rounds as the check, see Measurement): 290 listed games in 42
  past private brackets (2018 to 2020 TAPPS and 2020 TAIAO 2 had no game at all: their bracket names were not matched),
  34 proven open slots (a team that played a later round, or won short of the final, with no
  game listed in a round), and 56 more slots where a team's first listed game came after its bracket's first week while
  its schedule shows a game that week.

## Decision
1. **The lead is our school's own page.** A past season's read keeps a TAPPS, TAIAO or TCAF bracket game (one MaxPreps
   lists as a playoff in that league's six-man bracket) between one of our schools and a school outside our alignments.
   It is read from our school's schedule page, the only page the reader reads for it. No new source and no new kind of
   page. The bracket name is matched in each season's spelling ("6 Man Division II", "6-Man II"; TAIAO "Division 2").
2. **The other team is named as the source names it.** If that name is one of our schools' names, or two unlisted pages
   share it, the city is added ("Veritas (Austin)"), so it never reads as a listed school. Commas and quotes are dropped.
   Two copies of one game that disagree on the score are left out and counted in `coverage.txt`. A bracket game listed
   twice a day or two apart with the same score (once on each team's page) keeps one row, the later copy, as
   `data/corrections` does; a stored row always stands (`withoutNearCopies`).
3. **Normal capture path.** Rows go into the private `maxpreps-<season>/playoffs.csv` with the game's source page in
   `source_url`, through the store's merge (ADR 0031). A stored row's teams, date, score and source are never
   overwritten. `publish.mjs` copies the facts to `data/seed`.
4. **Rounds are named again from the whole bracket.** On a past season's full `--reread` only, and for TAPPS, TAIAO and
   TCAF only, every stored row's round is named again from its whole stored bracket (`relabelRounds`). A round is the
   reader's own inference from the game weeks, never a fact the source gives. Earlier reads saw only part of a bracket and
   named some rounds a week off: in 2021, TAIAO 2 and TAPPS II each had a game stored in the last round a week before the
   State Championship. A bracket is named again only when it is complete and consistent: exactly one State Championship
   game, and no week with more games than its round can hold (one in the last week, two the week before, four before
   that). A partial bracket keeps its stored rounds and is listed in the run summary. A new row's round comes from the
   same weeks: in TAPPS and TAIAO a last listed week with two games is semifinals whose State Championship no listed page
   shows (2020 TAPPS I), never two State Championship games. TCAF's two-division seasons do play two in one week. The database load renames that game
   in place, matched by date and both teams, so it is never stored twice. A past game's page is by date
   (`<date>-<away>-at-<home>`), never by round, so no page moves (tests: `past-game-pages.test.mjs`,
   `e2e/past-playoff-links.spec.ts`). UIL's rounds and the season under way's rounds are not touched.
5. **Where they show, and where they do not.** Bracket pages already show a team missing from today's alignments as plain
   text, with no link and no crest. The game is not added to `games.csv`: that file holds games between listed schools,
   and the result already informs the ratings from `outside.csv`. The database load leaves out a past playoff row naming a
   school that is no program and counts it. A name that is a program but has no team-season that season still stops the
   load, as any unknown team does. The integrity check does not look for these rows in `games.csv`.
6. **What stays blank.**
   - A slot whose game no listed school's page shows. Either both teams are outside our alignments, or the page never
     tagged the game as a playoff. Nothing is inferred.
   - A team whose first listed game comes after its bracket's first week while its schedule shows no game that week: a
     bye, or a game the source does not list. It is never filled.
   - UIL brackets (not in scope; UIL's own records are the better source) and the season under way, whose alignments are
     its own.
   - TCAF's past seasons with two six-man divisions ("6 Man I", "6-Man II") stay one "Six-Man" bracket, as the stored
     rows already have them. Splitting them would rewrite kept values, so it needs a decision of its own.

## Measurement
A slot is one team's game in one round. *Proven open* means a team played a later round, or won its last listed game
short of the final, and has no listed game in a round between them. A team never has a bye in the middle of a bracket,
and a bracket that lists only its final had semifinals. *Possible* means a team's first listed game is after the
bracket's first week, split by whether its schedule shows a game that week (a game no listed page tags) or none (likely a
bye). Counts by season, league and division are in the pull request; by season:

| Season | Brackets before → after | Listed | Proven open | Late first game, a game that week | Likely byes |
|---|---|---|---|---|---|
| 2018 | 3 → 6 | 11 → 58 | 3 → 3 | 3 → 1 | 3 → 11 |
| 2019 | 3 → 6 | 10 → 61 | 2 → 2 | 3 → 0 | 6 → 11 |
| 2020 | 2 → 6 | 7 → 52 | 1 → 12 | 3 → 3 | 5 → 26 |
| 2021 | 6 → 6 | 36 → 65 | 7 → 2 | 11 → 5 | 12 → 22 |
| 2022 | 7 → 7 | 44 → 64 | 7 → 1 | 10 → 1 | 4 → 14 |
| 2023 | 7 → 7 | 48 → 69 | 6 → 2 | 6 → 1 | 9 → 13 |
| 2024 | 7 → 7 | 63 → 79 | 6 → 1 | 8 → 2 | 7 → 15 |
| 2025 | 7 → 7 | 71 → 83 | 2 → 0 | 12 → 5 | 6 → 9 |
| **All** | 42 → 52 | **290 → 531** | **34 → 23** | **56 → 18** | **52 → 121** |

In the 42 brackets that had rows before, proven open slots fell from 34 to 9 and late first games with a game that week
from 56 to 16. The ten new brackets add 14 proven open slots, mostly 2020's TAPPS brackets, whose last listed week holds
two semifinals and no State Championship game. Likely byes rise because a bracket with more of its games listed shows
more of its byes. 241 games were added; 27 stored rounds were named again:

| Season | League and division | Rounds named again |
|---|---|---|
| 2019 | TAIAO 1 | semifinal → quarterfinal (1), State Championship → semifinal (1) |
| 2020 | TAIAO 1 | semifinal → quarterfinal (1), State Championship → semifinal (1) |
| 2021 | TAIAO 2 | semifinal → quarterfinal (2), State Championship → semifinal (1) |
| 2021 | TAPPS II | quarterfinal → round 1 (4), semifinal → quarterfinal (1), State Championship → semifinal (1) |
| 2022 | TAIAO 2 | State Championship → quarterfinal (1) |
| 2022 | TAPPS I | State Championship → quarterfinal (1) |
| 2022 | TCAF Six-Man | semifinal → quarterfinal (2), State Championship → semifinal (1) |
| 2023 | TAIAO 1 | quarterfinal → round 1 (2), semifinal → quarterfinal (2), State Championship → semifinal (1) |
| 2023 | TAIAO 3 | semifinal → quarterfinal (2), State Championship → semifinal (1) |
| 2023 | TAPPS I | State Championship → semifinal (1) |

Partial brackets, stored rounds kept: 2018 TCAF; 2019 TAPPS II, TCAF; 2020 TAPPS I, II and III, TCAF; 2021 TAIAO 1,
TCAF. TCAF's are its two-division seasons (two State Championship games in one week).

## Consequences
- The 2018 to 2025 private brackets gain the games their listed schools' pages show, with each game's source page kept
  privately. A past season is reread once with `--reread`. The pages are read politely, 2.5 seconds apart, about 25 minutes
  a season.
- Champions and finalists that have since left our alignments appear by name in their brackets, unlinked.
- The added games do not move the ratings: their results were already hidden-team games. A renamed round can. A game
  between two listed schools that was stored as a final (a neutral field) gets an earlier round's home edge. The affected
  seasons are re-rated after merge (`main.yml`, `run.py --chain`).
