# ADR 0023: A school can put its scoreboard on its own site, in an iframe

**Status:** Proposed Nov 13, 2026, for backlinks and school sites; accepted when its pull request is merged. Adds one rule
to the site's headers: framing was refused on every route; it is now allowed on `/embed/...` and nowhere else. Every other
rule of ADRs 0004, 0009, 0010 and 0013 stands for the embed as for any page.

## Context
A school or booster site wants its team's scores without copying them by hand. An iframe is the one thing every site
builder accepts, and each one carries a link back to the program page (the site's backlinks). Until now no page could be
framed: every response sent `X-Frame-Options: DENY`.

## Decision
- **`/embed/programs/<slug>`, one for every program that has a program page.** A small page: the crest, this season's
  record (the program page's figure, ADR 0013), the last three results, the next game, and the link "Full schedule on TX
  Six-Man Football" to the program page (an absolute address, `target="_blank" rel="noopener"`). Scores read as on the
  program page: they say they are not confirmed here, no row names a winner, and a forfeit shows the word, never 1-0 or
  2-0. It reuses the program page's own rows (`lib/program-games.ts`) and crest rules (`app/programs/crest.tsx`, ADR
  0022: the 96px-high WebP copy, a badge for a removed logo). It has no fan features, cookies, analytics or links to any
  other page, and its words are the site's: rating, projected margin, win probability.
- **A static route handler, not a page.** `app/embed/programs/[slug]/route.ts` (`force-static`, built with the site)
  returns one complete HTML document with its CSS inline. A page would carry the layout's analytics and the framework's
  client script; the handler carries neither, and sets its own response headers. Every interpolated value is escaped
  (`lib/embed-html.ts`).
- **Theme:** the page follows the device's light or dark setting. `?theme=light`, `?theme=dark` or `?theme=auto` forces
  one; a tiny inline script reads the address, accepts only those three words and ignores anything else. This is the
  only script.
- **Content-Security-Policy on the embed:** `default-src 'none'`; `script-src` is that one script's sha256 hash, computed
  from its text in code, so the policy cannot drift from the script; `style-src 'unsafe-inline'` (its own CSS);
  `img-src 'self'`; `base-uri 'none'`; `form-action 'none'`; `frame-ancestors *`. The page also carries
  `<meta name="robots" content="noindex">`.
- **Framing is allowed on `/embed/...` only.** In `next.config.ts` the shared headers (nosniff, referrer, permissions,
  `X-Robots-Tag`) stay on every route. `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` apply
  to every route except those under `/embed/`, by a negative-lookahead source, so a new route is refused framing unless
  it is under `/embed/`. The embed rule sets its own `X-Robots-Tag: noindex` on every address, the public one too (where the other
  pages are indexed), so the embed never competes with the program pages in search.
- **The page and its crest stay under 30 KB.** The crest is the 288x96 copy; an SVG logo larger than 20 KB (five of the
  eleven) is replaced by the badge in its colors rather than sent. A program with no logo already gets the badge.
- **The program page shows the iframe as text,** in a "Put this on your site" block: the snippet is escaped text in a
  `<pre><code>`, never an iframe, so the page itself loads no embed.

## Consequences
- Any site can frame the embed, so it can be put on a page that shows scores wrongly or beside content the school does not
  control. The embed shows only public facts the program page already shows, and its link back is the only way out.
- `frame-ancestors *` means a clickjacking attempt on the embed is possible; the embed has nothing to click except one
  link to this site, and no state, form or sign-in, so there is nothing to hijack.
- A visit to `/embed/...` sets no cookie, runs no analytics, and the service worker's pages are not involved: the embed
  registers nothing.
- Header values are set at the framework level and the CSP by the route; `e2e/embed.spec.ts` checks both per route, and
  that a page on another origin can frame the embed and cannot frame any other page.
- The iframe height in the snippet (`EMBED_HEIGHT`, 560) is a measured limit, the tallest of all 280 programs at phone width (548px, for the longest opponent names); the spec fails if any page is taller or heavier than 30 KB.
- The embed shows the season's data as of the last build, like every page; a school's iframe is as fresh as the site.
