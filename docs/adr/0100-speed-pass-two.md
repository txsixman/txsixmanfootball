# ADR 0100: Phone speed, second pass, Nov 17, 2026

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It changes what a page loads and when, not what any page says or how it looks.

## Context
- ADR 0080 (Nov 16) took the background prefetch, the service worker's install, the font and the error boundary out of the way. This pass
  starts from the live site again (read-only, Nov 17, 06:00 UTC, `curl` with `accept-encoding: br`, then each page's data stream decoded)
  and looks for what a fan on one bar of signal still downloads.
- **What the live site sends today** (HTML as Vercel compresses it; "page data" is the `self.__next_f` stream inside that HTML, which is the
  page's element tree and its client components' props once more; "client nav" is the data Next fetches when a link to the page is
  followed or prefetched). Ranked by bytes sent:

| Page | HTML sent KB | HTML raw KB | page data raw KB | client nav sent KB | scripts sent KB (modern browser) |
|---|---|---|---|---|---|
| /rankings | 59.2 | 1053 | 631 | 33.0 | 149 |
| /programs/jayton | 41.1 | 446 | 273 | 24.2 | 171 |
| /programs | 32.2 | 370 | 161 | 20.6 | 152 |
| /playoffs/bracket/uil-division-i | 31.6 | 426 | 177 | 15.9 | 171 |
| /scores | 29.5 | 303 | 170 | 20.9 | 160 |
| /standings | 27.0 | 617 | 376 | 16.6 | 150 |
| /playoffs | 22.5 | 352 | 215 | 14.2 | 151 |
| / | 19.7 | 254 | 153 | 12.2 | 160 |
| /weeks/2026/13 | 19.3 | 240 | 146 | 12.0 | 149 |
| /search | 18.1 | 89 | 76 | 15.2 | 166 |
| /playoffs/this-round | 18.0 | 217 | 131 | 11.5 | 151 |
| /results/2026/13 | 16.4 | 202 | 118 | 9.9 | 149 |
| a game page | 11.7 | 59 | 34 | 7.1 | 176 |
| /welcome | 9.1 | 51 | 30 | 6.1 | 149 |
| /scores/tonight | 6.2 | 30 | 18 | 4.1 | 154 |

  Every page also loads one 10.6 KB stylesheet, three preloaded fonts and the crests above the fold; about 15 requests before the first
  crest. (`/weeks/<n>` and `/results/<n>` pages are the latest week, 13.)
- Findings:
  - **Scripts are the larger half of every page except `/rankings`**: 149 to 176 KB sent, of which about 120 KB is React and Next's own
    client and cannot change. The rest, per page: a 10 KB chunk that was only `tailwind-merge` (shipped on every program, game, bracket and
    search page, through the Follow, Share, Comments and Search buttons and fields); the header's account link with Vercel Analytics and
    Speed Insights (8 KB, in the first scripts of every page); and, on the home page only, the whole "My teams" section with its push
    switch and live-score code (11 KB), for the few visitors who follow a team.
  - **The scores board's props.** `/scores` is a client component fed every game and every crest: 134 KB of its 149 KB page data. Of that,
    77 KB was 119 games, each carrying fields the board never reads (a team's mascot, initials and color; a game's site, street address,
    projected margin, stream, quarters; every key that was only `undefined`, sent as the text `$undefined`), and 53 KB was 153 crests
    carrying four copies of each logo's path where a 24 px crest draws one.
  - **Prefetch down a scrolled list.** ADR 0080 kept prefetch on game links as "4 to 5 KB and the likeliest next tap". That is true for the
    handful on screen, not for a list: Next prefetches each link as it scrolls into view, and a page's data is 4 to 24 KB (table above).
    `/programs/jayton` has 119 game links, a bracket page 64, `/scores` 47, `/results` 32; the bracket links on `/playoffs` are 16 KB each, and the year
    links on `/championships` (55) and `/seasons` 6 to 10 KB. A fan who scrolls a program page to the bottom can fetch several hundred KB
    in the background (119 game links at about 7 KB), on the signal the page was already struggling with.
  - **Not changed, and why:** the 40 to 60 percent of each long page's HTML that is Tailwind class text (`/rankings`: 241 KB of its 414 KB of
    markup, again in the page data) compresses 11 to 1 and costs parse time, not signal; the four columns `/rankings` hides on a phone
    (best win and worst loss, about 150 KB raw, 7 KB brotli) cannot move after load without shifting the desktop layout; the bracket page
    draws the tree, the round cards and the list of games, so each game's link is in the HTML three times (all three are the same
    games, and the list is the keyboard path past the drawing, ADR 0094); `/search`'s 54 KB data is the search index itself (ADR 0090).

## Decision
- **`tailwind-merge` is dropped** (package and lockfile). `Button`, `Input` and `Label` append a class name as given; the three places that
  relied on the merge say what they mean as a prop or variant: `Button` `wrap` (a follow button for a long school name may wrap),
  `Button` `variant="danger"` (the delete-account button), `Input` `accent` (the search field's tint). Nothing looks different.
- **Vercel Analytics and Speed Insights load once the page has loaded and the phone is idle** (up to 4 seconds, as the service worker does,
  `app/vercel-insights.tsx`). They read the browser's own timeline, so the load times they report are the same; a visit that leaves in the
  first second or two is not counted as a page view.
- **"My teams" on the home page splits in two:** the small gate that asks which programs this browser follows stays; the section (alerts
  switch, live scores, crests, the saved-tonight notice, `app/my-teams/view.tsx`) is its own chunk, fetched only when there is a program to
  show. Nobody who follows no team downloads it.
- **The scores board is sent what it draws** (`lib/board-wire.ts`, used by `/scores`, `/scores/sample` and the stories): a team's name, record
  and rank; a game without its site, address, margin, stream, quarters or empty keys; a crest as its tiny logo, its shape and its colors.
  The HTML and what the board draws are unchanged (checked by rendering the board to a string both ways: 120,065 bytes, 65 images each).
- **Game links in a list do not prefetch:** the program page's schedule and rating-moves lists, the bracket's boxes and round cards, the scores
  board, `/results`, the series page, the game page's other meetings; the bracket links on `/playoffs` and the this-round page; the year links on
  `/championships` and `/seasons`. Kept: the home page's games, tonight's board and the header's `/scores` and `/playoffs`, the lists a fan taps
  from straight away.
- **Locked in** by `scripts/speed.test.mjs` (CI's `node --test`): the board's bytes per game (470) and per crest (190) on the real season, no
  field the board never reads, a table of the links above that must say `prefetch={false}` (and fails when the code moves), no
  `tailwind-merge` in the package or the source, no Vercel import in the layout, and no static import of the push or live-score code in
  `my-teams/block.tsx`. **Lighthouse budgets** tightened: weight 700 to 660 KB, scripts 260 to 240 KB, HTML 80 to 70 KB sent.

## Results (CI's Lighthouse, mobile settings, median of 3; main at 38459ed (run 44029108975) -> this branch (run 44031187956), the same pages minutes apart)
| Page | Weight KB | Scripts KB sent | HTML KB sent (raw) |
|---|---|---|---|
| / | 563 -> 528 | 221 -> 193 | 22 (245) -> 22 (246) |
| /rankings | 573 -> 549 | 201 -> 183 | 60 (1021) -> 60 (1021) |
| /scores | 673 -> 568 | 219 -> 183 | 31 (295) -> 24 (230) |
| /playoffs | 553 -> 481 | 212 -> 182 | 24 (333) -> 24 (333) |
| /playoffs/this-round | 474 -> 450 | 199 -> 182 | 19 (205) -> 19 (205) |
| /playoffs/bracket/uil-division-i | 438 -> 411 | 212 -> 196 | 34 (409) -> 34 (409) |
| a game page | 437 -> 415 | 219 -> 203 | 13 (63) -> 13 (63) |
| /programs/jayton | 565 -> 540 | 236 -> 217 | 44 (432) -> 44 (434) |
| /results | 677 -> 616 | 208 -> 183 | 18 (195) -> 18 (196) |
| /search | 404 -> 380 | 199 -> 182 | 17 (86) -> 17 (86) |
| /welcome | 420 -> 397 | 209 -> 191 | 10 (49) -> 10 (49) |

- Weight fell 24 to 105 KB on every page and scripts 16 to 36 KB. `/scores` also lost 7 KB of HTML sent and 65 KB of raw page data (the
  board's games and crests, 131 KB to 74 KB by the test's own count). Pages with long lists show the prefetch change only as a fan scrolls, which
  Lighthouse does not do, so its numbers do not show it: the test does.
- Not claimed: blocking time and largest paint. Both are within the runner's noise from one run to the next (ADR 0080 saw 53 to 112 ms on one
  page between two runs; here `/rankings` read 168 and 244 ms between main's run and this one), and the pages' largest element was never
  waiting on any of this. Analytics and Speed Insights are built in only on Vercel, so CI cannot see their 8 KB move later.
- `/scores` fails the CLS budget (0.547) in this run, as it does on main at 38459ed (the offline-copy change, ADR 0096); it is not this change
  (the HTML the board renders is identical, above) and its fix is separate.

## Consequences
- Tapping a game from a long list, or a bracket or year from `/playoffs`, `/championships` and `/seasons`, waits one request to a CDN-stored page of
  4 to 16 KB, as a section link already does (ADR 0080). A fan who scrolls a long list and taps nothing downloads none of them.
- A fan who follows no team no longer downloads the "My teams" code; one who does gets the section a moment later than before (its team
  files were already fetched after load).
- Page views and load times are reported from the moment the page is idle, not from its first script.
- New client code must not import `Button`'s old merge behaviour: a class that must beat one of the button's is a variant, not an override.
- Left for another pass, in order of bytes: the phone's hidden `/rankings` columns, the bracket's three copies of its games, and Tailwind
  class text in the repeated rows (`.pg` in `globals.css` did this for the program page's past seasons).
