# ADR 0007: How 2026 regular-season games get captured

**Status:** Accepted Nov 10, 2026 (decided by Claude under the owner's delegation; the hours question below is his).
Answers `docs/plan/v1.2-notes.md` item 3, in part.

## Context
The ratings need connected games. The 2026 playoffs give about one game per team, which ranks teams but cannot test
the model (G3 asks for a backtest by Apr 18, 2027). The UIL regular season is about 785 games (157 teams, about
10 games each, two teams a game). The sites that already list them are off limits (ADR 0002): SixManFootball.com and
MaxPreps by rule, and UIL's brackets are a MaxPreps widget. Many school athletics pages embed MaxPreps, Hudl or
rSchoolToday schedules, so a school page is not automatically a first-hand source either.

## Decision
- **Hand entry, one game per row, with its source.** Same columns as `playoffs-2026.csv`, in one file per league and
  season (`data/seed/uil-2026-28/season-2026.csv` first). `round` holds the week (`week-1` to `week-11`).
- **Allowed sources:** the school's or district's own post (news item, social post, PDF), a local newspaper or
  radio story, or a person who was there. Not a schedule widget run by MaxPreps, Hudl or rSchoolToday, even when
  it sits on a school's site: the data is theirs. The row's `source_url` is the page a person read.
- **No robot readers for game results.** ADR 0005 covers league alignment pages only. Hundreds of school sites in
  different formats, many with embedded third-party schedules, would make a robot the easiest way to break ADR 0002.
- **Order:** playoff teams first, most connected first (a district's playoff teams and their district games), so the
  ratings gain the most per hour. Then the rest of UIL, then TAPPS and the private leagues.
- **The importer and the ratings job take the new file when its first row is entered**, not before (nothing is built
  before it is needed). `packages/db/games.mjs` matches games on season, round and teams, so a week works as a round;
  it will need `game_type = 'regular'` and a null `playoff_round` for these rows.
- **The spring community drive** (plan, "Seed data for 2026") uses the same file through the history-contribution flow in
  Phase 2, so its rows carry the same source rule.

## Open (the owner's call)
- Who enters the games, and how many hours go to it before the spring drive. At about one minute a game once a
  source is found, playoff teams' games are roughly 400 games and 7 to 10 hours; all of UIL is about 13 to 20.
- Restating G3 for the data that will exist (v1.2-notes item 3) is a plan change, so it ships with plan v1.2.

## Consequences
- Ratings stay a playoffs-only ranking until regular-season rows exist. The `/ratings` page says how many games it
  rests on.
- Regular-season coverage will be uneven by district for months. The ratings page should show games per team once
  coverage differs.
