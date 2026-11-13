# Project state

**Phase 0, Foundations** (Nov 9 to Dec 6, 2026). **Next gate: G1, Dec 6, 2026**: stack ADR signed, schema v0
migrates, ratings prototype runs on captured playoff games. All three are done. Interviews are out of scope (the owner,
Nov 10, 2026). The owner's direction (Nov 11): build a better six-man hub than the incumbent site, without reading it.
**Plan v1.2** (`docs/plan/v1.2.md`, ADR 0014, Nov 11): the owner builds it alone from public internet sources; no
reporters, LLC, attorney, sponsors or owner talk; `txsixmanfootball.com` may be used publicly; G3 is a backtest over
2021 to 2026.

| G1 item | Status |
|---|---|
| Stack ADR signed | Done, Nov 10, 2026 |
| Schema migrates | Done: PGlite in tests, and live on Supabase since Nov 10, 2026 |
| Ratings prototype on captured games | Done: `/rankings` rates 1,227 games of the 2026 season (ADR 0008) across 275 teams |

**G3 (Apr 18, 2027) passes today** (Nov 12, after the ratings round, `docs/research/ratings-before-after-2026-11-11.md`):
`run.py --backtest` (`services/ratings/backtest.py`, ~4 min) rates each week from earlier games only, 2021 to 2026, and
writes `data/ratings/backtest.json`. From 2022 on (2,906 games) the model beats both baselines every season: winner picked
86.8% vs Elo 77.0% and last season's rating 74.1%; margin error 12.5 vs 21.2 and 22.0 points; log loss 0.308 vs 0.468 and
0.515. The site's table uses the same model: last season's rating is each team's starting point, kept at 0.6 of its gap
from its league (rho 0.6, the owner Nov 12: less carryover than the best-scoring 1.0; tau 30 tuned at it), each league (UIL
Division I and II, TAPPS, TAIAO, TCAF, Independent) has its own mean, robot-read playoff games get the listed home team's
full home edge, forfeits (1-0, 2-0) and 0-0 games are not rated, duplicate games are dropped, and outside schools that
played two or more of ours stay in the fit as hidden teams (`outside.csv`). Win probability is logistic(margin / 15.57),
calibrated on walk-forward predictions (">99%" shown only above 99.5%). Rate the seasons in order, 2021 to 2026, because
each reads the one before it. Open: the 45-point rule means very large margins are underpredicted, so those chances stay capped.

## The site (`apps/web`, Vercel, open to search engines at `txsixmanfootball.com` (`app/sitemap.ts`, `app/robots.ts`, `lib/site.ts`); `www` redirects there, and `txsixmanfootballcom.vercel.app` and previews send `noindex`)
- **Organizations never mix (ADR 0012, the owner Nov 11):** UIL, TAPPS, TAIAO, TCAF and Independent each get their own tab, list and
  ranks (`lib/orgs.ts`; Independent has no standings, and an organization's tabs show only once it has a game, `lib/active-orgs.ts`); UIL is each section's default page, the others `<section>/<org>`. No "All", no "Private"
- **Home**: My teams (programs this browser follows: record, last game, next game with its projection; `app/my-teams/`,
  one static JSON per program), games to watch (three closest per organization), UIL Division I and II top five and TAPPS, TAIAO, TCAF top
  three, state title chances (brackets down to their last four), the reigning UIL champions, a Matchup link
- **Scores** `/scores`: 2026 playoff games, one organization at a time (buttons, UIL first); unplayed
  games show a projected margin and win probability (`lib/projection.ts`); robot scores are unconfirmed (ADR 0004)
- **Game pages** `/scores/<id>`: one for every robot-read game, 2021 to 2026 (~6,800 static pages; `lib/game-pages.ts`).
  A regular game's id is `<date>-<away>-at-<home>`; a current-season playoff game is also in the bracket files, so it has
  the bracket game's page (`<season>-<round>-<away>-at-<home>`) and its result's `href` points there, never a second page.
  Teams (crest, program link), score (a forfeit shows the word), unconfirmed, the week-before projection and how far the
  result was from it, each team's record (and rating, with a projection) going in, earlier meetings 2021 on (each its own
  page), Share. Results rows, program schedules, "Why the rating moved", Records and a ranking's best win and worst loss link to it
- **Playoffs** `/playoffs` (UIL), `/playoffs/tapps`, `/taiao`, `/tcaf`: each 2026 bracket round by round
  (`lib/brackets.ts`), earlier games in the order of the later games they feed, projections for unplayed games; no
  winner named. Title chances (`lib/title-chances.ts`): UIL region chances once a region's bracket closes (data only, no
  hand-entered template; the owner Nov 11), state chances from the last four; advancement may rest on unconfirmed scores (ADR 0013). Season tabs (2026, then 2025 to 2021): past seasons at
  `/playoffs/season/<year>` (UIL) and `/playoffs/season/<year>/<league>`, only leagues with games that year, no
  projections or chances (all played); teams missing from today's alignments render as plain text
- **Results** `/results`, `/results/<season>/<week>` (UIL) and `/results/<org>`, `/results/<season>/<week>/<org>` (one
  catch-all route, `app/results/paths.ts`): every robot-read game with a team of that organization, week by week (Monday to Sunday), seasons
  2021 to 2026, team links; scores unconfirmed, no winner named; each game's projection from the week before
  (`lib/pregame.ts`, once both teams have played four games). A forfeit (recorded 1-0 or 2-0) shows the word, never
  the score, on every page (`forfeitScore` in `lib/games.ts`). `/results/<latest>` and `/rankings/season/<latest>`
  redirect (307) to the bare address (`next.config.ts`). The current season is one constant, `lib/season.ts`
- **Rankings** `/rankings` (all UIL), `/rankings/division-1`, `/division-2`, `/rankings/tapps`, `/taiao`, `/tcaf`
  (`/ratings/*` redirects): one rating scale, ranks counted within the organization; each row shows rating ± sd, a rank range ("#3 to #13"), and a tier (ranges that overlap the tier leader's; `lib/rank-range.ts`); ▲/▼ only when the rating moved more than 4 points in a week; teams under 4 rated games are NR, listed last, left out of others' ranges; from 1024px wide, columns for record strength (wins minus a typical top-25 team's expected wins on the same schedule and sites), opponents' average rating, best win and worst loss (`lib/schedule-strength.ts`); `/rankings/week/<n>[/<org>]` the table at the end of each week (`lib/week-rankings.ts`); `/rankings/how` explains, with a track record (favorites by week-before win probability, `lib/track-record.ts`) and how well the ratings predict (the G3 backtest by season against Elo and last season's rating, `lib/backtest.ts`), and a said-versus-happened scorecard (plot and tables by season, regular season vs playoffs, organization; `scorecard` in `backtest.json`, written by `backtest.py`);
  a season picker (`/rankings/season/2025[/<org>]`: final table, teams placed by current alignments)
- **Standings** `/standings` (UIL DI), `/division-2`, `/tapps`, `/taiao` (division-and-region groups: TAIAO has no
  districts), `/tcaf`; `/standings/private` redirects to `/tapps`: district record (regular season only), overall record
  (playoffs included), point difference. Records and standings may rest on unconfirmed scores (ADR 0013)
- **Matchup** `/matchup?a=&b=&at=`: any two rated teams, home or neutral
- **Programs** `/programs` (find-a-school box, grouped by organization) and a page per school (rank within its
  organization or UIL division): colors and logo (ADR 0006), rank, district
  place, a rank-by-week line (`trend.tsx`), a rating-by-week chart (Observable Plot, drawn at build time), most-played opponents with the record against each, season by season (all-time record and playoff trips; per season record, place, last playoff round), season scores with opponent links, playoff projections,
  state championships (merged schools' too, via lineage), other names (merged schools and state-final spellings, `otherNames` in `lib/lineage.ts`) Also rank range, rating give-or-take, a Record and schedule section (record strength, opponents' rating, best win, worst loss; forfeits left out, a forfeit loss can be the worst loss and shows as "Forfeit") and Why the rating moved (each week's biggest miss against the projection, `lib/why-moved.ts`).
- **Records** `/records` (UIL), `/records/<org>`: most points in a game, most by both teams, biggest upsets (week-before ratings), longest winning runs, unbeaten seasons (2021 on)
- **Series** `/series/<a>/<b>` (slugs in alphabetical order; the reversed address is a 404): one page per pair of current programs that met 3 or more times since 2021 (965 pairs; a pair of two organizations is fine, ranks never shown). Both crests, the record from the first-named side (a forfeit counts, ADR 0013), every meeting newest first with its round and game page (a forfeit shows the word), UIL finals between them, and a projection if they met now (rating, projected margin, win probability; links to Matchup). `lib/series.ts` holds the rules; program pages link their games count to it, and the sitemap lists it. No client script, no share card
- **Seasons** `/seasons` (every season with games, newest first) and `/seasons/<year>` (2021 to the current season, one static page each; `lib/season-hub.ts`, `app/seasons/`): games read and programs that played, the UIL state finals that year (champion, runner-up, score, from UIL's archive; the current season says the finals are in December), then each organization on its own (ADR 0012): its top five by rating (final for a past season), top three for points per game and for fewest allowed per game (teams with 6+ played games, forfeits left out entirely, `lib/season-leaders.ts`; scores unconfirmed, so the page says so), and links to its rankings, results, playoffs, week in review and records; then every results week and week in review of the season. The season under way links the bare addresses (`/results`, `/rankings`, `/playoffs`). Linked from the footer only (not the header nav); in the sitemap
- **State Championships** `/championships` (was `/champions`): every UIL six-man final 1972 to 2025, Division I and II
  since 2006, one division before, most titles
- **Search Console** (done): the owner set up a domain property, and `https://txsixmanfootball.com/sitemap.xml` was
  submitted Nov 13, 2026: Google read it, Success, 8,032 pages. Sample, search and offline pages stay `noindex`
- **Descriptions**: every public page has its own meta description (at most 160 characters), built from its own data in
  `lib/descriptions.ts` (program: record, rank in its organization or UIL division, state titles; game: teams, date and round, no
  score or winner; the rest: season, week and organization). `e2e/descriptions.spec.ts` checks one page of each kind
- **Search** `/search` (Pagefind): program pages and results weeks, indexed after each build; `?q=` links work
- **Score alerts**: a Follow button on each program page; a browser push alert when Results watch reads a new final
  (no winner named). Stores only the browser's push address and keys and the followed programs
- **Live scores** (ADR 0021): on a game page and on `/scores`, a game with no final that the game-day read sees under way shows
  "Live · <period> · <away>–<home> · Unconfirmed", the teams with their scores and when it was read (Central); no winner or
  leader. Read in the browser through the public function `live_scores()` every 60 s (the project's public URL and key,
  `lib/supabase-public.ts`, shared with push; no sign-in setting involved); a 0-0 with no period is never shown. **The period is not shown yet:** `PERIOD_INDEX` in
  `maxpreps.mjs` is null until a night run's summary (`inProgressShape`) shows which contest field holds it; no real
  in-progress page has been seen
- **Embeddable scoreboard** (ADR 0023): `/embed/programs/<slug>` for every program, a static route handler (`app/embed/`, `lib/embed-html.ts`): crest,
  record, last three results, next game, a link back; light, dark or auto by `?theme=`; framable by any site (the only route that is), no
  cookies or client bundle, noindex, under 30 KB. Each program page has a "Put this on your site" block with the iframe as text
- **Share** button on program and game pages: the phone's share sheet, else copies the link (`app/share-button.tsx`)
- Installable to a phone's home screen (manifest, generated icon), and works offline for visited pages (Serwist:
  pages network first, cached ones served for 30 minutes at most); share cards per program (`opengraph-image.tsx`)
- **Crests** beside team names on scores, results, playoffs, records, search and program schedule and most-played lines
  (logo, else initials; a logo wider than 1.6 shows initials except in the program header, up to 4.8). A logo's `tile`
  (`dark` or `white`) overrides the measured `light` guess for mixed logos
- No page names or links a source (ADRs 0009, 0010). Words are rating, projected margin and win probability only

## Data and pipeline
- Alignments: UIL 2026-28 (157), TAPPS 2026-28 (68, weekly robot), TAIAO (46, weekly robot), TCAF (9, by hand), Independent (1: CenTex Chargers, by hand)
- Results: `tools/league-watch/maxpreps.mjs` (ADR 0008) via `results-watch.yml`, Fri to Sun Aug to Jan, and every 10 minutes noon to midnight Central on any November or December day with a bracket game still unscored (`--tonight`: only those games, ADRs 0015 and 0019; it also sends the games under way to the hosted database's `live_score` table, ADR 0021, with no commit); rerates and
  commits the private repo `txsixman/data-private` first (full captures), then the facts to `main` here (ADR 0017,
  `publish.mjs`). 276 of 279 schools reached. Past seasons via `--season <year>` (season-segment pages): 2025 1,230
  games, 2024 1,195, 2023 1,090, 2022 1,076, 2021 970; coverage falls with age (237 of 279 in 2021) because only
  current alignments are known. Past team-seasons get league only (`pastTeamSeasons` in `load.mjs`). The reader retries
  twice, never follows a redirect, skips open dates, and drops games listed twice with different scores (coverage.txt).
  `run.py --season` writes ratings with `sd`, `rated`, `was` (Monday-to-Sunday weeks, as on `/results`), `trend` and `rated_trend` by week (from week 4), `home_field`, `sigma`, `playoff_edge`, `calibration`, `group_means` and a `report` of forfeits, duplicates, ties and outside games; seasons chain, so rate 2021 to 2026 in order
- State finals: `tools/history/uil-champions.mjs` from UIL's archive; names mapped in `uil-aliases.json`; lineage by
  hand in `data/seed/lineage/programs.csv` (TEA's consolidation list): 49 of 52 finalists reach a current program
  (O'Brien became Knox City, 1976; the other three, Jarrell, Marathon and Christoval, are still independent districts that no longer play
  six-man, so no lineage)
- **Supabase** (`vhgnaihnyjdnaaergtcl`): migrations 0001 to 0016 (0009: `team_season_league`, every league that lists a team that season; 0016: `live_score` and `live_scores()`, ADR 0021), loaded after every push to `main` (`main.yml`) with live RLS and
  API-role checks (`.github/workflows/supabase.yml`, with `PRIVATE_DATA`); unchanged games are skipped, ~5 min. The site does not read the database yet
- **CI** on every push: database, league readers, history, school identity, ratings, typecheck, 98 page tests (phone
  and desktop, axe) on a production build, inside Playwright's container image
- **UI kit**: shadcn/ui on Radix (`apps/web/components/ui`: Button, Input, Label), tokens mapped to navy, red, Inter and
  Barlow Condensed in `globals.css`; used for new pieces only (search, Follow), existing pages unchanged
- **Stories** (Ladle, `apps/web/stories`): the scores board live, final, unconfirmed and postponed; crests with no,
  dark, light, wide and too-wide logos; invented schools and drawn marks only. CI builds them; never deployed
- **Tool checks** (Nov 11): Zod on every data file where it is loaded and before each robot commit; Lighthouse budgets
  on mobile settings (home, `/rankings`, `/results`, a program page); knip; ruff; Dependabot weekly. Licenses in
  `docs/licenses.md` (web-push is MPL-2.0, used unmodified and only in GitHub Actions)

## In progress
- Round 7 (My teams, Share, Sherman Grayson as one program in TAIAO and TCAF, Friday readiness tests for the CenTex
  alias and the Independent tab) on its PR. Logo round (ADR 0016, all 279 logos) building in a worktree

## Next three steps
1. Past UIL alignments (2024-26 first): UIL's robots.txt disallows `/files/`, where the PDFs live, so a robot may not
   fetch them. Needs the owner to download the 2024-26 six-man PDFs by hand. Loader and reader plumbing waits, unmerged, on
   branch `worktree-agent-a5da57ea8cad69af1` (e1417b1); `app/rankings/view.tsx` must stop throwing on unknown teams first
2. Check the first scheduled `Results watch` run in this repo (Fri Nov 13, 11:23 UTC, 5:23 AM CST): data-private
   commit first, then this repo's, its rerate (now with `was`), alerts and the Supabase load after it
3. Watch UIL region chances appear once area games are listed (around Nov 20) and round names as the playoffs advance

## Blockers and open items
- **Remote:** public repo `txsixman/txsixmanfootball`; commits as `TX Six-Man Football <contact@txsixmanfootball.com>`.
  Push with `GH_TOKEN="$(gh auth token)" git push`. Supabase is reached with `pg`. Raw captures: private
  `txsixman/data-private` (ADR 0017); set `PRIVATE_DATA` to a checkout of it to rate or load exactly as main does.
- **Cut-over done Thu Nov 12, 2026 (evening):** the old private repo's Results watch, League watch and Supabase
  workflows are disabled, `LIVE` is `true` here, and Vercel builds from this repo. Proofs before it: CI, League watch,
  Results watch (data-private commit, then this repo's) and the ratings table, all by hand. The old repo is history.
- **Never read SixManFootball.com** (robots.txt blocks Claude; partnership hard lines). Build from first principles.
- **Accepted risks (ADRs 0008, 0014):** MaxPreps terms of use; the domain's closeness to the incumbent's name; no
  attorney review. Optional: reset the Supabase password (it appeared in a transcript), then Keychain and the secret
  (`CLAUDE.md`).
- **Domain `txsixmanfootball.com`** (ADR 0014) is connected since Nov 11, 2026: Cloudflare DNS (the owner's account), DNS
  only per ADR 0001: two A records (216.150.1.1, 216.150.16.1) and `www` CNAME to Vercel; `www` redirects (308) to the
  bare address. Vercel issues both certificates.
- **Independent tab and Community Christian (the owner, Nov 11):** the Independent organization (CenTex Chargers) and TCAF's Community Christian
  (Mineral Wells) are in the alignments, but their games are not in the season files until the next `Results watch` run
  reads them (the aliases in `tools/league-watch/maxpreps-aliases.json` and the new alignment rows make that run keep
  them). Until then Independent has program pages and a Programs block only; its Rankings, Results and Records tabs
  appear on their own once a game is read (`lib/active-orgs.ts`), and Standings never lists it. Check the first run.
- **Private leagues still missing:** TCAL, TCSAAL (from public pages only; no outreach, ADR 0014). Sherman Grayson
  Christian School is in TCAF and TAIAO at once: one program, ranked in each (`programsFor`, `team_season_league`).
- **School logos** are an accepted trademark risk (ADRs 0006, 0016). 275 of 280 programs have one (Nov 11): edited where needed (padding trimmed, solid boxes stripped), the untouched originals in `data/seed/schools/logo-originals/`, many replaced by Dave Campbell's team-page logos. Missing, no allowed source found: Brazos Valley Lions, Community School of Mesquite, Grace (Perrin), New Braunfels Spartans, St. Mary's. Still weak: Founders Classical Conroe and Plainview share the Founders network mark; Immanuel (El Paso) and Vernon Northside are 100px. 34 logos still come from hosts (mostly ParentSquare's file host) whose robots.txt disallows a refetch, so their originals are the 320px copies kept from the first download.
