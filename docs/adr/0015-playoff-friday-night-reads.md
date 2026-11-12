# ADR 0015: Results read every 30 minutes on playoff Friday nights

**Status:** Accepted Nov 11, 2026 (the owner, through the master session: he chose this change knowing it reads MaxPreps
more often than ADR 0008 allows). Widens ADR 0008's schedule only; every other rule of ADR 0008 stands.

## Context
ADR 0008's Results watch reads Friday, Saturday and Sunday mornings. A Friday-night playoff final reaches the site and
its followers' phones the next morning, when fans want it that night. A full read walks about 280 schedule pages
(about 12 minutes); doing that every half hour would read MaxPreps far harder than a visitor.

## Decision
- **When:** Friday nights in November and December (the playoffs), every 30 minutes from 7 PM to midnight Central
  (`results-watch.yml`: Saturday 01:00 to 06:00 UTC, Central Standard Time). The morning reads are unchanged.
- **What:** `maxpreps.mjs --tonight` reads only the bracket games of tonight (the Central date, counted until 6 AM so the midnight run still reads Friday) that have no score yet in
  `playoffs.csv`, **one schedule page a game** (either team's), so a night starts at a few dozen pages and shrinks as
  finals come in. With no unscored bracket game today it reads nothing, which ends the night runs with the season.
- **Same pages, same manners:** team schedule pages only (the same path check), robots.txt as read for ADR 0008, one
  request every 2.5 seconds, the same plain user agent, no APIs.
- **Same output rules:** a night read only fills scores into existing bracket rows and adds those games to
  `games.csv`; it never removes or rewrites anything else. The next morning's full read rewrites the files as before.
  Each new final is rerated, committed, checked (Zod) and sent as a push alert by the same jobs as a morning read.
- **Stop on request** (ADR 0008) covers these runs too.

## Consequences
- Finals and alerts arrive within about half an hour on playoff Friday nights.
- More requests to MaxPreps on those nights (roughly 10 small reads), still far below one full read an hour.
- Thursday and Saturday playoff games still wait for the next morning's read; widening to those nights needs the owner.
- GitHub may start a scheduled run late on a busy night; the next run catches up.
