# ADR 0102: A results week as plain text, with a copy button and a print layout, for the local paper and radio

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It adds to ADR 0012 (organizations stand alone),
ADR 0037 (a game is "Away vs Home") and ADR 0040 (a final is confirmed), and uses ADR 0004's forfeit rule.

## Context
- A small-town paper or a radio station prints or reads out its teams' six-man scores. The Results week page is built for a
  phone: crests, links, tabs and projections. Copied or printed, it carries the site's header and footer, truncated team names
  and two columns.
- What such a reader wants is a list they can paste into a layout program or read down: every game, nothing else.

## Decision
1. **A text file per week and organization**, at `/results/text/<season>/<week>/<org>` (`uil`, `tapps`, `taiao`, `tcaf`,
   `independent`; UIL has the slug here though its page has none). It is built at deploy time for every week that has a game,
   as `text/plain; charset=utf-8` with `X-Robots-Tag: noindex`: the week's own page is what a search should find. A week with no
   game has none (404). Built by `lib/results-text.ts` (pure, tested) from `lib/results-text-load.ts`.
   - *Why not `/results/<season>/<week>/<org>/text`:* an optional catch-all (`app/results/[[...path]]`) cannot sit beside a
     `[season]` folder with confidence and a local build is not allowed, so the file lives under a static `text` folder, the way
     `card` does (the same shape as `/results/card/<org>/opengraph-image`).
2. **Its lines**: the title, the dates (Monday to Sunday), "Away team listed first.", then sections in order: **district games**
   (by district, in number order, each under its own heading such as "UIL Division I, Region 2, District 5"), **non-district
   games**, and **playoff games** (by round, earliest first, then by bracket, with State Championship named so). A section with
   no game is left out. Inside a group games run by date, then home team, then away team. The credit is the last line.
   - A confirmed final reads "Away 22, Home 77" (ADR 0040: a final is confirmed, so every listed game has one).
   - A forfeit reads "Away vs Home, forfeit (Home)", the team in parentheses being the one awarded the game; the recorded 1-0 or
     2-0 never shows (ADR 0004). A note under the list says what the parentheses mean, only when a forfeit is in the week.
   - A final the sources give different winners (ADR 0040's disputed list) reads "Away vs Home, score reported", with no score,
     because the paper should not print a score the site itself does not stand behind. This is the only "unconfirmed" kind a
     result can be.
   - **Districts exist only for the current season**: they come from the current alignments, which say nothing about 2025's, so
     a past season's regular-season games sit under one plain "GAMES" heading (never "non-district", which would say they were
     not district games; a game page also knows districts only for the current season, `lib/game-pages.ts`). A playoff round is
     known for every season.
   - The text is plain ASCII punctuation, no markup, one line break between lines, ending with a newline.
3. **The credit line** is "Scores from txsixmanfootball.com": it names this site and no data source (ADRs 0009, 0010).
4. **"Copy results"** on the week page copies exactly that text. The text is the print-only block of the page (below), so the
   clipboard, the printout and the file are one string. The button is 44 px tall; a status line of fixed height under it says
   "Copied" (or "Not copied") for three seconds, so nothing on the page moves. Next to it, "View as text" opens the file. Neither
   appears on a week with no game (that page says so, ADR 0098).
5. **A print layout**: the week page carries the text in a block hidden on screen (`data-results-print`) and marks its own content
   `data-print-hide`; `globals.css`'s print rules then show only the block, with no header, footer, tabs, buttons, crests or
   links, team names in full (no truncation), one column, black on white whatever the theme, on a portrait sheet (a named
   `@page`, since the bracket's print rule makes every other printed page landscape). The block is left out of the site search.
6. **Words**: no "winner", "leading" or betting word in the text (a result is final or reported, never live); no player names;
   no source name.

## Consequences
- About one small file per organization-week with a game is added to the build; no new data, no new page to index.
- A school's name as the data spells it is what is printed. A name the paper writes differently is the paper's to fix.
- The week page repeats its list once in the HTML (hidden on screen). The block is `data-pagefind-ignore`, so the search
  index and its excerpts are unchanged.
- `scripts/results-text.test.mjs` tests the grouping, the order, a forfeit, a reported score and the credit;
  `e2e/results-paper.spec.ts` tests the file's type and headers, that it holds every game the page lists, the button, and print media.
- Left alone: a printed or copied score is as current as the last build, so it carries no "as of" time; a paper that wants
  a later correction copies again.
