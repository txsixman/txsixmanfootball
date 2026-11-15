# Ratings audit, November 2026

Audited Nov 14, 2026, on `train/3` (main plus the PRs landing that night). Every line reference is to `train/3`. The ratings
code (`services/ratings/`, `apps/web/lib/`) is the same on `main`, `train/3` and PR 95. Only the game data differs.

**In short.** The model is sound and honest. Each week's rating uses only the games played before it, and calibration is
checked on seasons it was not fitted to. In 2026 the favourite won 86.6% of 655 games, against 76.5% for Elo and 55.1% for
"the home team wins". One number is wrong on the site today: a State Championship's title chance and the same game's chance
to win disagree (finding 1). Three small fixes are open as draft PRs (#115, #116, #117). The changes that would move
published numbers were listed as decisions for the owner at the end; all six were taken and are built in #121.

## Findings, most severe first

"Numbers move" means the fix changes a rating, rank, projection or chance that the site shows today.

### 1. A State Championship's title chance ignores the home edge its own game row uses (wrong number shown)
- **Where:** `apps/web/lib/title-chances.ts:34-37` (`beats`) and `:44`. A listed, unplayed final is scored with
  `beats(t, home, away)`, with no site, so the edge is 0. The same game's row on /scores and in the bracket uses
  `project(..., g.neutral)` (`lib/games.ts:122`, `lib/brackets.ts:100,116`), which gives the listed home team
  `home_field × playoff_edge` = 4.6 points.
- **Example:** the TCAF State Championship on Nov 14, 2026, Harvest Lantana (30.4, listed home) against Faustina Academy (53.1):
  - The game row says "Faustina Academy by 18 · 76% chance to win".
  - The title chances on /playoffs/tcaf, the home page, the program pages and the playoffs share card say Faustina 81%,
    Harvest Lantana 19%.
- **Same cause:**
  - Unplayed semifinals inside the last-four title chances (`title-chances.ts:52`) get no edge, while their game rows get 4.6.
  - The "likely next pairing" preview (`lib/playoff-path.ts:62`) uses each listed game's edge for the sides, but no edge for
    the meeting.
- **Fix:** one rule for both.
  - Either pass the listed game's site into `beats` for finals and semifinals,
  - or treat a State Championship as a true neutral site everywhere (its row too). Finals are played at neutral sites.
- **Numbers move:** yes, whichever way. **Status:** decision for the owner (D1).

### 2. Playoff games give the listed home team the full home edge, while comments call them neutral (misleading)
- **Where:** `services/ratings/rows.py:55` sets `PLAYOFF_EDGE = 1.0`, and `apps/web/lib/projection.ts:30-31` mirrors it. The
  comments at `lib/brackets.ts:16,21` and `services/ratings/run.py:367-369` still say "neutral site".
- **Example:** Blackwell against Cherokee on Nov 13 was played at a neutral field in Menard (ADR 0041). The listed home team
  still got +4.6 points, about +7 points of chance near an even game. ADR 0041 found 14 of 17 known bracket sites were not
  the home town.
- **Why it is 1.0:** the fitted share was 1.65 (SE 0.43), capped at 1, and it helped walk-forward log loss (0.3655 down to
  0.3621). It is fitted in-sample on the same playoff games. The listed home team is usually the higher seed, so the edge
  probably measures seeding, not the field.
- **Dead code:** the `neutral` branch at `rows.py:123-126` returns `PLAYOFF_EDGE`, which is 1.0, the same as a home game.
- **Fix:** at the least, make the comments say "listed home team". Beyond that, the owner chooses between keeping 1.0 and a
  seeding term or smaller share, re-rated.
- **Numbers move:** only if the share changes. **Status:** decision (D2).

### 3. A row's `neutral` value was read two ways (latent wrong number) — fixed in #116
- **Where:** `/scores` reads `neutral = "true"` as a true neutral site (`lib/games.ts:122`), as `rows.py:121` does. The bracket
  loader kept only a boolean (`lib/games.ts:182`). That meant a "true" row got the playoff share on /playoffs, in title
  chances and in the pairing preview.
- **Example:** a hand-captured State Championship row marked `neutral=true` would read "by X" on /scores and "by X+4.6" in its
  bracket. No 2026 row says `true` yet, so nothing differs today.
- **Fix (#116):**
  - `fieldOf` and `projectAt` in `lib/projection.ts`, used by /scores, brackets, playoff path and title chances.
  - Test in `scripts/playoff-run.test.mjs`.
- **Numbers move:** no.

### 4. Week-before projections count forfeits toward "four games played" (misleading)
- **Where:** `apps/web/lib/pregame.ts:50-52` counts games played, forfeits included. The rankings' NR rule and the backtest
  (`services/ratings/backtest.py:79-87`) count rated games.
- **Example:** Miami (2026, 0-7, 3 rated games) is NR on /rankings but shows week-before projections for its Oct 23 and Oct 29
  games. Four games are judged on the site that the backtest never scores: Calvert–Abbott, FBCA-Pasadena–Alpha Omega and
  Imperial Buena Vista–Trinity Midland on Sep 25, and Rankin–Fort Hancock on Oct 9.
- **Fix:** count `rated_trend` (rated games) for the threshold.
- **Numbers move:** yes, a few projections disappear. **Status:** decision (D3).

### 5. Earlier seasons are not re-rated when they change (process risk)
- **Where:** `.github/workflows/main.yml:55-61` and `commit-results.sh:86` re-rate only the current season. 2026 starts from
  the committed `data/ratings/2025.json` (`run.py:70-76`).
- **Risk:** a correction to a past season (`data/corrections`) or any model change needs a manual re-rate, oldest first, from
  2018. Nothing detects a stale prior:
  - `run.py:194` records only `prior_season: true`.
  - `same_table` (`run.py:241`) accepts a 0.15-point drift.
- **Fix:** store the prior file's hash in each season's JSON. Add a CI check that re-rates 2018 to the current season and
  compares.
- **Numbers move:** no, unless a stale prior is found. **Status:** decision (D4).

### 6. The backtest covers 2021 to 2026, while the site's chain starts in 2018 (misleading)
- **Where:** `services/ratings/backtest.py:35` (`SEASONS`), and `chain` (`:162-171`) starts 2021 from nothing.
- **Effect:**
  - The published 2018 to 2020 tables are never checked.
  - Backtest 2022 starts from a 2021 with no prior, while the site's 2022 starts from a four-season chain.
  - `backtest.json` predates the 2018–2025 store merge (commit a9749ab).
  - The committed 2026 row scores 599 games; today there are 655.
- **Fix:** extend `SEASONS` to 2018, rerun, and write the data's date into `backtest.json`.
- **Numbers move:** only /rankings/how's track-record tables. **Status:** decision (D4).

### 7. A State Championship bracket's chances can add to 101% (cosmetic)
- **Where:** `apps/web/app/playoffs/chance-list.tsx:16` rounds each chance on its own.
- **Example:** TAPPS II Small, with Valor already through: Valor 94.8%, Lone Star North 2.6%, Harvest Christian 2.5%. That shows
  95% + 3% + 3% = 101%.
- **Fix:** largest-remainder rounding.
- **Numbers move:** by a point at most. **Status:** decision (D5).

### 8. ">99%" starts at 99%, and the project notes say 99.5% (doc mismatch); three copies — copies fixed in #117
- **Where:** `lib/projection.ts:54` (`chanceText`, `p > 0.99`). `docs/context/PROJECT_STATE.md:25` says ">99%" is shown
  only above 99.5%. A 99.2% chance shows ">99%".
- **Copies:** the playoffs card (`app/playoffs/card.tsx:6`), the title-chance list (`app/playoffs/chance-list.tsx:27`) and the
  Records upsets board (`app/records/view.tsx:113`) each had their own copy.
- **Evidence for the cap:** the backtest supports it. 644 games were said 99% or more, and 99.7% of them happened.
- **#117:** every page now uses `chanceText`, and a test fails on a new copy. No shown text changes.
- **Open:** whether the line is 99% (code) or 99.5% (notes). **Status:** decision (D5).

### 9. Teams that only lost by the 45-point rule get a precise-looking rating (misleading)
- **Where:** `services/ratings/model.py:142-147`. A censored loss says only "at least 45", so the prior and the hazard set the
  rating.
- **Example (2026):** Savoy (0-9), Big Springs Charter and Wilson (1 rated game, NR) all read −89.9, with ±11 to ±20.
- **Fix:** show "below −60", or a floor, past a cut-off.
- **Numbers move:** display only. **Status:** decision (D6).

### 10. Teams with only forfeits are missing from the rankings, not listed as NR (cosmetic)
- **Where:** `services/ratings/rows.py:277-285` indexes only teams with a rated game.
- **Example (2026):** Fort Davis (0-4, all forfeits), Hedley, Pawnee, Cotton Center and Grace Christian Academy-Houston are not
  in `data/ratings/2026.json`, so /rankings never lists them.
- **Fix:** write them with `rated: 0` so they show as NR.
- **Numbers move:** team counts only. **Status:** decision (D6).

### 11. Small rounding and ordering effects (cosmetic)
- **Week tables:** for 3 teams, the latest week's `trend` value differs from `rating` by 0.1 (Baytown Christian 16.6 vs 16.5,
  Wildorado, Calvert). The cause is double rounding in `run.py`. /rankings/week/<latest> can show 0.1 off /rankings.
- **Ties:** equal ratings sort by name (`rank-range.ts:21`, ratings stored to a tenth). In 2026, two teams share 81.1 and two
  share 53.8.
- **Fix:** write `trend[-1]` from the same rounded value, and sort on the unrounded rating.
- **Numbers move:** 0.1 on three rows; tie order. **Status:** decision (D6).

### 12. "Latest ratings" and "current season" can split in 2027 (latent)
- **Where:** `loadRatings()` with no season (`lib/games.ts:102`, `lib/rankings.ts:42`, `app/matchup/page.tsx:23`) takes the
  newest file. Brackets and title chances use `loadRatings(CURRENT_SEASON)`.
- **Risk:** the day a `2027.json` lands before `CURRENT_SEASON` is bumped:
  - rankings and Matchup show 2027,
  - /scores projections vanish (the guard at `games.ts:121`),
  - brackets stay on 2026.
- **Fix:** bump both together. Better, use `loadRatings(CURRENT_SEASON)` everywhere.
- **Status:** recommendation, before August 2027.

### 13. Season pages said "state finals" (wording) — fixed in #115
- **Where:** `app/seasons/view.tsx:204,232`, `app/seasons/page.tsx:27`, `lib/descriptions.ts:147,153` (meta descriptions).
- **#115:** they now say "UIL State Championships". A test bans "state final(s)" in those descriptions and pins the heading.

## Calibration

- **15.57 against 15.55:** the scale is 15.57 in `model.py:51`, `backtest.json` and every `data/ratings/<season>.json` on
  main, train/3 and PR 95.
  - Commit a9749ab merged fresh 2021–2025 results, re-ran the backtest and got 15.55.
  - Commit faad233 put 15.57 back. `test_model.py:453` pins the backtest scale to `model.CALIBRATION`, and changing it
    rewrites the `calibration` field of every season file, so it was left for its own PR.
  - The difference is about 0.02 percentage points of chance. The leave-one-season-out scales range from 15.30 to 15.79, so
    15.57 is fine to keep.
- **No leakage:**
  - Each week's fit uses games dated before that week's Monday. The fit uses `prepare(..., before=Sunday+1)`
    (`run.py:311-312`), and `rows.py:247` drops games on or after that date.
  - The site's week-before projection takes the last Sunday strictly before the game (`pregame.ts:71`).
  - Rebuilt independently, the site's 2026 projections match a fresh walk-forward to 0.04 points per game, with the same
    pick in all 655 games.
  - A leaked version would show a 93% win rate in the 70–80% band; the site shows 76%.
- **Train/test split:**
  - Per-season numbers use a scale fitted with that season left out (`backtest.py:148-157`).
- **Small in-sample effects:**
  - The live scale is pooled over 2022–2026, 2026 included. Leaving 2026 out gives 15.79.
  - tau was tuned on 2022–2024 and checked on 2025–2026.
  - rho 0.6 was chosen by hand after seeing results; the data preferred 1.0.
  - PLAYOFF_EDGE was fitted on the same playoff games it is scored on.
  - A hidden outside team is kept by its whole-season schedule (`rows.py:227-233`), so early-week fits know about it.
  - None of these uses a game's own result, and the tuning grids are flat (tau 20 to 35 moves log loss by 0.003).

## Accuracy on 2026 results so far

- **Stored or rebuilt:** pre-game projections are not stored per game. The site rebuilds them at build time from each week's
  `trend` ratings (`lib/pregame.ts`). For this audit they were rebuilt twice and agree:
  - as the site does,
  - as an independent walk-forward (`backtest.predict_season`, starting from 2025's final ratings).
- **Games:** 655 played games through Nov 14, between two listed teams, each with four or more rated games. Forfeits (30)
  and the one tie are out. Each game is counted once: all 92 played playoff games are also in `games.csv`, with the same
  score. The newest scores are unconfirmed.
- **Margin error:** clipped at 45 on both sides, as the 45-point rule ends a game there.

| | Games | Favourite won | Margin error | Brier |
|---|---|---|---|---|
| **Model (week before)** | 655 | **86.6%** | **11.7** | **0.093** |
| Model without last season's start | 655 | 85.5% | 13.0 | 0.100 |
| Elo | 655 | 76.5% | 21.4 | 0.153 |
| Last season's final rating plus home edge | 655 | 72.5% | 22.2 | 0.202 |
| Home team wins | 655 | 55.1% | — | — |

- **Log loss:** 0.290.
- **Without the clip:** margin error is 24.9, because 60% of games end 45 or more apart.
- **Agreement:** the committed `backtest.json` row for 2026 (599 games, an earlier snapshot) gives 87.0%, 11.8 and 0.093.

| Split | Games | Favourite won | Margin error | Brier |
|---|---|---|---|---|
| Regular season | 566 | 86.4% | 11.8 | 0.094 |
| Playoffs | 89 | 87.6% | 11.1 | 0.084 |
| UIL | 383 | 88.8% | 10.8 | 0.081 |
| TAPPS | 128 | 84.4% | 11.8 | 0.102 |
| TAIAO | 76 | 86.8% | 11.9 | 0.084 |
| TCAF | 7 | too few | | |
| Across organizations | 61 | 77.0% | 18.2 | 0.159 |

Calibration, by the favourite's chance to win:

| Said | Games | Average said | Happened |
|---|---|---|---|
| 50–60% | 57 | 55.3% | 56.1% |
| 60–70% | 65 | 64.9% | 61.5% |
| 70–80% | 67 | 74.9% | 76.1% |
| 80–90% | 101 | 85.4% | 83.2% |
| 90–95% | 73 | 92.8% | 97.3% |
| 95–99% | 137 | 97.3% | 97.8% |
| Over 99% | 155 | 99.6% | 100% (155 of 155) |

- **Read:** every band is within a few points of what it said.
- **Weakest group:** games across organizations (77%). Their group means are fitted from few games between leagues.
- **Biggest miss:** Happy at Claude, Sep 25. The projection was Claude by 53 (97%); Happy won by 2.

## What is fine

- **Inputs:** one rule for which games count (`rows.py`), shared by the site's ratings and the backtest and twinned with the
  web code under tests (`test_model.py:470,493`).
  - Forfeits (1-0, 2-0 or an end reason of forfeit) count in W-L and never in a rating.
  - No page shows a forfeit as a score.
  - 0-0 games are dropped; duplicates are dropped.
- **The 45-point rule:** applied the same way in the fit, Elo, the backtest and the "45+" display. The margin histograms show
  the same pile at 45 in every league.
- **Priors:**
  - Each season starts from last season at 0.6 of its gap from its league's mean.
  - 2018 starts from league means alone.
  - League means keep UIL Division I and II, TAPPS, TAIAO, TCAF and Independent apart.
- **Rankings:**
  - Built in one place (`lib/rank-range.ts`), within one organization or UIL division at a time; nothing ranks across
    organizations.
  - Teams under four rated games are NR, listed last and left out of others' rank ranges.
  - Sherman Grayson has one rating, ranked in both TAIAO and TCAF.
- **One function each:** ratings show at one decimal through one helper (`signed`), projections come from one function
  (`project`), and the calibration scale is read from the ratings file, never hard-coded in the site.
- **Words:** the last round is always "State Championship" (`roundLabel`). No visible text says "win probability" or uses a
  betting word.
- **Title chances on `train/3`:** the new two-teams-left case is right. A confirmed semifinal winner goes through with
  certainty; a disputed or tied semifinal holds the bracket back. Before the final is listed it agrees with the bracket's
  open game (TAPPS I: Covenant 76.5%, Emery 23.5%).
- **Tests:** the ratings tests pass (69 in 25 seconds).

## Decisions for the owner

**Taken Nov 14, 2026** (pilot mode; the owner may override): every recommendation below, as written, in #121 with ADR
0057 for D1 and D2. The backtest from 2018 (D4) retuned tau from 30 to 25 and the win-probability scale from 15.57 to
14.56; out of sample nothing changed (2022 to 2026 log loss 0.308, favourite won 86.4% of 2,999 games). Forfeit-only
teams (D6) are listed under the rankings table as not rated, not written into the ratings file.

| | Decision | Recommendation | What moves |
|---|---|---|---|
| D1 | One rule for a State Championship's site | Treat finals as true neutral sites everywhere, row and title chance alike | Final and semifinal chances by up to ~5 points |
| D2 | Playoff home edge | Keep 1.0 for now, fix the comments, and test a seeding term next season | Every playoff projection, if changed |
| D3 | The four-games threshold | Count rated games, as the rankings and backtest do | A few early projections disappear |
| D4 | Chain and backtest | Store the prior's hash, re-rate 2018 to now in CI, and backtest from 2018 | Nothing unless stale; /rankings/how tables |
| D5 | Chance rounding | Largest-remainder rounding in title chances; keep ">99%" at 99% and fix the note | One point at most |
| D6 | Display polish | Floor for all-mercy-loss teams, list forfeit-only teams as NR, one rounding for week tables | Display only |
