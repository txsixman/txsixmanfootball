# ADR 0091: Rankings that tell the season: movement on every row, the biggest movers, and a rank-and-rating chart

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0012 (ranks count one
organization), ADR 0080 (phone speed) and ADR 0081 (accessibility). It changes what pages show, not how any rating is made.

## Context
- The ratings table already stores the season week by week: `weeks`, and for every team `trend` (its rating through each
  Sunday) and `rated_trend` (its rated games then), written by `run.py --season`, which rates the season's games up to each
  Sunday. So nothing had to be computed in the ratings run or at build time from the backtest's walk-forward; the cheaper
  option was already on disk, and this ADR adds no ratings field and re-rates nothing.
- What fans could already see: a ▲ or ▼ and a number beside a rank that moved by more than 4 rating points, nothing for a team
  that held still (so "steady" and "no data" looked the same), a rank-by-week line and a rating-by-week chart on a program's
  page (two figures; the rating one drawn by Observable Plot and linkedom at build time), and nothing on a season page. The
  rank line counted every rated team, including those with fewer than 4 rated games, so a week's rank on the chart could
  differ from the same week's rankings page.

## Decision
- **Movement on every ranked row, as an icon and words.** Once a table carries week-earlier ratings, each ranked team shows
  one of: ▲ and the places gained, ▼ and the places lost, NEW (not ranked a week ago), or a dash for steady. Each has a
  screen-reader phrase ("up 3 since last week", "steady since last week", "New in the rankings this week"); colour is never
  the only signal. The rule is unchanged (`lib/ratings.ts` `movement`, which the weekly email shares: a move counts only when
  the rating moved by more than 4 points), so a dash means "steady", not "rank unchanged".
- **Biggest movers.** `/rankings` (and each organization or division view, and each week page) opens with up to three risers
  and three fallers, each "Up 7" or "Down 4" with an icon, the team's place now and a week ago and its rating change, linked
  to its program. It is built from the same moves as the table's marks, so the two cannot disagree. It does not appear when
  no team moved, in a past season, or in week 1.
- **One chart, rank and rating by week.** A program page (the season under way) and every program-season page
  (`/programs/<slug>/<season>`, 2021 on) draw one static inline SVG with two panels, rank (1 at the top) over rating, from
  `lib/rank-history.ts` and `app/programs/history-chart.tsx`. No chart library and no client code. Its text alternative is the
  image's label, the same sentence under it, and a table of week, rank and rating for screen readers. A week with fewer than 4
  rated games has a rating and no rank (a gap in the rank line, "Not ranked" in the table). Past seasons place teams by
  today's alignments, as the rankings pages do, and the chart says so. It replaces the old two figures
  (`trend.tsx`, `rating-chart.tsx`): the section is "<season> rank and rating by week".
- **Ranks in the chart are the table's.** A week's rank counts the teams of the organization with 4 or more rated games that
  week, best rating first and ties in the file's order, exactly as the table counts; a test checks every team of 2025 and 2026:
  the last week's chart rank equals its rankings rank.
- **Observable Plot and linkedom stay** (the scorecard on `/rankings/how` still uses them); only the program chart is off them.

## Page weight (ADR 0080's budget)
- The chart is 5.6 KB of HTML (about 0.9 KB brotli), measured on a real 10-week team by rendering the component to static
  markup. It replaces two figures (a rank line and a Plot chart, each with its own table and caption), so a program page does not get
  heavier. A season page gains this one figure; it ships no script.
- The movers list is six short rows (about 3 KB of HTML) on pages whose HTML is already large; each mark in the table adds one
  dash for a steady team (about 150 bytes of HTML a row). No new request, script, font or image, and nothing that loads after the page,
  so layout shift stays 0.000. Lighthouse's numbers in CI are the check.

## Consequences
- A steady team now shows a dash where it showed nothing. A table with no week-earlier ratings (a past season, week 1, the
  invented sample) shows no marks at all.
- A rank on a past program-season chart is among the season's final-table teams as today's alignments place them, as before.
- The email digest's own movement code is untouched; it and the site still agree (a parity test covers it).
