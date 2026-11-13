# Project 80x40

A fast, mobile-first platform for Texas six-man football: live scores and alerts, ratings and playoff odds,
a complete almanac since 1938, and community. Codename only; the public brand is undecided.

@docs/context/PROJECT_STATE.md
@docs/context/DECISIONS.md

## Authority
- The plan is `docs/plan/` (latest version wins). Plans are versioned, never overwritten.
- Latest: `docs/plan/v1.2.md` (v1.1's PDF with the changes listed there). Its source notes: `docs/plan/v1.2-notes.md`.
- Decisions go in `docs/adr/` as new numbered files, with one line in `DECISIONS.md`. Never edit an accepted ADR.

## Layout (grows by phase; nothing is scaffolded before it is needed)
- `packages/db/migrations/`: SQL migrations, run in filename order
- `packages/db/test/`: schema and import tests on an in-process Postgres (PGlite)
- `packages/db/seed.mjs`, `games.mjs`, `champions.mjs`, `lineage.mjs`: alignment, game, state-final and lineage importers (safe to re-run, audited); `load.mjs` applies new
  migrations and every seed file to Supabase, then removes any program no alignment file lists that has no game, final or
  lineage row (each removal in `audit_log`); `supabase-ca.crt` is Supabase's public root certificate
- `packages/db/live.mjs`: writes the file `maxpreps.mjs --live-out` made into `live_score` in one transaction (upsert, delete
  what is not in it, delete rows over 6 hours old); run by `results-watch.yml` right after the read (ADR 0021)
- `packages/core/six-man.mjs`: score checks from plan Appendix B (soft flags)
- `services/ratings/`: censored-margin model (a season starts from last season and from each league's level; win chance is
  calibrated, `model.py`), Elo baseline, simulated-season comparison; `rows.py`: the one rule for what counts as a rated game
  (forfeits, 0-0 and duplicates out; unlisted opponents in as hidden teams); `backtest.py`: Gate G3's walk-forward
  backtest (`run.py --backtest`, ~4 min on 10 cores, writes `data/ratings/backtest.json`; rerun it after the model or a season's
  games change, then copy its rho, tau and calibration scale into `model.SETTINGS` / `CALIBRATION`; a test fails if they drift)
- `data/ratings/<season>.json`: the ratings table `/rankings` shows, written by `services/ratings/run.py --season` (the
  `ratings-table` job in `main.yml` and `results-watch.yml` commit it; both rate with `PRIVATE_DATA`, below). Never edit by hand. A season starts from the one before it, so
  after a model change rerun 2021, 2022, ... 2026 in that order. Fields are listed at the top of `run.py`
- `data/seed/uil-2026-28/`: UIL alignments (with regions) and the 2026 playoff capture file
- `data/seed/private-2026/`: TAIAO, TCAF and Independent alignments, 2026 only. TAIAO rows are written by
  `tools/league-watch/taiao.mjs`, never by hand (ADR 0005); TCAF and Independent rows by hand, one cited source a row
  (the school's own site for Community Christian and CenTex Chargers; `maxpreps-aliases.json` maps their MaxPreps pages)
- `data/seed/tapps-2026-28/`: written by `tools/league-watch/tapps.mjs`, never by hand (ADR 0005)
- `tools/league-watch/`: robot readers. `tapps.mjs` and `taiao.mjs` (alignments, weekly via `league-watch.yml`); `maxpreps.mjs` (game
  results, Fri to Sun mornings Aug to Jan, plus every 10 minutes noon to midnight on playoff game days (`--tonight`, ADRs 0015 and 0019), via `results-watch.yml`, which also rerates and commits to `main`; `--season 2025`
  reads a past season's pages). A night read also writes the games under way (`--live-out`, ADR 0021) for `packages/db/live.mjs`,
  which replaces the rows of the `live_score` table (migration 0016); the site reads it in the browser through the
  public function `live_scores()` (`apps/web/lib/live-scores.ts`, `app/scores/live-score.tsx`; the Supabase URL and key
  are `lib/supabase-public.ts`, shared with push). Never committed, never a rebuild; "Unconfirmed", no winner
- `data/seed/maxpreps-<season>/`: `games.csv` (played games) and `playoffs.csv` (bracket games with league, division and
  round, for `/scores`), the facts only (ADR 0017): no `source_url` or `notes`. Published by
  `tools/league-watch/publish.mjs` from the reader's own folder, never by hand
- The reader's own folders (ADR 0008, ADR 0017) live in the private repo `txsixman/data-private` as `maxpreps-<season>/`:
  `games.csv` and `playoffs.csv` with each game's source page, `outside.csv` (games against schools outside our
  alignments, only for the ratings' hidden teams; never shown), `teams.csv` (next run's starting pages), `coverage.txt`.
  The env var `PRIVATE_DATA` (a checkout of that repo) points the reader, the ratings and `packages/db/load.mjs` at it.
  Without it the ratings have no hidden teams (not the published table) and the DB tests load the public files.
  `DATA_PRIVATE_TOKEN` reaches it only from push-to-main, schedule and dispatch runs (`main.yml`, `results-watch.yml`,
  `supabase.yml`); CI's data job fails if a pull-request workflow names it (`.github/scripts/token-guard.sh`)
- The repo variable `LIVE` (true from cut-over): until then no schedule writes, and alerts, the hosted database and the
  ratings-table commit do nothing. Proofs by hand: Results watch with `write` pushes both repos, an After merge
  run rates and commits the table, and a Supabase run (dispatched itself, not called) loads the hosted database
- Site freshness (`site-freshness.yml`, hourly Nov–Dec, else every 6 hours, LIVE only): fails, so GitHub emails the
  owner, when production's `/build.json` commit has lacked a data commit on main for over 30 minutes; Results watch's
  `deployed` job reports "Deployed" or "Not yet" after each push (`.github/scripts/site-freshness.mjs`)
- `data/seed/uil-champions/`: written by `tools/history/uil-champions.mjs` from UIL's own final archive, never by
  hand: `six-man.csv` (every six-man state final since 1972) and `six-man-no-final.csv` (1941 to 1971, no state final).
  UIL's town-plus-school spellings map to current names in `tools/history/uil-aliases.json`. Rerun after each December final: `UIL_CACHE=$TMPDIR/uil NODE_USE_ENV_PROXY=1 node tools/history/uil-champions.mjs`
- `data/seed/lineage/programs.csv`: mergers and renames (ADR 0003), by hand, one cited source a row (TEA's consolidation
  list first). A merged school's finals show on the program it became
- `data/seed/schools/`: `identity.json` (each school's site, mascot, colors and logo, every fact with its source URL)
  and `colors.json` (color name to hex) (ADR 0006)
- `tools/school-identity/`: `merge.mjs` fills gaps from research batches, `wikipedia.mjs` fills colors and mascots
  from infoboxes, `fetch-logos.mjs` downloads logos (outside a sandbox; `--refresh` all, `--rebuild` from the originals,
  `--only slug,slug`), keeps each untouched original in `data/seed/schools/logo-originals/` and stores the tidied
  copy (fits 1200x320, plus a 288x96 copy in `small/`) in `apps/web/public/logos/`; `measure.mjs` is its tidy and
  light-mark rules; `audit-logos.mjs` lists logos that look wrong; `contact-sheet.mjs` draws every logo on white and navy
- `apps/web`: Next.js site (Vercel, Root Directory `apps/web`); `lib/score-display.ts` holds the winner and
  verification rules (ADR 0004); `lib/demo-games.ts` is invented schools only
- `tools/push/`: score alerts (web-push), sent by `results-watch.yml` after it pushes new finals; subscriptions in
  Supabase `push_subscription` (migration 0008)
- Later: `packages/sms`

## Commands
- `npm --prefix packages/db test`: apply every migration to a throwaway database and check the rules
- Load Supabase (project `vhgnaihnyjdnaaergtcl`, the owner's personal org, us-east-1; outside a sandbox, ~3 min):
  `PGPASSWORD="$(security find-generic-password -a postgres -s project-80x40-supabase-db -w)"
  PGHOST=aws-0-us-east-1.pooler.supabase.com PGUSER=postgres.vhgnaihnyjdnaaergtcl
  PGSSLROOTCERT=packages/db/supabase-ca.crt node packages/db/load.mjs`. The password lives only in the owner's Keychain
  and the `SUPABASE_DB_PASSWORD` repo secret; `.github/workflows/supabase.yml` runs the same load from CI and Results
  watch, then checks row-level security and the API roles on the live database. Refresh the secret from Keychain:
  `security find-generic-password -a postgres -s project-80x40-supabase-db -w | tr -d '\n' | gh secret set
  SUPABASE_DB_PASSWORD -R txsixman/txsixmanfootball`
- Supabase access for Claude is the database only, with the Keychain password above (`pg`, any SQL). The `supabase`
  CLI on this Mac is signed in to another Supabase account, which cannot see this org, so the
  project's logs, advisors and settings are dashboard-only (the owner, Nov 11, 2026: the org stays where it is). Never
  run `supabase login` or `supabase link` for this project. `supabase.yml` also runs every Monday, because a free
  project pauses after 7 days without activity
- `scripts/check.sh` (`--quick` skips the throwaway database and the stories build): every CI check that needs no
  build, in one command, with a pass/fail summary; run it before pushing. The commands it runs are listed below
- `uv run --directory services/ratings pytest -q`: ratings tests
- `uv run --directory services/ratings python run.py --simulate`: compare models on simulated seasons
- `uv run --directory services/ratings python run.py --season 2026`: rate every game file of a season into `data/ratings`
- `NODE_USE_ENV_PROXY=1 node tools/league-watch/maxpreps.mjs [--season 2026]`: read results (~12 min; the env var lets
  Node use the sandbox proxy)
- `uv run --directory services/ratings python run.py --json ../../apps/web/lib/demo-ratings.json sample-games.csv`:
  refresh the invented `/rankings/sample` table after changing the model (a test fails until you do)
- `npm --prefix apps/web run typecheck`; `apps/web/node_modules/.bin/playwright test -c apps/web/playwright.config.ts`:
  phone and desktop page tests with axe (starts the dev server on :3011; outside a sandbox)
- Never run `next build` locally: Vercel builds every push to `main` (`npm run build` is `next build`, then `search-index`
  (Pagefind) and `service-worker` (Serwist, esbuild); both also write into `.next/output/static` on Vercel)
- Vercel (the owner's team, project `txsixmanfootball.com`): the CLI is installed globally
  (`vercel`, nvm node) and logged in as the owner; it needs a run outside the sandbox. The main
  checkout is linked (`.vercel/`, gitignored); in a worktree add `--scope <vercel-team> --project
  txsixmanfootball.com`. `vercel list` (deploys), `vercel inspect <url> --logs` (build log), `vercel logs
  --environment production`, `vercel curl <path> --deployment <url>` (fetches a protected preview through the
  project's automation bypass), `vercel api <REST path>` (any setting). A deploy is skipped unless `apps/web` or
  `data/` changed (the project's Ignored Build Step). Never `vercel env pull` or `vercel deploy` from a laptop:
  pushes to `main` deploy, branches get protected previews. `vercel link` writes a short-lived OIDC token to
  `.env.local`; delete it, the site uses none
- `node apps/web/scripts/check-data.mjs`: Zod check of every seed and robot-read file (`lib/data-schemas.ts`), then
  the cross-file checks (`scripts/data-integrity.mjs`: hard ones fail, on the current season; soft ones warn in the
  run summary); the robots run it before they commit. Fix a hard failure with a correction or an alias, never by
  editing robot output; one the source cannot settle goes in `data/integrity-exceptions.json` with its reason (an
  exception that matches nothing fails, so remove it once fixed). `node --test apps/web/scripts/*.test.mjs`: its tests and the build scripts' tests
- `(cd apps/web && npx --yes knip@6.45.1)`: unused files, exports and dependencies (a CI check; unexport, don't ignore)
- `uvx ruff@0.17.4 check && uvx ruff@0.17.4 format --check`: Python lint and format (`ruff.toml`, a CI check)
- `npm --prefix apps/web run stories` (Ladle, :61000): components in every state, invented schools only;
  `stories:build` is the CI check
- Screenshot tests (`apps/web/e2e/screenshots.spec.ts`, CI only): sample pages whole, live pages' header and heading.
  To approve a look change, push it to a branch named `screenshots/<anything>`. The `Update screenshots` workflow
  (`.github/workflows/screenshots.yml`) commits new baselines from CI's container there; then land the branch. Never
  make baselines on a Mac
- Lighthouse budgets (`apps/web/lighthouserc.cjs`) run in CI only, on the shared build; the numbers are in the run
  summary. Raise a budget only with the reason in the file's comment
- CI's site checks run in parallel (`ci.yml`): `web-checks`, one `web-build` shared as an artifact, `web-pages` (page
  tests in 6 shards of 2 workers, `--shard`) and `lighthouse` (two pages a job, its own check). Shards and Lighthouse
  set up while the site builds, then wait for it (`.github/scripts/wait-for-build.mjs`). The `web` job passes only if
  web-checks, web-build and every shard did; a docs-only change (`docs/**`, `*.md`, via paths-filter) builds nothing
  and `web` passes. Merging waits on the checks named `data` and `web`, so keep both names
- `npm --prefix tools/push test`: the score-alert sender. Push keys: `node tools/push/setup-vapid.mjs` (once; the
  private key goes to Keychain `project-80x40-vapid-private` and the `VAPID_PRIVATE_KEY` secret; `--rotate` replaces it
  and every follower must tap Follow again)
- Tool licenses: `docs/licenses.md` (add a row with every new tool). Dependabot opens grouped update PRs each Monday

## Hard rules
- **Permission-first data** (ADR 0002): collect facts first-hand, cite secondary sources, use another site's
  compilation only with permission. Never read SixManFootball.com (its robots.txt blocks Claude by name). Never use
  CalPreps. **Exception (ADR 0008):** game results (date, teams, score) from MaxPreps team schedule pages only, by
  `tools/league-watch/maxpreps.mjs`; never its APIs, stories, stats, players or logos. Pages never name
  or link any source (ADRs 0009, 0010); every source stays in the data.
  A league's own public alignment page may be read by robot only under ADR 0005 (as a visitor, weekly, robots.txt,
  never its data server directly).
- **School logos** (ADRs 0006, 0016): from the school's or district's own site first, then Dave Campbell's Texas
  Football team pages (logo images only; robots.txt obeyed on every host). Edits are allowed (trim, strip a background,
  crop, recolor, upscale), but the untouched original stays in `data/seed/schools/logo-originals/` and every edit has
  an `edit` note in `identity.json`. Removed on request (`removed` in `identity.json`). Never Wikipedia images,
  MaxPreps, Hudl, fan sites, SixManFootball.com or CalPreps.
- **Partnership hard lines** (plan section 15): never poach the site's moderators or members publicly, never
  disparage it, never use its name or content without permission.
- **Minors**: no birth dates (fan accounts keep the birth year only, never shown; ADR 0018), no public real names,
  contact details, player rankings or precise location for minors; no minor's data to any third party. No direct messages.
- **Betting**: the words are rating, projected margin and win probability. Never spreads, lines or odds.
- **Row-level security on every table.** A new table without it fails the schema test.
- **`score_submission` is never deleted; `audit_log` is append-only.** Enforced by triggers.
- **Six-man scoring flags are soft for admins** (plan Appendix B), so they live in `packages/core`, not in
  database constraints. Real results include extreme outliers. Database constraints are for structure only.
- Secrets never enter the repo. `.env*` is gitignored.

## Handoff
End every working session with the `handoff` skill, so any account or machine can pick up from the repo alone.
