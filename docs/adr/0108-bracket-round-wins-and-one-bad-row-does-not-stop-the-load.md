# ADR 0108: The bracket's round wins, and one bad row does not stop the games load

**Status:** Proposed Nov 21, 2026; accepted when its pull request is merged. Builds on ADRs 0067, 0079 and 0031; changes no page.

## Context
- From 13:03 UTC on Nov 21 every Results watch run failed at `supabase / load` with "row 133 is missing source_url" (Nov 20:
  "row 132"). `parseGames` threw on the first row with an empty required column, so no game reached the hosted database, and
  ADR 0079 wants a game in the database before its comments and fan score reports open.
- The row was a bracket-built `semifinal` (TAIAO Division 1: Fort Bend Chargers v THESA; Division 3: Stephenville Faith Knights
  v Jubilee San Antonio), appended by the night read with no source page. The same two games were already in playoffs.csv as
  listed `quarterfinal` rows with a source page and the sides the other way round, so each game was a row twice.
- Why the listed rows said "quarterfinal": the reader names a round from the weeks of the bracket it has seen, and a last week of
  more than two games in TAPPS or TAIAO is read as an earlier round (`roundsFor`). The league's bracket had no such week: the
  source also lists pairings the bracket never made (five TAIAO semifinal pairings, voided in `data/corrections/games.csv` on
  Nov 14 to 16), and those stray listings made each semifinal week 3 or 4 games. A newly written row took that name; a stored
  row keeps its round (store.mjs), so rows written a day earlier stayed "semifinal".
- The bracket fill then did not see the listed game in the semifinal slot (wrong round name), so `builtDue` built the pairing again,
  and `withBuiltRows` appended it as a new row without looking for a row of the same date and teams. Nov 20's three copies mended
  at the next full read (a stored file's rows are keyed on date and teams); Nov 21's had not been read in full yet.

## Decision
- **The loader skips and counts** (`packages/db/games.mjs`, `load.mjs`): a row with an empty required column is left out of the
  load, named in a `::warning::` line (file, row, round, teams, the missing column) and counted as `skipped` in the load report.
  More than `MAX_SKIPPED_ROWS` (3) in one file stops the load, so a real breakage is as loud as before. A wrong header or cell
  count still stops it at once.
- **The bracket's round wins** (`maxpreps.mjs`): `withBuiltRows` never adds a row for a pairing whose date and two teams a row
  already holds; it puts the bracket's round on that row (home and away, source and score stay). `withoutBuiltCopies` folds an
  existing listed-and-built pair the same way on the next night read, so the private file mends within minutes, not at the next
  full read.
- **A voided listing is not a bracket game** (`withoutVoidedBracket`): a listing with no score that `data/corrections` voids is
  not written to playoffs.csv and does not count toward its week when rounds are named. A voided listing with a score stays, so
  the data checks still name it.
- The two bad quarterfinal rows and the five stray semifinal rows are removed from the public playoffs.csv in the same pull
  request (its own commit); the private copy mends by the two rules above on the next night or full read.

## Consequences
- Rounds of games the bracket sets come from the bracket, however many stray listings the source holds; no page shows a game twice.
- A file with one row missing a source page loads every other game and says so in the run's annotations. Nothing is hidden: a
  skipped game has no database row, so no comments, until the row is mended.
- Not decided here: whether `roundsFor`'s "last week of more than two games is semifinals" rule should ever read a TAIAO week
  against the bracket file (`data/seed/brackets/<season>.csv`) instead of by counting. With the voided listings out it counts
  correctly for this season.
