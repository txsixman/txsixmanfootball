# ADR 0062: Fan score reports go to the owner's corrections page, never into a game

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It extends ADR 0018's fan score reports and
changes none of their rules for what a page shows.

## Context
The launch list asks that a fan score report can never overwrite a confirmed final and goes to the corrections queue only.
The audit found the first already true: `fan_score_report` is append-only, no function writes `game` from it, a report is
refused once the game has a score (`game_closed`), and once the game has a final the page shows a fan score only when it
matches that final (ADR 0018). The site's scores come from its own data files, which no fan report touches. But no one could
see the reports: a fan who saw a different score than the one the site later read had told nobody.

## Decision
- **A read-only list on `/admin/corrections`** (`admin_fan_score_reports`, migration 0027): every game with a fan report in the
  last 60 days, newest first, with the game's status and score as the database has it and each reported score with how many
  reports and how many count (accounts older than 7 days, not banned). A reported score that differs from the game's final is
  marked. Never who reported.
- **It changes nothing.** When a report shows the game's score is wrong, the owner fixes it with the game's correction form
  (linked from each row), the same way as any other correction: a cited row in `data/corrections/games.csv`. A fan report is
  never a source on its own.
- **Reports stay closed once a game has a score**, as before. Reopening them on finished games, as a "this score is wrong"
  report, is left for later: it would be a second form on every game page and more for the owner to read.

## Consequences
- Disagreements are visible only for reports sent before the final was read. That covers the case that matters most on a
  Friday night: fans report early, the read comes later.
- The list is admin-only and refuses anyone else; it is in `SIGNED_IN_FUNCTIONS`, so CI checks anon cannot run it.
