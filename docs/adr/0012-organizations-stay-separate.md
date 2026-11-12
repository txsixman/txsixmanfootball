# ADR 0012: Each organization stands alone on every page

**Status:** Accepted Nov 11, 2026 (the owner: "Make sure we are never clumping different organizations together UIL tapps
and TAIAO need to stay separate as people watch different organizations").

## Context
Six-man in Texas is played in separate organizations: UIL (public schools, Divisions I and II), TAPPS, TAIAO and TCAF
(private and home-school leagues). Each has its own districts, playoffs and champions, and fans follow one of them.
The site mixed them in places: an Overall ranking of every league, a Scores "All" filter, a "Private" standings tab
holding three leagues, and Results, Records and home-page lists drawn from all of them.

## Decision
- **No page section, list, table, filter or ranking puts two organizations' teams or games together.** Each section
  that covers more than one organization has an organization tab row: UIL, TAPPS, TAIAO, TCAF (`lib/orgs.ts`). UIL is
  the default page (`/rankings`); the others live at `<section>/<org>` (`/rankings/tapps`). UIL keeps its Division I and
  II views inside the UIL tab.
- **No "All" and no "Private" grouping.** The private leagues are separate organizations, not one.
- **Ranks are within one organization.** The rating scale stays shared underneath (so Matchup can compare any two
  teams), but a rank number, a "top five" or a movement arrow is counted inside one organization only.
- **A game between two organizations** shows under each team's own organization. A team the current alignments do
  not know (out of state, 11-man, a past opponent) belongs to no organization and never gets its own row.
- **The home page** shows each organization in its own block, labelled, never one merged list.
- Exceptions: a single program's own page (its games against anyone), Matchup (the reader picks two teams), and
  State Championships (UIL's finals only).

## Consequences
- Rankings, Standings, Scores, Results, Records and the home page gain organization tabs and new static routes;
  `/standings/private` redirects to `/standings/tapps`.
- A new organization (TCAL, an independent group) is one row in `ORGS` plus its alignment file.
- Grayson Christian, listed by both TCAF and TAIAO, still shows as two programs, one per organization, which this ADR
  now makes the intended behaviour until a team-season-to-league table exists.
