# ADR 0081: A full accessibility sweep in CI, and a link's name holds the text it shows

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0035 (light and dark; the
contrast check).

## Context
- A site-wide check on Nov 16, 2026 ran every axe rule (WCAG 2.0 and 2.1 A and AA, plus best practices) on the live site
  at 375 px, in light and dark, on 27 pages (one of each kind). 23 had no finding at all.
- What it found: no critical finding; four pages with a **serious** one, the same in both themes, `label-content-name-mismatch`
  (WCAG 2.5.3, label in name): a game link set `aria-label` to words that were not the words it shows. `/results` (32 links:
  the label held the teams, the link shows only the two scores, drawn as two spans with no space between, which read
  as one number, "1371"); `/weeks/<season>/<week>` (95 links: the label said "A vs B, 13-71", the link shows each team
  beside its own score); `/series/<a>/<b>` (4 links: the label left out the round the row shows). One moderate one,
  `landmark-unique`, on `/`: two sections were both named "TAPPS" (the games to watch and the rankings).
- The contrast check (`e2e/theme.spec.ts`) and each page test's `checkPage` run only some rules, so none of these showed.
  Someone who speaks to their phone ("tap 13") could not name these links.

## Decision
- A link's accessible name **holds the text it shows, whole and in its order**, then adds what only a screen reader needs
  (", game page"). `/weeks`: "Dell City 13, Grandfalls-Royalty 71, game page" (a forfeit: "Dell City, Grandfalls-Royalty,
  forfeit, game page"); `/series`: the date, teams, round and score as drawn; `/results` keeps its label (the link shows
  only the scores) and a space between the two score spans, so the shown text is "13 71". Nothing visible changes.
- The home page's "Games to watch" blocks are named "UIL games to watch" and "TAPPS games to watch", so no two
  landmarks share a name; the heading still reads "UIL" and "TAPPS".
- `e2e/axe-sweep.spec.ts` runs the full rule set at 375 px in light and in dark on one page of each kind and fails on any
  serious or critical finding. Moderate and minor ones are reported only inside a failure, because a page's data can bring
  a new one that is not worth blocking a game-night fix.

## Consequences
- The sweep adds 2 page loads for each of 32 pages to the page tests (phone project only).
- A new link with its own `aria-label` must repeat the words it shows, in order; the sweep names the page when it does not.
