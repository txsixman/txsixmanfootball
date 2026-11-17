# ADR 0097: Head-to-head is a first-class page: a pair's series in words, its streak, its biggest wins, its playoff meetings and its next game

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It adds to ADR 0013 (records rest on the scores
read), ADR 0003 and ADR 0072 (merged and renamed schools), ADR 0040 (a disputed final names no winner), ADR 0088 (the preview's
head-to-head) and ADR 0089 (the program page's most-played list), and narrows one line of ADR 0040 (below).

## Context
- A pair page already existed: `/series/<a>/<b>` (ADR 0013's records, built in round 3), one for every pair of current
  programs that had met three or more times since 2018: 1,336 pages. It had both crests, the record, every meeting with its
  round, UIL finals between the two and a projection, and nothing that read like a rivalry: no streak, no biggest win, no
  playoff meetings, no next game.
- It started at three meetings, so a pair that had played once more than a fluke (a first rematch) had no page: 877 pairs of
  2,213 that have met twice or more.
- The record was a bare "7-2" (and "2-0", "1-0" on a short series), which reads as a forfeit score (ADR 0004 and ADR 0089
  keep those off every game list). Records of two and a few games are now common, so the form matters more.
- The reversed address (`/series/jayton/guthrie`) answered 404, so a link typed the other way round was dead.
- A game page said "Every X and Y game since 2018" below everything, and the preview of a game ahead (ADR 0088) had its own
  head-to-head list with no way into the page. The Matchup picker listed the last five meetings and stopped there.
- Round 12's brief named the address `/matchup/<a>/<b>` for the new page. `/series/<a>/<b>` already has pages in the
  sitemap, the search index (one bit a pair), the program pages and four specs; a second page for the same pair would be two
  pages for one thing.

## Decision
1. **One page a pair, extended in place: `/series/<a>/<b>`.** `/matchup/<a>/<b>` is a permanent redirect to it (`next.config.ts`),
   so the address a reader guesses from Matchup works. The pair's slugs are in alphabetical order; **the reversed order is now a
   static page that permanently redirects (308) to the alphabetical one**, instead of a 404, so a pair has one page and no
   dead link. (Next builds the redirect as a cached 308 for each reversed address; the sitemap lists only the canonical one.)
2. **A page from two meetings** (`MIN_MEETINGS`, was three), both teams current programs.
3. **The series in words**: "Jayton won 6, Guthrie won 3, 1 tie", the side ahead first (the first-named when level), a tie
   count only when there is one. Never "6-3". A program page's most-played rows say "won 5, lost 2" the same way (and "tied 1"
   only when there is one).
4. **At a glance** (new): the **next meeting** when the bracket lists or sets a game between the two (its day when it has one,
   "Day not set yet" when not, its round, a link to its page); the **last meeting**, linked; the **longest streak** (one side's
   wins in a row, with its years, "(still going)" when nothing has ended it; two in a row is the shortest named; a tie, a loss and
   a disputed final end a run; a forfeit counts as a win, as in every record); each side's **biggest win** by points, linked.
5. **Forfeits are listed, never a margin**: a forfeit is the word in the list and counts as a win or a loss in the series
   and a streak (ADR 0013), but it is never a biggest win (its recorded 1-0 or 2-0 is no score, ADR 0004).
6. **A disputed final is listed and not counted** (this narrows ADR 0040's "series still count a disputed game by its score"):
   it shows its score with "score reported, not counted", the page says how many finals that is, and it is in no record, streak
   or biggest win. It still counts as a meeting in the list and in "N meetings".
7. **Playoff meetings** (new section, when there are any): the playoff games of the pair, newest first, each with its round, each
   also in the full list. The full list is unchanged: date, Away vs Home, round, score, a link to the game page.
8. **Merged and renamed schools follow ADR 0003 and ADR 0072**: a game under an old school's slug counts under the program it
   became (`mergedPairs`, using the same list the State Championship rules use), and a game between the two halves of one merger
   is no pair. Every merger in `programs.csv` is dated before 2018, so no pair is changed today; the rule is tested and ready.
9. **Links in**:
   - A game page's **preview** (a game ahead) gets "All N meetings" beside its head-to-head list, in place of the line a game
     with no preview has at the foot of the page. Beside the list, not in it: that list holds the meetings themselves.
   - A **program page's** "Most played" is the five opponents met most (at two games or more, was six at three), each with the
     series in words, the latest score and the games count linking to the pair's page.
   - **Matchup**: once two teams that have met twice are chosen, "All N meetings" under the last five goes to the page.
   - The sitemap, search (one bit a pair) and program pages' "All opponents" lists follow the page list, so they grew with it.
10. **No structured data**: a pair's history is not an event a search engine shows as one, and a list of `SportsEvent`s would
    repeat every game page's own block. Left out on purpose.
11. **Static, no client script**: everything is worked out in the page's own pass from maps the build already holds (the pairs
    index, the playoff labels, the disputed list); the new links are `prefetch={false}` blocks of 44 px with their shown text
    in their names (ADR 0080, ADR 0081). The unplayed games come from the bracket's own lists (`upcomingMeetings`), read once.

## Consequences
- 2,213 pair pages (was 1,336: +877). Their reversed addresses are 2,213 more, each a tiny redirect page; the sitemap, the search
  index (8,973 bytes brotli, budget 12,000) and the build's worker memory take the canonical ones only.
- The record line of a series page and the most-played rows read differently ("won 6, lost 3" for "6-3"). The specs that read them
  parse the words, and one checks that no bare `\d-\d` appears in the header.
- A disputed final no longer counts on a series page, so a pair's record can differ by one from the old page's until the
  dispute is settled by a correction; the page says so.
- `scripts/series.test.mjs` pins the rules: the two-game threshold, canonical order, the record with a disputed final, the words,
  streaks (a tie, a disputed final, a forfeit, a later run winning a tie in length, "still going"), biggest wins (forfeit and
  disputed excluded, tie-breaks), and merged schools. `e2e/series.spec.ts` covers the page, its redirect, the glance facts,
  the playoff list, the next meeting and a disputed final (the last two follow the data and skip when none), and the links
  from Matchup and a program page; `e2e/game-preview.spec.ts` covers the preview's link.
