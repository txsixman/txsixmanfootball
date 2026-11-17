# ADR 0089: Program pages hold the program's whole history: all-time numbers, records, State Championships and an honest empty state

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0013 (records rest on robot-read
scores), ADR 0072 (a renamed or merged school's State Championships) and ADR 0083 (one list of State Championships). It
changes what a program page says, not the data behind it.

## Context
- A program page already had a season-by-season list (record, place, final rating, last playoff round), the most-played
  opponents with series links, and a State Championships section. Reviewed on three programs: Jayton (a long-time UIL power:
  four UIL titles), Bracken Christian (a small private school: a TAPPS title and two runner-up finishes) and
  CHANT (a newly listed Independent with two games, all in 2026).
- What a fan could not find: the program's headline numbers in one place; its biggest win, biggest loss, longest winning
  streak and best season (the page only had the current season's best win and worst loss); how many playoff games it won;
  its State Championships counted across leagues; which seasons ended in a State Championship, on the season rows. A program
  with almost no games showed nine rows of dashes, and a team whose season was over showed one lone "Latest score" box.

## Decision
- **All-time** (new section, before the seasons): record since the first season on record with the share of games won,
  playoff seasons out of seasons, the record in playoff games, and State titles with the count of State Championship games
  behind them. State Championship games are UIL's list since 1972 plus the private leagues' recorded finals since 2018
  (ADR 0083), a renamed or merged school's counted under the program it became (ADR 0072). The section says what counts.
- **Records** (new section): best season (the best share of games won among completed seasons of six games or more; the
  season under way never counts), biggest win and biggest loss (by margin, each linked to its game page), and the longest
  run of wins in a row across seasons (two wins is the shortest named, "still going" when nothing has ended it). A forfeit
  counts as a win or a loss in a run, as everywhere (ADR 0013), but has no margin, so it is never the biggest win or loss
  (ADR 0004: no page shows its recorded 1-0 or 2-0). A run cannot be joined across a season the data holds with none of the
  program's games, as `/records` counts runs.
- **Season by season** gains, on each row: the playoff record beside the round reached ("reached the regional round, 1-1 in
  playoff games"), a linked "State Champion" or "State Championship runner-up" line (to `/championships/<year>`) for a
  season that ended in one, and, for the season under way, the district place linked to the district's page. A past season
  shows no district place: the data holds only today's alignments, and a district's members change every realignment, so a
  past place would be a guess.
- **Little data.** A program with fewer than five games on record has no all-time numbers or records. Its page says how
  many games it has, lists only the seasons it has, and names the rest in one line ("No games on record for 2018 to 2025")
  instead of a row of dashes each. A program with none says so. A season with a game played and none listed ahead shows a
  "Next game" box that says "No game is listed ahead", so the one box does not look unfinished.
- **Left as it was:** the rivals list (most-played opponents with series links), the State Championship lists, the playoff
  path while a team is alive, and the season's games. The season-by-season one-line total and every existing label stay.
- **Pure rules in `lib/program-records.ts`** (no imports but types, tested by `scripts/program-records.test.mjs`); the page
  reads the games and season lines `lib/program-seasons.ts` already builds, which now also tag each game as a playoff game and
  carry its game page. Static at build time, no new data file, no client script.
- **Held to ADRs 0080 and 0081:** every new link says `prefetch={false}` and is 44 px tall, its accessible name holds the text
  it shows, text is 13 px or more, and the new sections are small (Jayton's page was 42 KB sent against the 80 KB budget; CI's Lighthouse run prints the new size). `e2e/program-history.spec.ts` covers
  Jayton, Bracken Christian, CHANT and Covenant Prep (the last two follow the data and skip once they have five games).

## Consequences
- A program's headline numbers, records and State Championships are readable without opening a season.
- Figures rest on robot-read scores that may be corrected (ADR 0013); the sections say "read".
- A private school's titles before 2018 are not in the data, so its State titles count only the recorded finals; the
  note under the numbers says where each league's count starts.
- A program that gains its fifth game switches from the little-data page to the full one with no edit.
