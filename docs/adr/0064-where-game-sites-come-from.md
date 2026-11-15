# ADR 0064: Where a game's site comes from, league by league

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It maps every source a game's site could come
from, says which are reliable and allowed, and adds one: each program's own field for regular-season games. It keeps
every rule of ADR 0041 (plain words, name and city only, never overwrite) and ADR 0010 (no page names a source).

## Context
- A game page shows "Site: <name>, <city>" for a bracket game whose site is known (ADR 0041), "Site not listed yet"
  otherwise, and "<home team> (home)" for a regular-season game.
- Sources were measured on the 2026 season (Nov 15): the second source's venue fields for every mapped team (ADR 0036),
  each league's own bracket page, and the game-details file.

## Coverage, 2026

| Games | Source | Allowed | Venue named | Fresh | Defaults to home school |
|---|---|---|---|---|---|
| UIL D1 and D2 playoffs | Second source (ADR 0041) | Yes, its schedule data (ADR 0036) | 46 of 48 | Each morning read | No: 1 of 46 at the home team's usual field |
| UIL D1 and D2 playoffs | UIL's bracket page | No: it is an embed of a page ADR 0008 does not allow; `/files/` is disallowed | n/a | n/a | n/a |
| TAIAO playoffs | TAIAO's own bracket (ADR 0063) | Yes: robots.txt allows all; read as a visitor (ADR 0005) | 33 of 45 names, 30 cities | Each morning read | No |
| TAIAO playoffs | Second source | Yes | 0 of 5 still to play | Each morning read | n/a |
| TAPPS playoffs | TAPPS's bracket | No: it is an app whose only data is api.tapps.biz, which is never read | n/a | n/a | n/a |
| TAPPS playoffs | Second source | Yes | 1 game in the details file | Each morning read | n/a |
| TCAF playoffs | TCAF's site | No: robots.txt disallows ClaudeBot | n/a | n/a | n/a |
| UIL D1 regular season | Second source | Yes | 334 of 373 home games | Once a season (below) | Yes, where the venue is blank |
| UIL D2 regular season | Second source | Yes | 323 of 354 | Once a season | Yes, where blank |
| TAPPS regular season | Second source | Yes | 16 of 111 | Once a season | Yes, where blank |
| TAIAO regular season | Second source | Yes | 5 of 124 | Once a season | Yes, where blank |
| TCAF regular season | Second source | Yes | 1 of 11 | Once a season | Yes, where blank |
| Any | School athletics pages | Each site's own robots.txt and terms; no common format | Not measured | By hand | n/a |

Per program, among 211 with a regular-season home game: 125 played 2 or more home games all at one named venue, 15 at
mixed venues, 15 played one, and 56 had no venue named.

## Decision
1. **Bracket games keep their two automatic sources:** the second source (ADR 0041) for every league, and TAIAO's own
   bracket (ADR 0063). UIL's playoff sites are filled almost entirely by the second source; nothing else is needed.
2. **TAPPS and TCAF bracket sites cannot be filled automatically.** TAPPS's only bracket data is api.tapps.biz, which is
   never read; TCAF blocks this robot. A site for one of their games is added by hand to
   `data/seed/game-details/<season>.csv`, one row a game, from a page a person read (the school's own announcement or the
   league's posted bracket), with the page's address kept in the commit message. A row added by hand is a kept value: no
   robot overwrites it (ADR 0041). Everything else shows "Site not listed yet".
3. **No home-school default for bracket games.** Only 1 of 46 UIL playoff games was at the home team's usual field, so a
   bracket game's site is never guessed from its home team.
4. **Regular-season games name the home team's own field when it is known** (`data/seed/schools/home-fields.csv`:
   program slug, field name, city, season):
   - **Filled from** the second source's regular-season venues for that season: `davecampbells.mjs --venues <year>`
     writes each game's venue name and city to the private data repo (`davecampbells-<year>/venues.csv`), and
     `home-fields.mjs <year> --private <dir>` writes the public file.
   - **Only a clear field is kept:** a program's most-used named venue across its regular-season home games, with at least
     2 games and at least two thirds of its named home games, and no tie. A program with one home game, or no clear field,
     gets no row. 2026: 138 programs (UIL D1 66, UIL D2 68, TAPPS 3, TAIAO 1).
   - **Only for the same season:** a field seen in 2026 is used for 2026 games only. A program can move; a new season's
     field comes from a new read. The read is run by hand after each regular season.
   - **Never for a neutral game:** a game the results read marks neutral shows "Neutral site", with no place.
   - **Never over a hand fix:** a rerun keeps a row already in the file for the same season (`mergeHomeFields`); only a
     newer season's field replaces it. A wrong row is fixed or removed by hand.
   - **What a page says:** "<field>, <city> (home)" when known, else "<home team> (home)" as before. Structured data names
     the field as the game's place. No page names where it came from (ADR 0010).
5. **School athletics pages are by hand only.** Their formats differ and each has its own terms; a site read from one goes
   in by hand under item 2, never by robot.

## Consequences
- Every UIL playoff game and most TAIAO playoff games show a site; TAPPS and TCAF playoff games show one only when added
  by hand.
- About two thirds of UIL regular-season games show the home team's field by name. Private-league regular-season games
  mostly keep "<home team> (home)", because the second source rarely names their venues.
- The private repo gains one file a season; the public repo one file. No new token, permission or robot.
