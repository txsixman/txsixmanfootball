# Decisions

| ADR | Decision | Status |
|---|---|---|
| [0001](../adr/0001-stack.md) | Next.js PWA + Supabase Postgres + Python ratings worker; Cloudflare DNS-only in front of Vercel | Accepted Nov 10, 2026 |
| [0002](../adr/0002-data-policy.md) | Permission-first data | Accepted Nov 10, 2026; attorney review before launch |
| [0003](../adr/0003-entity-model.md) | School, program and team-season are separate, with many-to-many lineage | Accepted Nov 10, 2026 |
| [0004](../adr/0004-scoreboard-design.md) | Box-score scoreboard; only a confirmed final names a winner | Accepted Nov 10, 2026 |
| [0005](../adr/0005-automated-league-pages.md) | A weekly robot may read a league's own public alignment page, as a visitor would | Accepted Nov 10, 2026 |
| [0006](../adr/0006-school-logos-and-colors.md) | Logos from each school's own site (an exception to permission-first); colors and mascots as cited facts | Accepted Nov 10, 2026 |
| [0007](../adr/0007-regular-season-capture.md) | Regular-season games by hand, one cited source a row; no robots, no embedded MaxPreps/Hudl schedules | Accepted Nov 10, 2026; hand-entry rule superseded by 0008 |
| [0008](../adr/0008-game-results-from-other-sites.md) | Game results read from MaxPreps schedule pages (facts only); never SixManFootball.com (blocks Claude) or Dave Campbell's API | Accepted Nov 10, 2026 (the owner) |
| [0009](../adr/0009-no-source-names-on-pages.md) | Pages do not name where robot-read results come from; the source URL stays in the data | Accepted Nov 10, 2026 (the owner) |
| [0010](../adr/0010-no-source-labels-on-any-page.md) | No source labels on any page (widens 0009); every source stays in the data | Accepted Nov 10, 2026 (the owner) |
| [0011](../adr/0011-records-and-multi-source-confirmation.md) | Records may name winners from unconfirmed scores; three or more agreeing sources confirm a score | Accepted Nov 11, 2026 (the owner) |
| [0012](../adr/0012-organizations-stay-separate.md) | Each organization (UIL, TAPPS, TAIAO, TCAF) stands alone on every page; no merged lists, "All" or "Private" groups | Accepted Nov 11, 2026 (the owner) |
| [0013](../adr/0013-records-and-standings-from-unconfirmed-scores.md) | W-L records, standings and bracket advancement may come from unconfirmed scores; game rows still name no winner | Accepted Nov 11, 2026 (the owner) |
| [0014](../adr/0014-solo-build-public-sources.md) | The owner builds alone from public internet sources: no reporters, LLC, attorney, sponsors or owner talk; the domain may be used publicly | Accepted Nov 11, 2026 (the owner) |
| [0015](../adr/0015-playoff-friday-night-reads.md) | Playoff Friday nights: results read every 30 minutes, 7 PM to midnight Central, tonight's unscored bracket games only | Accepted Nov 11, 2026 (the owner) |
| [0016](../adr/0016-logos-may-be-edited-and-come-from-more-sources.md) | School logos may be edited to look right (originals and an edit note kept); Dave Campbell's team pages are an allowed logo source, logo images only | Accepted Nov 11, 2026 (the owner) |
| [0017](../adr/0017-public-repo-private-captures.md) | The code is public; the robot's raw captures (source pages, team lists, outside games, coverage) are in the private `txsixman/data-private`, reached only by push, schedule and dispatch runs | Accepted Nov 12, 2026 (the owner) |
| [0018](../adr/0018-fan-accounts-and-posts.md) | Fan accounts (13+, email link or Google), follows, forums, game comments and score reports, moderated by code with no queue; supersedes 0014's no-posts and no-minor-accounts lines and 0011's three-source rule for fan reports | Accepted Nov 12, 2026 (the owner) |
| [0019](../adr/0019-playoff-reads-follow-the-games.md) | Playoff reads (ADR 0015) follow the games: every 10 minutes noon to midnight Central on any November or December day with an unscored bracket game, same rules | Accepted Nov 13, 2026 (the owner) |
| [0021](../adr/0021-live-scores-from-the-game-day-read.md) | Live scores from the game-day read: games under way go to the public `live_score` table every run (no commit, no rebuild) and show as "Live · period · score · Unconfirmed", never a winner; period unknown until a real in-progress page is seen | Accepted Nov 13, 2026 (the owner) |
| [0022](../adr/0022-logo-copies-sized-for-each-crest.md) | Each crest is drawn from a WebP copy sized for it (`tiny/` 192x64, `small/` 288x96, `large/` 780x180; lossless WebP of a palette image, the same visible pixels); the stored PNG and the untouched original stay (ADR 0016) | Proposed Nov 13, 2026 |
| [0023](../adr/0023-embeddable-scoreboard.md) | Embeddable scoreboard: `/embed/programs/<slug>` is the only framable route (every other route keeps `X-Frame-Options: DENY` and `frame-ancestors 'none'`); static, no cookies, one hash-allowed inline script, noindex; the program page shows the iframe snippet as text | Proposed Nov 13, 2026 |

Not in an ADR:
- Interviews are cut from the plan (the owner, Nov 10, 2026; see `docs/plan/v1.2-notes.md`).
- Vercel runs one plain project (Root Directory `apps/web`), not Vercel Services. Ratings stays off Vercel because it
  is a batch job with no web server (the owner, Nov 10, 2026).
- UIL title chances before the last four come from the data only (region closure); no hand-entered bracket template for
  now (the owner, Nov 11, 2026). Private-league outreach (TCAL, Mineral Wells Community Christian, frequent outside
  opponents) is skipped for now (the owner, Nov 11, 2026).
- An **Independent** organization is a fifth tab (one row in `ORGS`, ADR 0012), for six-man programs whose own site names
  no league. Its one team for now is CenTex Chargers Homeschool Sports Association (Temple), six-man since 2006 by its own
  site. It gets rankings, results and records, no standings (no districts) and no playoffs tab (no playoff games); a tab
  shows once the organization has a robot-read game (the owner, Nov 11, 2026).
- **Community Christian (Mineral Wells)** is a TCAF program, cited to its own site (ccsmw.org/athletics, which lists
  Six-Man Football under TCAF), though TCAF's 2026 file omits it; its district is left "District not listed" rather
  than guessed from 2022 news (the owner, Nov 11, 2026).
- **A school two leagues list in one season is one program** (Sherman Grayson Christian School, on TAIAO's and TCAF's
  2026 lists): one page, one rating, ranked within each league, its games under both. The hand TCAF row uses the name
  TAIAO's robot-read row and the results robot use, so the slug matches; if TAIAO's spelling changes, change the TCAF row
  with it. The database keeps one team-season (first league in the file) and every league in `team_season_league`
  (migration 0009). A league change between seasons needs nothing new: each season's file says its league (Nov 11, 2026).
