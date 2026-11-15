# ADR 0063: TAIAO bracket games take their kickoff and site from TAIAO's own bracket

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It adds a second source of game details to ADR
0041, under all of ADR 0041's rules, and reads the same page ADR 0046 and ADR 0047 already read under ADR 0005.

## Context
- ADR 0041 fills a bracket game's kickoff and site from the second source's venues. That source has no venues for TAIAO
  games: on the morning of Nov 15 the read found 2 sites for the 12 bracket games still to play, and none of TAIAO's 5.
- TAIAO's own playoff page (taiao.org/football/playoffs; robots.txt allows every agent) shows each bracket game's day, time
  and a free-text site line under its teams. The bracket tabs read on Nov 15 had 45 games, 35 of them with a time and a site line.
  Every game still to play without both teams named shows "Date / Time TBD" and "Location TBD".
- The site line is written by hand and varies: "Name, street, City, TX zip", "Name street City TX zip", a name alone, or a
  street address alone. ADR 0041 keeps a venue's name and city only, never an address.

## Decision
1. **What is read:** `taiao.mjs --details --out <file>` clicks each "Division N Bracket" tab as a visitor would (the same
   `readBrackets` as ADR 0046) and takes, for each game still to play on or after today with both teams named and no score,
   the day and time (Central, turned to UTC) and the site line.
   - The bracket's own pairings are used, not the listed ones. A listed TAIAO game that contradicts the bracket is voided
     (ADR 0040); the right pairing keys to the same date and two teams once it is listed (`lib/kickoffs.ts`).
2. **Name and city only** (`venueOf`):
   - The name is the text before the first part that starts with a street number.
   - The city is the part just before the state, or the last part after a street, or the words after a street's road word
     ("Dr", "St.", "Avenue", a highway such as "FM-775").
   - Nothing else is kept: no street, number or postal code.
   - Both pass ADR 0041's plain-words check (`siteText`).
   - A line with no name, such as a street address alone, gives no site. A line that does not read cleanly gives a blank
     city rather than a guess.
   - On the Nov 15 tabs this read a name for 33 of the 35 site lines and a city for 30. The 2 with no name are bare street
     addresses; the 3 others with no city give a name only.
3. **Never overwrite:** the rows merge into the same file the second source's step writes (`mergeKickoffs`), and the commit
   step merges that into the newest main's `data/seed/game-details/<season>.csv` (`--merge-details`). A kept value is never
   replaced (ADR 0041). The second source's step runs first, so for a game both list, the second source fills the blank
   first.
4. **When:** Results watch's morning read and a dispatch that is not a game-day read, the same runs as the late finals
   (ADR 0046), right after them (the browser is already installed). It needs no repo variable: it reads only TAIAO's public
   page. A failure leaves the file as it was. The log and summary give counts only, never a school.
5. **What a page says** is unchanged (ADR 0041): "Site: <name>, <city>", or "Site not listed yet". No page names TAIAO as
   where a site came from (ADR 0010).

## Consequences
- On Nov 15 the read filled both TAIAO semifinals that have a site: Division 1 SF1 (Waco) and Division 2 SF1 (Georgetown).
  The other four semifinals and the three finals say "Location TBD" on the bracket, so they stay "Site not listed yet"
  until a later morning read finds them.
- A badly typed site line on TAIAO's page can give a wrong city. It is fixed by hand in the facts file, a commit anyone can
  see (ADR 0041).
- Where every league's sites can come from is a separate decision (the next ADR).
