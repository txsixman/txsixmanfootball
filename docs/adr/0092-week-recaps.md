# ADR 0092: A week's review is a recap: upsets, biggest wins, closest games, streaks and milestones, counted from the data

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0012 (one organization at a time),
ADR 0013 (records from the results), ADR 0040 (a final is confirmed), ADR 0044 (the projection beside the outcome) and
ADR 0083 (one list of State Championships). It amends ADR 0044's "no upset label": the word "upset" is allowed on the week's
recap (and the home page's card) because the owner's round 11 brief asked for it. No betting word is added.

## Context
- `/weeks/<season>/<week>[/<org>]` already held rating movers, the results furthest from the projection, five closest games
  and five biggest margins, playoff advancement and every game. It named no winner (ADR 0004), a rule ADR 0040 then lifted for
  every confirmed final, so the page could say what a fan wants to read on a Monday: who got upset, who won big, who was
  close, whose run ended and which team did something for the first time.
- Every ingredient was already computed somewhere else: the week-before projection per game (`lib/pregame.ts`), runs
  across seasons (`lib/records.ts`), a team's earlier State Championships (`lib/title-history.ts`), a game's playoff round
  (`lib/games.ts`).

## Decision
Five sections are added or reworked on each organization's week page. Each is counted from the data; none is written, no
sentence is generated, and a fact the data lacks is left out. Every line links to its game, and a team name links to its program.
- **Upsets.** A game the team the ratings gave the lower chance to win won, from the ratings at the end of the week before (the
  same projection every game page shows, so both teams had four rated games). The row shows the chance in plain words ("Kress
  had a 23% chance to win. Final: Kress by 2."), lowest chance first, the first eight with a count of the rest. A chance that rounds to a half is not an
  upset. With no game projected the section says so rather than saying there was no upset.
- **Biggest wins** (replaces "Biggest margins"): the five wins by the most points, each as "Final: Oglesby by 52".
- **Closest games**: only games decided by one score or less, eight points or fewer (a touchdown and a two-point conversion),
  a tie counting; closest first. The five closest whatever the margin are gone, so a week with no close game says so.
- **Streaks**: for the organization's own teams, a run of five or more games in a row (wins or losses) that ended this week,
  and a winning run that reached five, ten, fifteen and on (the point at which a run "starts" to be notable). A tie ends a run,
  and so does a read season with none of the team's games, the rule `/records` uses; a run ending on a disputed final is not
  claimed. Runs are joined across seasons. Hidden when empty.
- **Milestones**, hidden when empty, for the organization's own teams: a **first playoff win** (a team's earliest win in
  any playoff game of any league held; a renamed school counts under the name it became, ADR 0072; an earlier forfeit win
  counts as a win, so a team is never called a first-timer when the data holds one; the oldest season held claims none, as it
  has nothing earlier to compare with); a **first State Championship game** (neither team has an earlier one in its league's list: UIL's
  archive since 1972 with any recorded final, a private league's recorded finals since 2018, which the oldest season
  held cannot claim); and an unbeaten team's **first loss of the season** (at least four games with no loss or tie before it; a
  forfeit loss is not claimed). The section note says the data starts in 2018 (UIL's State Championship games in 1972).
- **Rankings.** The weekly ratings do hold each team's rating at every week end, and the page already shows the biggest rises
  and drops with the rank now and the places moved (ADR 0012: ranks count one organization's teams). That section stays as it
  is, named "Rating movers"; this change does not duplicate it, and weekly movement on the Rankings pages is another change.
- **A disputed final** (ADR 0040) names no winner, so it is never an upset, a big win, a close game, a streak or a milestone.
  A forfeit and a 0-0 are not games for any of these.
- **Words.** "Final: X by N", "had a N% chance to win", "streak of N games ended", "has now won N games in a row". Never "winner"
  or "leading" or "ahead" (the words of a game under way; every game here is a final), and never a betting word. Records are
  written out, never "1-0".
- **The home page's week card**: under the Week in review button, the newest UIL week's top upset (lowest chance) and its
  closest game, each a link to its game with its score. A fact the data lacks is left out; the card is UIL's and says so (ADR 0012),
  as the button already was.
- The weeks' meta descriptions, the season hub's line about the weeks and the weeks' share card name the new sections.

## Consequences
- No new data, table, request or client JavaScript: every page stays static. A week page reads each season's results once
  per build worker (shared with the records page) and the playoff files of every season once (shared with the State
  Championship pages); the whole site's 581 week pages compute in about a second.
- `biggestMargins` is removed from `lib/week-review.ts` (its unit test with it); `lib/week-recap.ts` holds the new rules, tested
  on invented teams (`scripts/week-recap.test.mjs`), and `e2e/week-in-review.spec.ts` checks the sections, the home card and that
  a disputed final is in none of them.
- A streak "reaches" five, ten and so on; a team that wins its sixth in a row is not listed. That keeps the list to the weeks'
  news instead of every team on a run.
