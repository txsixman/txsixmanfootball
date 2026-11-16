# ADR 0080: Phone speed, Nov 16, 2026

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It changes how pages load, not what any page says.

## Context
- Fans read the site on phones on weak rural signal, and the playoff nights (Nov 19 to 21) are the heaviest use. The pages
  were already fast by Lighthouse's phone settings (performance 97 to 100 in CI, largest paint 0.8 to 1.1 s), so the work
  looked for bytes and contention a score hides, not for a slow page.
- CI's Lighthouse run covered four pages. It now covers nine kinds (home, `/scores`, `/playoffs`, this round, a bracket, a
  game, a program, `/rankings`, `/results`) and prints JS, HTML and HTML-raw size beside its other numbers, also as check-run
  annotations (the run summary is not served by the API). Numbers below are its medians of 3 on one shared runner, before
  (commit 594bbf8) and after (797e954).
- Findings on the live site, read-only: the pages are edge-cached and static; every script, style and font is
  `immutable`; images are already tiered WebP crests. What was left:
  - **Background prefetch.** Each `<Link>` that shows prefetches its whole page. The nine section links in the header and
    footer did that on every page (about 115 KB: `/rankings` 29, `/scores` 18, `/programs` 17, `/search` 15, `/standings`
    14, `/playoffs` 10, `/results` 7), and the program links in lists added 13 to 21 KB each (this round and `/playoffs`
    prefetched four). Pages 125 to 229 KB of their 500 to 700 KB "weight" was this, loading while the fan read and
    while the crests were still arriving.
  - **The service worker's install** fetched every script and style the site has (36 files, 318 KB) right after the page
    hydrated, in the same minutes as the page's own images.
  - **Fonts:** Inter (48 KB) was found only after the stylesheet, a second round trip, and drew in a fallback of another
    size (layout shift 0.002 to 0.029 on every page).
  - **The error boundary** (`app/error.tsx`) is loaded on every page and imported the shadcn `Button`, which brings
    tailwind-merge, cva and Slot (about 31 KB of script, 10 KB sent) into every route.
  - **Logos** were cached for a day, so a fan returning the next day fetched every crest again.
- Why the HTML is big (this round 200 KB, `/rankings` 979 KB): about 60 percent of each page's HTML is the inline `self.__next_f`
  stream, which is the page's server-rendered element tree again as JSON (this round: 122 of 200 KB; 42 KB of the stream
  is `className` strings). It is not client props or a data blob (the bracket board's props are 13 KB). Brotli squeezes it about
  11 to 1, so it travels as 12 to 58 KB; the cost is the phone's parsing, which blocking time already measures (13 to 30 ms
  on the live site). Shrinking it means changing markup on every page, so it is not done here.

## Decision
- **Section links prefetch only `/scores` and `/playoffs`** (the two a fan opens again and again on a game night;
  `lib/prefetched-sections.ts`); the other section links in the header and footer load when tapped.
- **Program links in lists do not prefetch** (`prefetch={false}`, as the week, season, standings and rankings lists already
  did). Game links keep prefetching: they are 4 to 5 KB and the likeliest next tap.
- **The service worker registers after the page's `load` event and when the phone is idle** (up to 4 seconds), not on
  hydration. Offline pages are ready a few seconds later than before; nothing else about it changes.
- **Inter loads through `next/font/local`, as Barlow does:** preloaded from the `<head>` with a size-matched fallback, from the
  same latin file `@fontsource-variable/inter` ships. Letters outside that file (none in the site's data) take the system
  font, as before. Stories still load `@fontsource`.
- **The error boundary draws a plain `<button>`** with the Button component's classes, so it no longer pulls the class
  merger into every page.
- **Logos cache for a week** (`max-age=604800, stale-while-revalidate=86400`): the files are not hashed, so a changed logo
  reaches a phone within a week. A removal request still takes effect on the next deploy for anyone who has not cached it,
  and the service worker already kept logos for 30 days.
- **Budgets tightened** in `lighthouserc.cjs` to the new numbers plus headroom: performance 0.9, largest paint 1.6 s, blocking time
  350 ms, layout shift 0.03, weight 700 KB, scripts 260 KB and HTML 80 KB sent. 700 KB fails if the section links go back to
  prefetching everything.
- **Left alone on purpose:** HTML cache headers (`max-age=0, must-revalidate` with the CDN serving a stored copy), because
  game-night freshness is why; every page's text, data and links.

## Results (CI, median of 3; before -> after)
| Page | LCP ms | TBT ms | CLS | Weight KB | JS KB sent | HTML KB sent (raw) |
|---|---|---|---|---|---|---|
| / | 915 -> 917 | 122 -> 86 | 0.029 -> 0.000 | 621 -> 544 | 203 -> 203 | 16 (146) -> 16 (147) |
| /scores | 911 -> 910 | 170 -> 101 | 0.002 -> 0.000 | 710 -> 640 | 199 -> 204 | 31 (276) -> 31 (276) |
| /playoffs | 910 -> 908 | 90 -> 61 | 0.024 -> 0.000 | 704 -> 514 | 175 -> 197 | 21 (246) -> 21 (248) |
| /playoffs/this-round | 915 -> 913 | 144 -> 81 | 0.020 -> 0.000 | 653 -> 450 | 175 -> 187 | 18 (188) -> 19 (189) |
| /playoffs/bracket/uil-division-i | 913 -> 913 | 148 -> 100 | 0.004 -> 0.000 | 548 -> 483 | 201 -> 213 | 30 (327) -> 30 (329) |
| a game page | 767 -> 762 | 104 -> 71 | 0.007 -> 0.000 | 565 -> 419 | 203 -> 204 | 12 (61) -> 12 (61) |
| /programs/jayton | 914 -> 911 | 157 -> 84 | 0.014 -> 0.000 | 614 -> 542 | 195 -> 212 | 42 (404) -> 42 (407) |
| /rankings | 1062 -> 1061 | 192 -> 162 | 0.003 -> 0.000 | 645 -> 570 | 188 -> 189 | 57 (949) -> 57 (949) |
| /results | 916 -> 912 | 159 -> 96 | 0.002 -> 0.000 | 624 -> 639 | 162 -> 180 | 17 (185) -> 17 (187) |

Largest paint did not move (the page's heading was never waiting on any of this). Layout shift went to 0.000 on every page,
blocking time fell 16 to 47 percent, and weight fell 65 to 203 KB on eight of nine pages (`/results` rose 15 KB, see below). Script KB reads higher on some
pages because the later service worker no longer serves the page's late scripts out of its install-time copy; the set of
scripts a page needs is the same.

## Consequences
- Tapping a section other than Scores or Playoffs, or a school in a list, waits for that page instead of finding it loaded
  already: one request to a CDN-stored page of 7 to 30 KB.
- The offline copy of the site is ready seconds later than before.
- A new tall list of links should say `prefetch={false}`; the weight budget will say so if it does not.
