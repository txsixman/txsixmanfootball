# ADR 0019: Playoff reads follow the games, any day

**Status:** Accepted Nov 13, 2026 (the owner: "They need to run whenever games are being played", then "Every ten
minutes"). Widens ADR 0015's
nights and hours only; every other rule of ADRs 0008 and 0015 stands.

## Context
ADR 0015 reads results every 30 minutes on playoff Friday nights, 7 PM to midnight, and leaves other days to the next
morning's read, noting that widening needs the owner. On Thursday Nov 12, 2026, thirteen UIL bi-district games were
played and none was read until 5:23 AM Friday. TAPPS and TAIAO play many playoff games on Saturdays, some in the
afternoon.

## Decision
- **When:** every day of November and December, every 10 minutes from noon to midnight Central (`results-watch.yml`:
  18:00 to 06:00 UTC, Central Standard Time).
- **Only when a game is due:** a short `due` job reads this repo's `playoffs.csv` first (`maxpreps.mjs --due`), and the
  read runs only when a bracket game of that game night has no score yet. A day with no game, or with every final in,
  costs one short check and no MaxPreps request.
- **Which games:** the game night's own date in Central time (`gameNight`, counted until 6 AM), never the UTC date.
  Unchanged from ADR 0015: only that day's bracket games with no score yet, one schedule page a game.
- Pages, manners, output rules and stop on request: as ADR 0015.

## Consequences
- Playoff finals and alerts arrive within about 10 minutes (plus GitHub's start delay) on whatever day and hour they are played.
- Up to 73 short checks a day in the playoffs; MaxPreps is read only for games that are due, one page a game a run,
  so a busy night reads each unscored game's page about six times an hour until its final is in.
- Regular-season games (August to October) still wait for the Friday to Sunday morning reads: the files list a game
  only once it is played, so a game-day read has nothing to look for. Reading those live needs a schedule source first.
