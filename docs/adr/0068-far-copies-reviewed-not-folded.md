# ADR 0068: A far copy is reviewed, never folded in by a wider rule

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It adds a check beside the duplicate rule
(`apps/web/lib/duplicate-game.ts`, two days) and leaves that rule as it is.

## Context
- The Nov 14 data audit found five pairs with the same two teams and the same score more than two days apart (2018 Veribest
  at Bronte, 2019 McLean and White Deer, 2021 Rule at Throckmorton, 2024 Abbott and Aquilla, 2025 Ira at Robert Lee). The
  duplicate rule does not catch them, so each counted as two games in records and ratings.
- A wider window would fold real rematches into one game: a district game and a playoff game between the same teams can
  end with the same score. Two of the five turned out to be exactly that.
- Five same-night doubles were kept as known exceptions in `data/integrity-exceptions.json` with no further review.

## Decision
1. **The rule stays at two days.** Nothing folds a far copy automatically.
2. **A new check, every season** (`apps/web/scripts/data-integrity.mjs`, run by `check-data.mjs` in CI and before every
   robot commit): two played games between the same two teams with the same score (each team's own, so swapped sides
   count) more than two days apart fail as `far-copy <date>|<team>|<team>` (the later row). A forfeit, a 0-0 no contest
   and a row the two-day rule already caught are left out.
3. **Each one is settled with evidence**: a void in `data/corrections/games.csv` (with the listing's own page in
   `source_url`) when the schedules name the real game, or an entry in `data/integrity-exceptions.json` that says what was
   checked. An exception that no longer matches anything still fails, as before.
4. **What counts as evidence** is what the repo and the private captures already hold, plus a re-read of each school's
   schedule page through the reader's own rule (ADR 0008): when each listing was set up and entered, the kickoff time, the
   district round robin, the other teams' games that week, bye weeks and deleted listings. A guess never voids a row.

## The ten cases (reviewed Nov 15, 2026)
| Case | Verdict | Why |
|---|---|---|
| 2018 Veribest at Bronte | void 10-22 | Listed again on Monday 10-22 with no kickoff (the time is the moment it was entered that morning); the Friday 10-19 district game was set up in April |
| 2019 McLean and White Deer | void 10-18 | The district round robin puts the game at McLean on 10-25 (Turkey Valley played Miami that night) and Miami played outside the district on 10-18; the 10-18 row is left over from the May schedule, whose other White Deer district dates were deleted when it was redrawn in July |
| 2021 Rule at Throckmorton | void 10-08 | Both teams played the night before (Rule hosted Loop, Throckmorton hosted Lueders-Avoca); the 10-01 game was set up in June and the 10-08 listing was added in August |
| 2024 Abbott and Aquilla | keep both | District game 11-08 and UIL regional 11-29; Abbott went on to the semifinal and Aquilla's season ended, so both were played |
| 2025 Ira at Robert Lee | keep both | Non-district 9-12 and UIL bi-district 11-14; Robert Lee went on to the area round, so both were played |
| 2018 Rotan | void Rotan at Guthrie | Guthrie forfeited its 8-31 and 10-04 games and has no other score; Moran put Rotan on its own schedule for 9-21 on 9-04, and the 38-7 was first entered on that listing too, before the 22-15 one both schools show |
| 2018 Rankin | keep (reviewed) | The district round robin favors Marfa, but the Titans' own game that night was deleted and the Rankin game set up the evening before, which also fits a late replacement |
| 2020 Lorenzo | keep (reviewed) | Both from the June schedule entries; a post-game listing names Lazbuddie but at a neutral site, like the Kingdom Prep row |
| 2022 Christian Heritage Classical | keep (reviewed) | Leveretts Chapel's own game that night was deleted and the neutral game listed the next morning; it may have been played the next day |
| 2026 Logos Prep | keep (reviewed) | Both Second Baptist UM campuses list it, entered 8 days and 2 months after the game; both campuses played the next week |

## Consequences
- A new far copy from a robot read fails its commit until it is reviewed, so it can no longer slip into records unseen.
- The three far-copy voids and the Rotan void change the 2018, 2019 and 2021 records; the ratings tables for those seasons
  are re-rated by the After merge workflow (`run.py --chain`), never by hand.
- The Rotan-Moran row keeps the 22-15 both schools show. The 38-7 once on that listing is recorded here, not in the data,
  since no source says it was the real score.
