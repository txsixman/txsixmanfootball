# Ratings round, before and after (Nov 11 to 12, 2026)

Work list: section 5 of `ratings-2026-11-11.md`. Before = commit 58a058f's files. The first pass picked rho 1.0 (the
best walk-forward score); the owner chose less carryover, rho 0.6 (Nov 12), and the other settings were retuned at it. That is
what ships ("after"); the rho 1.0 numbers stay here for comparison. Every number is walk-forward (each week is predicted
from earlier games only, scored once both teams have 4 rated games). Regenerate with `run.py --season` (2021 to 2026, in
order) and `run.py --backtest`.

## Gate G3 by season (winner picked / margin miss in points / log loss)

| Season | Games | Before | rho 1.0 | After (rho 0.6) | Elo | Last season |
|---|---|---|---|---|---|---|
| 2021 | 455 | 85.0% / 13.5 / 0.321 | 84.8% / 12.4 / 0.302 | 84.4% / 11.9 / 0.292 | 79.1% / 19.4 / 0.446 | none |
| 2022 | 522 | 84.8% / 14.6 / 0.385 | 85.8% / 13.0 / 0.323 | 85.4% / 13.1 / 0.326 | 78.0% / 20.8 / 0.455 | 75.1% / 23.2 / 0.535 |
| 2023 | 546 | 86.6% / 12.8 / 0.340 | 88.1% / 11.7 / 0.289 | 86.8% / 11.9 / 0.292 | 76.4% / 22.3 / 0.476 | 75.3% / 21.4 / 0.485 |
| 2024 | 597 | 82.6% / 15.6 / 0.380 | 85.4% / 13.2 / 0.324 | 86.1% / 13.6 / 0.332 | 74.4% / 22.1 / 0.508 | 73.7% / 22.5 / 0.532 |
| 2025 | 642 | 85.9% / 13.3 / 0.343 | 87.5% / 11.7 / 0.286 | 88.3% / 12.2 / 0.298 | 79.0% / 19.6 / 0.439 | 74.5% / 20.9 / 0.498 |
| 2026 | 599 | 86.5% / 13.4 / 0.351 | 86.8% / 11.4 / 0.287 | 87.0% / 11.8 / 0.291 | 77.3% / 21.2 / 0.461 | 72.3% / 22.4 / 0.525 |
| 2022 on | 2,906 | 85.3% / 14.0 / 0.359 | 86.8% / 12.2 / 0.301 | 86.8% / 12.5 / 0.308 | 77.0% / 21.2 / 0.468 | 74.1% / 22.0 / 0.515 |

G3 still passes: the model beats Elo and last season's rating every season from 2022 on, on winner picked and margin miss
(and on log loss). Against rho 1.0, rho 0.6 picks the same share of winners from 2022 on and misses margins by 0.3 points
more. 2021 ticks down 0.6 points on winners against before (it has no last season to start from); its margin miss and log
loss improve. Before-numbers use the old normal curve at each week's sigma; after-numbers use the calibrated curve. Games
counted differ slightly from before because forfeits and duplicates no longer count.

## Calibration (2022 to 2026): what the page said vs what happened, by favorite's chance

| Chance said | Before: said / happened (games) | After: said / happened (games) |
|---|---|---|
| 50 to 60% | 55 / 59 (271) | 55 / 60 (270) |
| 60 to 70% | 65 / 62 (276) | 65 / 67 (273) |
| 70 to 80% | 75 / 74 (317) | 75 / 76 (283) |
| 80 to 90% | 85 / 79 (384) | 85 / 84 (460) |
| 90 to 95% | 93 / 88 (320) | 93 / 94 (374) |
| 95 to 98% | 97 / 91 (315) | 97 / 95 (384) |
| 98 to 99% | 99 / 95 (156) | 99 / 100 (218) |
| 99% and up | 99.8 / 98.1 (989) | 99.7 / 99.7 (644) |

The old curve was overconfident everywhere from 80% up (a "99%+" game lost 1 in 53). Family chosen by leave-one-season-out
log loss: logistic at a constant scale of 15.57 points (0.3075), over normal-constant (0.3083), logistic at the week's sigma
(0.3122) and normal at the week's sigma (0.3146). Pages show ">99%" only above 99.5%.

## UIL top 10 (2026), rating

| # | Before | rho 1.0 | After (rho 0.6) |
|---|---|---|---|
| 1 | Whiteface 102.6 | Whiteface 137.3 | Whiteface 128.6 |
| 2 | Borden County 102.1 | Borden County 137.1 | Borden County 127.5 |
| 3 | Gilmer Union Hill 92.7 | Aquilla 124.3 | Menard 117.4 |
| 4 | Jayton 78.4 | Menard 121.8 | Aquilla 116.7 |
| 5 | Hermleigh 76.5 | Gilmer Union Hill 118.5 | Gilmer Union Hill 110.0 |
| 6 | Menard 72.0 | Jayton 111.6 | Jayton 98.4 |
| 7 | Water Valley 69.3 | Water Valley 105.5 | Water Valley 95.0 |
| 8 | Aquilla 68.1 | Lamesa Klondike 102.0 | Hermleigh 92.7 |
| 9 | Newcastle 67.8 | Hermleigh 100.2 | Lamesa Klondike 89.2 |
| 10 | Rankin 67.8 | Gordon 97.7 | Rankin 87.5 |

The scale is wider than before (the hierarchy pulls less toward zero and calibration absorbed the change), so compare
ranks, not points.

## The 12 biggest 2026 UIL rank moves, before to after (of 153 UIL teams; median move 4)

| Move | Team | Record, 2025 UIL rank | rho 1.0 rank |
|---|---|---|---|
| -24 | Morgan #71 to #95 | 6-3, 128 | #98 |
| -23 | Benavides #88 to #111 | 5-3, 139 | #117 |
| -18 | Gholson #125 to #143 | 1-8 (2 forfeits no longer rated), 121 | #144 |
| +17 | O'Donnell #83 to #66 | 3-7, 52 | #63 |
| -16 | Eden #101 to #117 | 1-5, 62 | #116 |
| +16 | Ira #94 to #78 | 1-9, 18 | #64 |
| +15 | Benjamin #106 to #91 | 5-4 (1 forfeit dropped, 1 outside game added), 8 | #82 |
| -14 | Iredell #40 to #54 | 7-3, 71 | #54 |
| +14 | Spur #146 to #132 | 1-9, 100 | #131 |
| -13 | Amherst #133 to #146 | 0-7, 84 | #141 |
| +13 | Bluff Dale #61 to #48 | 5-5 (1 forfeit dropped), 33 | #45 |
| -13 | Runge #43 to #56 | 8-2, 72 | #62 |

Two causes recur: last season carried in as the starting point, and the league means. At rho 0.6 the carryover moves are
smaller: Ira sits at #78, not #64.

## Chosen parameters

- Prior: last season's rating, keeping 0.6 of its gap from the team's league mean (rho 0.6, the owner Nov 12, 2026); tau = 30
  (team spread around that, tuned at rho 0.6 over 20, 25, 30 and 35: 0.3198, 0.3172, 0.3169, 0.3173); sigma prior 17 with
  sd 0.25 on its log, floor 5. The first pass tuned rho and tau jointly over rho (0.6, 0.8, 0.9, 1.0) and chose 1.0. The
  sigma prior and group spread barely move the score.
- League means (2026): UIL Division I 21.7, TAPPS 7.0, Independent -7.9, TCAF -17.0, UIL Division II -19.0, TAIAO -19.7;
  hidden outside schools -42.0 (never shown). Group means are pulled toward last season's with sd 15.
- Home edge 4.6, sigma 19.8 (2026 fit). Robot-read playoff games get the full home edge (share 1.0): fit on all six seasons
  the share was 1.65 (SE 0.43), capped at 1.
- Win probability: logistic(margin / 15.57), the same in every week; forfeits (1-0, 2-0) and 0-0 games are dropped from the
  fit, never from the records; duplicates dropped (`report` counts them in each season file).
- Hidden nodes: schools outside the alignments that played 2 or more listed schools stay in the fit (2026: 14 schools),
  read from each season's `outside.csv`.
