# ADR 0099: A season in review for each organization, counted from the data

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It adds to ADR 0012 (one organization at a time),
ADR 0040 (a final is confirmed), ADR 0083 (one list of State Championships) and ADR 0092 (week recaps). It extends ADR 0092's
allowance of the word "upset" to this page, because the season in review is the same kind of page: a recap of results.

## Context
- `/seasons/<year>` held, for each organization, the top five by rating, two team leaders' lists and links to the weeks. A fan
  who wants "how did the year go" had to add the weeks up by hand: who won the State Championship, who went unbeaten, which
  result nobody saw coming, which teams climbed.
- Every ingredient was already computed for the week recap (ADR 0092), the records page and the ratings: the week-before
  projection per game, runs of wins, a team's earlier State Championships, each team's rating at every week's end.

## Decision
Each organization's section on a season page gains a "Season in review" ("Season in review, so far" for the season under
way). Everything is counted from the data (`lib/season-review.ts`, pure and tested on invented teams; `lib/season-review-load.ts`
gathers the inputs); no sentence is written, and a fact the data cannot support is left out. Every line links to its game
or its program page.
- **State Champions**, with their scores: UIL's from its archive (plus any recorded final it lacks, ADR 0083), a private league's
  from its recorded finals. The score links to the game when the results hold it. A season with none recorded says so; the
  season under way names a champion only once the State Championship is recorded, never before.
- **Unbeaten teams and best records**: how many teams are unbeaten (a tie is not a loss), then the five best records by share of
  games won (a tie counts half), each team with at least six games; every team tied with the fifth is kept, to ten. A forfeit is a
  win or a loss in a record (ADR 0013). A team with a disputed final is not called unbeaten and is not listed.
- **Biggest upsets**: the ten results where the team the ratings gave the lower chance to win won, lowest chance first, with
  how many such games the season had. Same projection as the week recap (the ratings at the end of the week before, once both
  teams had four rated games). Any game with a team of the organization counts; a game between two organizations is under both.
- **Closest playoff games**: playoff games of the organization's bracket decided by one score or less (eight points or fewer),
  closest first, a State Championship game first on a tie. A forfeit, a disputed final and an unplayed game are left out.
- **Longest winning streaks**: runs of five or more wins in a row inside the season, each team's longest, five shown plus
  every team tied with the fifth, to ten. A tie, a loss and a disputed final end a run. A run that reaches the team's last
  game says so ("the run is still going" in the season under way).
- **Highest rated and biggest risers**: the organization's top team by rating (ranked teams only, ADR 0012) and the five
  teams whose rating rose most from the end of week 4 to the end of the season (so far). A team needs three rated games at
  week 4 and four at the end: at week 4 most teams have played three or four games, and a rating on fewer is mostly last
  season's.
- **Firsts**: a team's first playoff win and first State Championship game in the data held here (the same rule as the week
  recap, over the whole season; the oldest season held claims no first it cannot check). Twelve are listed, State Championship
  games first, with a count of the rest. A team's first loss of the season stays the week recap's.
- **Totals**: the organization's games, forfeits, and the average margin of the games played (a forfeit's recorded 1-0 or 2-0
  and a 0-0 are no score and never enter a margin).
- **Words.** A confirmed final may name who won ("Final: X by 3", "Won 9 games in a row"); no row says "winner", "leading" or
  "ahead". Records are written out, never "1-0". No betting word.
- The page's old lines "Scores are not confirmed here" are replaced with ADR 0040's "Scores may be corrected if a mistake is found."

## Consequences
- No new data, request or client JavaScript: the page stays static. The review reads the season's results, ratings,
  projections and playoff files once per build worker, shared with the week and records pages.
- `lib/week-review-load.ts` exports four of its loaders (`disputedIds`, `sequencesThrough`, `playoffHistory`, `weekMilestones`) so
  the season's firsts use the week recap's own rules.
- Tests: `scripts/season-review.test.mjs` (pure rules, invented teams); `e2e/seasons.spec.ts` checks a past season's sections
  against the loader, one organization at a time, and that the season under way says "so far" and shows a champion only where
  one is recorded. Its winner-word guard now matches the week recap's (ADR 0092), since a confirmed final names its winner.
