# ADR 0065: Every game a source places gets its site, played or not

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It widens ADR 0041 (and ADR 0063's TAIAO
read) from bracket games still to play to every game a source places, under all of ADR 0041's rules, and follows up ADR
0064's coverage table.

## Context
- Sites were filled only for bracket games still to play. A played game kept "Site not listed yet" even where the second
  source names its venue (2026 bi-district games, for one).
- A regular-season game's page named the home team's own field (ADR 0064), even for a game played somewhere else.
- The second source lists its venue for every game of the current season it serves.

## Decision
1. **2026 backfill** from the second source's venues read (`davecampbells.mjs --venues 2026`, private) and TAIAO's own
   bracket, into `data/seed/game-details/2026.csv`, never overwriting a kept value (ADR 0041):
   - every bracket game they cover, played or not, with its kickoff where the read has one;
   - every regular-season game whose venue is not the home team's own field for that season (a neutral site, a moved
     game, or a team with no field on file).
   - A venue row is placed on a game of the season's files by its date and one of its programs (a team plays once a day)
     and takes that game's spelling of both teams. A game the two sources date one day apart is placed only when the
     opponent matches too and there is one candidate; it keeps the files' date and no kickoff.
   - `davecampbells.mjs --venue-details <year> --venues <venues.csv> --out <file>` does it with no network.
2. **Past seasons cannot be filled from the second source.** It lists seasons 2018 to 2025 but returns no games for them
   (Nov 15: 0 for each of three teams in 2025, 2023 and 2019; 12 for the same team in 2026). Past seasons keep what they
   have; ADR 0064's home fields stay same-season only, so no past season gets one.
3. **A played game's page reads the facts file first:** its site when the file has one, else, as before, "Neutral site or
   not listed" for a playoff game or the home team's field (or "<home team> (home)") for a regular-season game.
4. **The morning read fills played games too**, so nothing a source has stays blank:
   - Kickoffs and sites (second source): bracket games still to play, and played ones of the last 14 days still missing a
     kickoff or a site. Two weeks bounds the reads of a game the source never gives a site.
   - Regular-season sites (second source, new step): regular-season games of the last 3 days with no site yet, one mapped
     team a game, at most 15 minutes. The home team's own field adds no row.
   - TAIAO's bracket (ADR 0063): its games played or still to play.
   - All three are off or harmless exactly as before: the same repo variable, the same never-overwrite merge in the
     commit step, counts only in the log.
5. **TAPPS and TCAF stay blank** unless the second source names a venue (the owner, Nov 15): no by-hand rows for now.
   ADR 0064 item 2's by-hand path stays open.

## Coverage, 2026 (Nov 15)

Games of the 2026 files whose page names a site, before (main, Nov 15) and after this backfill. A regular-season game counts
when the facts file names its site or the home team has a home field on file (ADR 0064). Addresses (ADR 0066) were 0
everywhere before.

| Games | Before | After | With an address after |
|---|---|---|---|
| UIL Division I bracket, played | 8 of 16 | 15 of 16 | 14 |
| UIL Division I bracket, to play | 2 of 2 | 2 of 2 | 2 |
| UIL Division II bracket, played | 8 of 16 | 16 of 16 | 13 |
| TAIAO bracket, played | 0 of 33 | 30 of 33 | 0 (TAIAO's next read fills its own) |
| TAIAO bracket, listed to play | 0 of 5 | 0 of 5 | 0 (the 5 are voided pairings) |
| TAPPS bracket, played | 1 of 30 | 4 of 30 | 4 |
| TAPPS bracket, to play | 0 of 5 | 0 of 5 | 0 |
| TCAF bracket, played | 0 of 3 | 0 of 3 | 0 |
| UIL Division I regular season | 332 of 394 | 342 of 394 | 277 |
| UIL Division II regular season | 323 of 342 | 325 of 342 | 229 |
| TAPPS regular season | 15 of 273 | 19 of 273 | 18 |
| TAIAO regular season | 3 of 150 | 7 of 150 | 7 |
| TCAF regular season | 0 of 31 | 2 of 31 | 2 |
| Independent regular season | 0 of 6 | 0 of 6 | 0 |

The venues read gave 1,029 games with one of our programs at home (48 bracket, 46 of them with a venue). Placing them
on the season's files: 97 facts rows (50 bracket, 47 regular season), 607 skipped at the home team's own field, 256 with
nothing new, 69 on no game of the files. Home fields: 138 of 211 programs with home games have a clear one. TAPPS and
TCAF gain only what the second source names; no row is by hand.

## Consequences
- Every UIL bracket game the second source lists shows its site, played or not, and most TAIAO bracket games do.
- Regular-season pages name the field where the game was played when the second source knows it, not the home team's.
- The morning read makes a few more feed requests on Friday to Sunday mornings: about one team a game played in the last
  3 days, within the 2.5 second gap.
