# ADR 0107: Midweek, the scoreboard's sections appear whole

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. Completes ADR 0103; changes no order and no content.

## Context
- ADR 0103 set the midweek order (this week's games before last week's finals) before the page's own script runs: an inline
  script sets `data-upcoming-first` on `<html>` and CSS `order` moves "Later" and "Next games" up. The HTML keeps finals first.
- CI's Lighthouse still failed `/scores` on Nov 17 from about 12:00 UTC: layout shift 0, 0.52 and 0.155 in its three runs. The
  reports (downloaded this time) name the moved element: the finals block (`div.order-3`), pushed down. The failing runs painted
  first at 180 ms, before the HTML had finished arriving (DOMContentLoaded at about 300 ms); the clean run painted after it.
- So the order was right, but not all of it was there yet: a phone paints a long page as it arrives. The finals, early in the
  HTML, were painted at the top; "Later", last in the HTML, arrived next and was placed above them by `order`. Fans on a slow
  signal see the same jump. A test that loads the page quickly cannot see it; Lighthouse's throttled runs can.

## Decision
- The board's sections share one container, `.board-sections`, whose last child is an empty end mark (`<i hidden data-board-end>`).
- One CSS rule in `globals.css`: `[data-upcoming-first] .board-sections:not(:has(> [data-board-end]))` is `visibility: hidden`.
  Midweek, the sections stay hidden until the end mark has been parsed, then appear at once in the right order. Hidden boxes
  are not counted as layout shift, and showing them moves nothing. On the other days (finals first), the HTML order is the
  order on screen, and nothing is hidden.
- No script: it works before and without the page's JavaScript. A browser without `:has()` ignores the rule and behaves as
  before.
- Rejected: building `/scores` at request time (ISR) so its HTML has the right order. Every page is static by design, and
  playoff week is the wrong time to change how the busiest page is served. Rejected: Chrome's render-blocking `<link
  rel="expect">`, which most phones here (Safari) do not support.

## Consequences
- Midweek, the sections paint a few milliseconds later than the header on a slow signal, and all at once.
- `scripts/upcoming-first.test.mjs` pins the rule and the end mark's place; CI's Lighthouse `/scores` run is the test of the
  effect, and `e2e/scores-layout-shift.spec.ts` now names any element that moves.
