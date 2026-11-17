# ADR 0105: Phone speed, third pass: the heaviest pages, Nov 17, 2026

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It changes how much markup a long page sends, not what any
page says, shows or reads aloud.

## Context
- ADR 0080 and ADR 0100 took the scripts, the prefetch and the scores board's props out of the way. ADR 0100's last section left three
  things: the phone's hidden `/rankings` columns, the bracket's three copies of its games, and Tailwind class text in repeated rows.
  This pass measures the live site again (Nov 17, 06:00 UTC, `curl` with `accept-encoding: br`, a phone user agent) and cuts what can
  be cut without a reader noticing.
- **How a page's bytes are counted.** "HTML sent" is what Vercel sends. It is brotli at quality 3: the saved live HTML recompressed that way matches what Vercel sent within 2 bytes on `/seasons/2025` (36,318 B live, 36,316 B), the program page (41,334, 41,332) and the bracket (31,635, 31,634), and within 1 percent on `/rankings` (59,325, 58,799),
  so every "sent" number here, before and after,
  is the HTML recompressed that way. "HTML raw" is the HTML as the browser parses it; "page data" is the `self.__next_f` stream inside it.
- **Where the bytes are.** None of the heavy pages hands a large prop to a client component (that was the scores board, ADR 0100):
  `/seasons/2025`, `/leaders`, `/rankings`, `/standings`, `/championships` and the program page are pure server rendering. Their page
  data is the element tree again, as JSON: every `span` is `["$","span",null,{"className":"...","children":...}]`, every crest two
  nested ones with a style object, and Next adds `"style":"$undefined"` for a prop that was only `undefined`. That is 55 to 60 percent of
  what `/rankings` sends (28.0 KB of HTML, then 30.7 KB more for the data), 45 percent of `/seasons/2025`. It cannot be dropped (React
  needs it to hydrate and to navigate), only made smaller.
  - Class text is half of the raw markup (`/rankings`: 209 KB of 414 KB of HTML) and again in the data. Taking every class off the saved
    pages would save 15 to 19 percent of the bytes sent, so that is the ceiling of this pass; Vercel's low compression level does not
    squeeze it as hard as a quality-11 one would.
  - The `/rankings` columns a phone hides (record strength, opponents' rating, best win, worst loss) cost about 22 KB of the 59 KB sent
    (10.7 KB in the HTML, about as much in the data): the biggest single item. They are in the table so the desktop layout is whatever
    the browser lays out from them: the Team column's width comes from the content of the best win and worst loss columns, which are
    `auto`. Filling them in after load moves the desktop table; fixed widths change how it looks. Neither is "unchanged", so they stay.
  - The bracket page's tree, round cards and "Who's left" are one client component rendered to HTML (4.3, 3.9 and 1.9 KB sent) and
    sent as data once (3.0 KB); the games list below is the keyboard path past the drawing (ADR 0094) and is server markup (HTML and data).
    Which view shows depends on the width, so the server cannot send only one. No copy was removed.
- Before and after, measured the same way on CI's builds, are in Results.

## Decision
- **Repeated markup is named once.** `app/globals.css` gets 63 `@utility` names under "Repeated markup": the crest (`crest-slot`,
  `crest-box`, `crest-badge`, `crest-img`), the board row (`brd-row`, `brd-place`, `brd-body`, `brd-fig`), the rankings, standings,
  leaders, championships, season, program finder and bracket rows (`rk-*`, `st-*`, `ch-*`, `lead-link`, `ink-link*`, `bx-*`, `gl-*`) and
  the header and footer links (`hdr-link`). Each is the **same utilities** the element had, through `@apply`, and nothing else: they
  were checked one by one against Tailwind's own output for the two spellings (same declarations, same selectors and media), 63 of 63.
  The class text on an element is now 5 to 20 characters instead of 40 to 145, in the HTML and again in the page data.
- **A crest slot at its usual size sends no `style` prop** (`CrestSlot`): `style={undefined}` still travels as `"style":"$undefined"`.
- **The scores board and tonight's board are left as they were.** Their first-paint order is ADR 0103's and `e2e/scores.spec.ts` reads
  their classes; `scripts/speed.test.mjs` leaves `app/scores/` out of the "no spelled-out list" rule.
- **Three e2e specs located elements by class text that is now a name** (`span.line-clamp-3`, `span.font-num.text-navy`,
  `span.font-num.tabular-nums`); they use the names (`.rk-team`, `.brd-fig`, `.gl-score`) and select the same elements.
- **Locked in** two ways. `scripts/speed.test.mjs` (CI's `node --test`): at least 60 named styles, each used by some component, and no
  component outside `app/scores/` spells out a named list again beside its name. `e2e/page-bytes.spec.ts` (CI's page tests, on the
  production build): ten heavy pages (`/`, `/scores`, `/rankings`, a bracket, `/seasons/2025`, `/leaders`, a series page, a program page,
  `/standings`, `/championships`) each stay under a raw-HTML budget and a sent budget (quality-3 brotli), set at the measured size with
  4 to 8 percent of room for a game night's new rows. Lighthouse's `resource-summary:document:size` stays at 70 KB sent.

## Results
Both columns are the same measure (`e2e/page-bytes.spec.ts`, the HTML the production build serves, recompressed at quality 3), taken on
CI's build of `main` at b40a906 (a throwaway pull request, run 44073125028) and of this branch (run 44070319214), minutes apart on the same
data. The live-site numbers in Context (measured with `curl`) differ from the build's by a few percent, as `/scores` shows (231.6 live,
231.2 built); the build pair is the fair comparison.

| Page | HTML raw KB | HTML sent KB (quality-3 brotli) |
|---|---|---|
| / | 246.1 -> 219.7 (-11%) | 19.3 -> 18.8 (-3%) |
| /scores (not touched) | 231.2 -> 220.8 (-4%) | 21.7 -> 21.8 (+0%) |
| /rankings | 1021.8 -> 707.5 (-31%) | 57.4 -> 54.3 (-5%) |
| /playoffs/bracket/uil-division-i | 409.7 -> 326.7 (-20%) | 30.4 -> 29.4 (-3%) |
| /seasons/2025 | 614.7 -> 487.8 (-21%) | 35.1 -> 33.0 (-6%) |
| /leaders | 231.1 -> 163.4 (-29%) | 14.0 -> 13.3 (-5%) |
| /series/aspermont/jayton | 63.0 -> 59.7 (-5%) | 9.7 -> 9.5 (-2%) |
| /programs/jayton | 434.3 -> 397.1 (-9%) | 40.1 -> 39.7 (-1%) |
| /standings | 599.2 -> 438.2 (-27%) | 25.5 -> 24.2 (-5%) |
| /championships | 512.4 -> 372.0 (-27%) | 24.4 -> 23.2 (-5%) |

- Raw HTML, which is also what the page's data stream is made of, falls 5 to 31 percent; bytes sent fall 1 to 6 percent (`/scores`, not edited, is flat). The
  difference is the point made in Context: Vercel's quality-3 brotli already squeezes repeated class text, so the saving is real but
  small. `/scores` (not edited; its raw size moved only because the header and footer links share the new names) and the program page
  (its crests were most of its repeated markup, and its rows were already trimmed by `.pg`, ADR 0100) gain least.
- Not measured, and not claimed: blocking time and largest paint (the runner's noise is larger than anything here), or a phone's parse
  time for 25 to 300 KB less markup, which is what the raw column stands for.

## Consequences
- A page is smaller by what its class text was, not by what it says: raw HTML falls 5 to 31 percent and sent bytes 1 to 6 percent,
  because brotli already squeezes repeated class text well. That is the honest size of this lever.
- A new long list says `prefetch={false}` (ADR 0100) **and** names its row's look once in `globals.css` rather than spelling it per row.
- Not done, with the cost named: the `/rankings` hidden columns (22 KB sent, above) and a client-side table for rankings (the data
  would travel as compact rows, about 25 KB less, but hydrating about 6,000 elements would take the phone's blocking time from its
  170 to 240 ms toward the 350 ms budget; it needs a Lighthouse run on a branch first).
