# ADR 0066: A game's site keeps its street address, with a Directions link

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It supersedes one clause of ADR 0041 item 1,
"nothing else of the venue is kept" (no address), for the street address only. Everything else in ADR 0041 stands, and
ADR 0041 itself is not edited.

## Context
- ADR 0041 kept a site's name and city and nothing else of the venue: no address, coordinates or postal code.
- The owner, Nov 15, 2026: "We should also have addresses for fields." Asked whether to store the second source's venue
  street address, which reverses that clause, the owner chose to store it.
- The second source gives each venue a street line (two parts), city, two-letter state, ZIP, country and coordinates.
  TAIAO's own bracket gives a free-text site line that often holds a street address.

## Decision
1. **What is kept:** a site's street line, its state and its ZIP, beside its name and city, as the source gives them:
   - `site_street`: the street lines joined, plain words, digits and "#", a comma written " - " (the files have no quoting),
     at most 100 characters, with a number in it. Anything else is blank, never guessed.
   - `site_state`: two capital letters. `site_zip`: five digits, or five and four.
   - An address needs a site name, and a state or ZIP needs a street. **Never coordinates**, country or anything else.
2. **Where:** three new columns at the end of `data/seed/game-details/<season>.csv` and
   `data/seed/schools/home-fields.csv`, checked by `check-data.mjs` (Zod, `lib/data-schemas.ts`). A file from before
   addresses still reads. The private venues read (`davecampbells.mjs --venues`) keeps the same three.
3. **Never overwrite** (ADR 0041): a kept value is never replaced. An address belongs to its site: a fresh address fills a
   blank only when the kept site name is the same or blank, so one source's address never lands on another's site. A home
   field read again for the same season fills its blank address, never a kept one.
4. **TAIAO:** only what TAIAO's own site line gives: the text from its first street number to the city or state, "TX" and
   the ZIP when the line has them (`venueOf` in taiao.mjs). A line with no clean street gives none.
5. **TAPPS and TCAF** stay blank (ADR 0064, the owner Nov 15).
6. **What a page shows:** the game page's Site line, then the address ("1200 FM 1188, Gate #2, Jayton, TX 79528"), then a
   "Directions" link: a maps search for the site's name and address
   (`https://www.google.com/maps/search/?api=1&query=…`). No API key, no embedded map. The address shows only with the
   site it belongs to: the facts file's site, or the home field the page names. The structured data's Place gets a
   PostalAddress (street, city, state, ZIP, country US). No page names where an address came from (ADR 0010).
7. **Past seasons:** none, because the second source serves no past games (ADR 0065 item 2).

## Consequences
- A visitor can get directions to most UIL fields and many bracket sites in one tap.
- An address is a fact about a public building (a school's field), not about a person; nothing about minors is added.
- The files grow by three columns; every reader of the details file reads by column name, or accepts both headers.
