# ADR 0045: "Chance to win" everywhere, and "Biggest surprises"

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It follows the plain-words audit (Nov 13) and
extends ADR 0044's wording rule from game rows to every page.

## Context
- ADR 0044 made game rows and game pages read "74% chance to win". The rest of the site still said "win probability":
  the footer, the terms, the home page's title chances, the ratings explainer and its scorecard, the Records page and the
  pages' descriptions. Two words for one number.
- The Records page called its list of the least likely wins "Biggest upsets", a word ADR 0044 took off game rows.

## Decision
1. **The site's words are rating, projected margin and chance to win.** "Win probability" is not shown on any page or in
   any page description. Code and the ratings service may still name the number `winProbability`; that is not shown.
2. **Records: "Biggest surprises"**, with the figure read as "chance to win before the game". The list, its order and
   what it counts are unchanged; its anchor is `#surprises`.
3. **No projection is removed.** Every game that shows a projection keeps it, under way and after (ADR 0044).

## Consequences
- CLAUDE.md's betting rule, the legal checklist and PROJECT_STATE use the same words.
- The unused `upset` field on a board game is removed (`lib/demo-games.ts`, `lib/live-scores.ts`).
- The footer is on every page, so the whole-page screenshot baselines are made again.
- /scores/tonight is changed separately, with the live board.
