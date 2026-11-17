# ADR 0098: What the quality sweep decided: empty pages are not indexed, a text field has a visible edge

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0081 (accessibility sweep) and to
the Getting-found rules (sitemap, canonical links, noindex).

## Context
- A sweep of the live site (589 pages sampled across every kind of page, 8,436 distinct internal links on them, all answering 200;
  every sampled page had one title, one description, one canonical equal to its own address, one h1 and no noindex) found
  few faults. Those it did find were decisions about what a page owes a visitor and a search engine, not typos.
- A results week in which an organization played no game (UIL's week 1, TAIAO's week 15) is a real page, because the week
  tabs lead to it. It was also listed in the sitemap, indexable, and put in the site search with the excerpt "No games this
  week": about 6 in 100 of the results addresses the sitemap offered. Thin pages like it are what search engines treat as soft errors.
- A text field (the search box, a score report, a sign-in, a post) was drawn with the `line` color, a 1.5:1 hairline in light
  and 1.9:1 in dark. WCAG 1.4.11 asks 3:1 for the edge of a control when nothing else shows where it is.

## Decision
1. A results week with no game stays a page, answers 200 and keeps its links, but says `noindex, follow`, is not in the sitemap
   and is not in the site search. It names the nearest week that has games, so it is never a dead end. A week with games is
   indexed as before. (`app/results/[[...path]]/page.tsx`, `app/sitemaps/lists.ts`, `e2e/sitemap.spec.ts`.)
2. A text field's edge is its own token, `field` (`#6b7790` light, `#7a8aae` dark: 4.2:1 to 5.3:1 on the page and the panel), and
   shadcn's `input` token points at it. `line` stays what it was, a divider. `scripts/theme-tokens.test.mjs` computes the ratios.
3. Nothing animates for a visitor who asked for reduced motion: one rule in `globals.css` ends every transition and animation
   at once and turns off smooth scrolling (the site has few; this keeps a later one from slipping in).
4. The 404 page reads the address: for a school, game or series address it offers the search with those words already typed
   (the search then names the closest school) and the Programs list. Plain links, drawn on the server, nothing moves after load.
5. A league's playoffs page with no bracket yet says so in a panel instead of showing only its header.
6. Typed internal links are checked against the app's own routes in CI (`scripts/internal-links.test.mjs`: the folders of `app/`,
   `public/`, the redirects in `next.config.ts`; no server). Links built from data stay with the e2e specs and the live crawl.

## Consequences
- The sitemap is a little smaller and every address in it has something to show. A week that later gains a game becomes
  indexable on the next build, which the data commits already trigger.
- Fields look firmer next to hairline-ruled tables; the screenshots of pages with a field may need new baselines.
- Left alone: `/playoffs` draws "Current round" as an h3 straight after the h1 (a skipped level); tests for the bracket pages
  read the page's h2s, so it moves with them.
