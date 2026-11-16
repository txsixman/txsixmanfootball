# ADR 0075: TAPPS State Championship kickoffs and sites from TAPPS's own page, by hand

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It narrows ADR 0065 item 5 ("TAPPS and TCAF
stay blank ... no by-hand rows for now") for one kind of game only, through ADR 0064 item 2's by-hand path, which ADR
0065 left open. ADR 0065 is not edited.

## Context
- On Nov 16, 2026 the five TAPPS six-man State Championships (Nov 20 and 21) showed "Time not listed" and no site. The
  task that week was to make that week's playoff games complete on the site.
- TAPPS's bracket data is api.tapps.biz, which is never read (ADR 0064). The second source names no venue for them.
- TAPPS's own public football page (https://www.tapps.biz/athletics/football-6-man/, robots.txt allows every agent)
  states the State Championship schedule: each division's day and kickoff, and one site with its street address. Two of
  the schools' own pages (Emery/Weiner's team page, Victory Christian Academy's athletics page) state the same day, time
  and site for their games.

## Decision
1. **A TAPPS State Championship's kickoff and site may be added by hand** to `data/seed/game-details/<season>.csv`
   from TAPPS's own public pages on tapps.biz (never api.tapps.biz), one row a listed final, under ADR 0041's and ADR 0066's
   rules (name, city, street, state, ZIP; never coordinates). The page's address goes in the commit message.
2. **Only the facts the page states, on the pairing the data already lists.** The page names no teams: the pairing is
   the listed final (results reader, ADR 0008), and the row keys to its date and two teams. A division's time goes
   only to that division's final.
3. **A by-hand row is a kept value:** no robot overwrites it (ADR 0041). A wrong one is fixed by hand.
4. **Everything else in ADR 0065 item 5 stands:** earlier TAPPS rounds and TCAF stay blank unless the second source
   names a venue.

## Consequences
- The 2026 TAPPS finals show their kickoff, "Rocket Stadium, Robinson" and Directions.
- Each season's finals need one by-hand pass once TAPPS posts its schedule (usually the week before).
