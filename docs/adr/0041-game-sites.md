# ADR 0041: A bracket game's site, and never overwriting a kept detail

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. The owner said on Nov 13 that a bracket game's
"<away> at <home>" site label "is not correct that is just clarifying home and away not game site". Fills the
site columns ADR 0036 left blank, and replaces ADR 0036's "a fresh value replaces a kept one" with never overwriting.

## Context
- A bracket game's page said "Site: <home team> (home)". In the playoffs the home team is only a designation: most games
  are played at a neutral field, so the page named the wrong place.
- The second source's feed (ADR 0025) gives each game a venue: a location name, an address, a city and a time zone.
  - A field-names-only look (`davecampbells.mjs --team`, which prints field names three levels deep and never a value)
    found it on Nov 13.
  - That night's read gave a site for 17 of the 21 bracket games it listed. Only 3 of those sites are in the home team's
    town, so the feed is not filling in the home school by default.
- MaxPreps was checked as a second way to fill sites. On Nov 13 its robots.txt allowed game pages (`/tx/football/game/`;
  `/contest/`, `/scores/`, `/team/` and `/school/` are out), and one schedule page and one game page were read with the
  reader's own agent:
  - The schedule page's contest has no site. Each team carries only its school's own address.
  - The game page describes the game as "a neutral playoff game", yet its location is the home school's name and address.
  - So MaxPreps' location is the home school by default, the exact mistake the owner flagged. It is not used for sites.
  - Its start time does look real: the schedule page's times vary (2, 6, 7 and 7:30 PM), and the game page's start time
    with its UTC offset matches. Filling kickoffs from it is a separate change (Consequences).

## Decision
1. **Where a site comes from:** the second source's venue, read by `davecampbells.mjs --kickoffs` with each game's kickoff.
   - `site_name` is the venue's location name, or its site label when it has no usable location name. `site_city` is
     its city.
   - Nothing else of the venue is stored anywhere: no address, coordinates or postal code. A later "Directions" link
     works from the name and city alone.
   - Both are plain words: letters, digits, spaces and `. ' & ( ) / -`. A comma becomes " - ", because the file has no
     quoting. The name is at most 80 characters and the city at most 60.
   - Anything else is left blank (not known), never cleaned into a guess. A city with no name is not a site.
   - `check-data.mjs` holds the file to the same rules, so a hand edit cannot break them.
   - MaxPreps' location is never used.
2. **Never overwrite:** a filled kickoff or site in `data/seed/game-details/<year>.csv` is kept. A fresh read only fills a
   blank, field by field, and rows the read does not list stay.
   - A wrong value is fixed by hand, which is a commit anyone can see.
3. **What a page says** (`lib/kickoffs.ts` `siteOf`):
   - A known site is "Site: <name>, <city>", or the name alone when the city is blank.
   - A game with no site yet says "Site not listed yet". It never names the home team's field.
   - No page names where a site came from.
   - The game's structured data (`lib/json-ld.ts`) carries the site as its place, and leaves it out when not listed.
   - Past seasons are unchanged ("Site not listed").
4. **Read every morning:** Results watch's morning read (11:23 UTC, Friday to Sunday) and a dispatch run `--kickoffs`.
   - It writes to a file outside the repo. After the commit step resets to the newest main, `--merge-details` (no network)
     merges that file in with the same never-overwrite rule, so a value filled on main in the meantime is kept.
   - The file is committed with the results, by name.
   - It is off until the repo variable `SECOND_LIVE` is "true" (the same feed's upcoming games). A failure (a 403 or 429
     stops it at once) leaves the file as it was.
   - The same rules as every read of that feed apply: `/api/public` only, an honest user agent, 2.5 s apart.
5. **What is still missing is reported:** each read logs "Still missing: a kickoff N (league counts); a site N (league
   counts)" for the bracket games still to play.
   - It gives counts by league and never names a school, because run logs are public.
   - The step summary carries the same line.

## Consequences
- On Nov 13, 25 of the 42 bracket games still to play had no site: TAIAO 12, TAPPS 9, UIL 3, TCAF 1. Most are private-league
  games the feed's teams list does not map. They say "Site not listed yet" until a read or a hand edit fills them.
- Thursday games are read on the Friday morning, too late. They are filled by a dispatch or by hand until a read before
  each game day is added.
- Next change: kickoffs from MaxPreps for the games the feed lacks.
  - The start field the reader already reads on schedule pages (contest index 11) is local wall time with no zone.
  - The few six-man schools in Mountain time need the game page's UTC offset, or a zone rule, before it is used.
  - It also needs a check that a 7 PM start is not a placeholder.
  - It fills blanks only, by rule 2.
- Tests:
  - `davecampbells.test.mjs`: the venue parse (plain words, blank otherwise), the never-overwrite merge, the
    missing-count line naming no school, and `--merge-details` with no network.
  - `commit-results.test.mjs`: details read earlier are merged into the newest main and committed, and no file is
    written when none were read.
  - `scripts/game-sites.test.mjs`: "<name>, <city>", the name alone, "Site not listed yet", and no file.
  - `scripts/check-data.test.mjs`: a site in other than plain words, or a city with no name, fails.
  - `e2e/game-sites.spec.ts`: a game page with a site shows it, naming no source, and one without says "Site not listed yet".
  - `e2e/found-and-shared.spec.ts`: a known site is the structured data's place, and one not listed yet is left out.
