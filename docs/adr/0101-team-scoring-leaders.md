# ADR 0101: Team scoring leaders, from confirmed final scores

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It adds a page and builds on ADR 0004 (what
a score may say), ADR 0012 (one organization at a time), ADR 0040 (a final is confirmed; a disputed final names no winner)
and ADR 0089 (program pages).

## Context
- Fans ask which teams score the most, give up the least and win by the most. The site had only a top three of points per
  game on each season's hub page (`lib/season-leaders.ts`), with no page of its own.
- Six-man ends a game early when one team leads by 45 points at halftime or later (the 45-point rule). The best teams
  therefore play shorter games, so their points per game understate them; a plain average ranks them below teams that
  score a little less over a full four quarters.
- The results files hold every final, forfeits included (recorded 1-0 or 2-0, which is no score, ADR 0004), and a few
  disputed finals (a different winner by two sources, ADR 0040).

## Decision
1. **A page of leaders for a season and a view** (`/leaders`, `lib/leaders.ts`, `app/leaders`). Views are all of UIL, UIL
   Division I, UIL Division II, TAPPS, TAIAO, TCAF and Independent, each its own page; no list mixes two organizations
   (ADR 0012). The latest season is `/leaders` and `/leaders/<view>`; a past season is `/leaders/<season>` and
   `/leaders/<season>/<view>` (the latest season has no year in its address, so it has one page). Teams are placed by the
   current alignments, as the rankings place a past season's teams. A view with no game in a season has no page, and the tabs
   link only to pages that exist.
2. **Eight lists, ten rows each:** points per game, fewest points allowed per game, average margin, shutouts (games the
   other team scored nothing), wins by 45 or more (the margin the 45-point rule stops a game at), 60-point games, the most
   points in one game, and the fewest points allowed in a season (a total).
3. **Only confirmed finals.** A forfeit, a disputed final (the list of ADR 0040) and a 0-0 (no score) are left out of every
   list and of every team's game count; the page says how many forfeits and disputed finals of the view it left out, and
   says so even when there are none. Playoff games count. Scores may be corrected, as everywhere.
4. **A minimum to qualify.** A team needs 6 games to be listed on any team list (`LEADER_MIN_GAMES`, the same number the
   season hub uses), and 8 for the season total of points allowed, because a total favors a team that played fewer games.
   The single-game list has no minimum. The page states the 6.
5. **Ties are ties.** Averages are rounded to one decimal first, so two teams that print the same figure share a place
   (1, 1, 3), and the row says "tied". If a tie runs past the tenth row the list does not stretch: it says "and 4 more teams
   tied at 3". A count list shows only teams with at least one.
6. **The 45-point rule is said in one plain sentence** under the title: a game ends early once one team leads by 45 at the
   half or later, so points per game understates the best teams. The shutout and 45-point-win lists show what the average hides.
7. **Linked from where fans look.** Each team links to its program. `/rankings` (each organization and UIL division, each
   season that has a page) links to its leaders, the footer lists "Leaders", every page is in the sitemap and has its own
   title and description (`lib/titles.ts`, `lib/descriptions.ts`), and a program page carries one "Scoring" line once its team
   is listed: "Scoring: 41.3 points per game (3rd in UIL Division I), 12.4 allowed (2nd)." with a link to the page. The
   header navigation is full, so it is not there.
8. **Teams only.** No player is named or counted (CLAUDE.md, minors); no page names a data source.

## Consequences
- About 60 more static pages (nine seasons, up to seven views each). The pages read the season files the other pages
  read, once per build (`lib/memo.ts`).
- The season hub's top-three lists still use `teamLeaders` (`lib/season-leaders.ts`), which does not leave out a disputed
  final (it does leave out forfeits). The hub names no winner, so the difference is a few tenths of a point at most; the two
  can be made one later, and this change leaves the hub as it was.
- A wins-by-45-or-more figure is a margin, not a record of how a game ended: the files do not say a game was ended by the
  rule (`end_reason` is `unknown` for robot-read games, ADR 0008), so the page names the margin, not the rule's call.
- Tested by `scripts/leaders.test.mjs` (averages, qualifiers, ties, forfeit, disputed and 0-0 exclusion, the 45 and 60
  edges, the single-game list, the views and addresses) and `e2e/leaders.spec.ts` (phone and desktop, every list, ties,
  a past season, the organization and division switches, the program line, the links from Rankings and the footer).
