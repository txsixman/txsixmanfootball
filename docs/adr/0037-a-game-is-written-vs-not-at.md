# ADR 0037: A game is written "Away vs Home", never "Away at Home"; "Final" only when confirmed

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. The owner asked for it on Nov 13. Adds to ADR 0036.

## Context
- Every public page wrote a game as "Abbott at Gilmer Union Hill". The owner pointed out that this reads as the game's
  site, when it only says which team is home and which is away.
- A playoff game's home team is the bracket's designation. Its site is agreed separately and is mostly neutral, as
  `playoffGameKeys` in `lib/games.ts` already notes.
- The game's site, when known, is coming as its own field (`site_name`, `site_city` in the facts file, ADR 0036), shown
  as "at <site>, <city>". "Abbott at Gilmer Union Hill at Stamford" would read badly.

## Decision
- **Titles:** a game's title is written "Away vs Home" on every public page. That covers the game page's heading, its
  page title, breadcrumb, share text, description and structured data; Tonight; the home page's games to watch; Results
  and week lists; series pages; earlier meetings.
  - The order stays away first, and the game page still labels each team "Home" or "Away".
  - The admin pages keep "at"; they are not public.
- **Schedules:** a team's schedule line keeps "vs X" for a home game and "at X" for an away regular-season game, where
  the home team hosts. A playoff game always reads "vs X": the program page, a past season's page, My teams, the
  embed and the path to the final. `lead()` in `lib/program-games.ts` decides, from the row's `playoff` mark.
- **"Final" only when confirmed:** a score no second source has backed reads "Score reported", as the bracket pages
  already said (ADR 0008).
  - On /scores it gets its own "Score reported" section, ahead of "Final".
  - On Tonight, the game page header and the share card it reads "Score reported", never "Final · Unconfirmed".
- **URLs are unchanged:** a game page's address (`…-ladonia-fannindel-at-three-way-school`) keeps "at". Changing it
  would break links already shared, and an address is not read as a sentence.

## Consequences
- `scripts/matchup-wording.test.mjs` fails if any public source writes `{away} at {home}` again.
- `scripts/embed.test.mjs` checks that a playoff game away from home reads "vs".
- The e2e tests that read game headings and labels now expect "vs".
- `e2e/scores.spec.ts` checks that the sample board's unconfirmed and disputed games sit under "Score reported" and never
  say "Final". The live-site audit of Nov 13 found /scores listing them under "Final".
