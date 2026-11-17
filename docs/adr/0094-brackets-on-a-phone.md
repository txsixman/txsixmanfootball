# ADR 0094: Brackets that read on a phone: round tabs, game cards, who's left, a team's road

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0049 (the bracket drawn),
ADR 0071 (chances to reach each round), ADR 0080 (phone speed budget) and ADR 0081 (accessibility sweep).

## Context
- The playoffs run Nov 19 to 21 (UIL's area round, other leagues' later rounds) and most fans read the site on a phone in a
  stadium. ADR 0049 gave a phone the rounds as columns that snap sideways, with a bar of round buttons held at the top.
- Reviewing each league's bracket at 375 px found:
  - The round bar was `<nav>` buttons marking the open round with `aria-current`, not tabs: no tablist, no arrow keys, and
    the columns were a horizontal scroller inside the page, so a game's day, site and page link were two taps from view.
  - A box held code, day, two teams and two small lines (the projection and the kickoff); the site (a long name) was only
    in its `title`, which a phone never shows, and the game page was an invisible link laid under the team buttons.
  - Nothing answered "who is still alive here?": a fan had to read the drawing, or the "Chance to reach each round" table
    (ADR 0071), which lists each team's chances but not its next game, and is not a list of who is left.
  - A team's path was lit in the drawing only; in a one-round-at-a-time view the lit path is mostly off screen, and there
    was no way to the program page's own "Path to the State Championship".
  - `/playoffs` listed every bracket's rounds first to last, so on a UIL page the round being played was fourth or fifth
    on a phone, with nothing at the top saying which it was.

## Decision
1. **Round tabs** (`app/playoffs/tree/rounds.tsx`). The rounds view is a real tab set: one `tablist` named for the
   bracket's rounds (held at the top while the cards scroll), a `tab` a round, a `tabpanel` a round. The arrow keys, Home
   and End move between tabs and open them (automatic activation); the tab in the order is the open one (roving
   tabindex); the ends wrap. The open tab is the **round the page calls current** (`currentRound`, by date, the same one
   the bracket page's list and `/playoffs` mark), else the first round with a game still to play, else the last. It is
   worked out at build time from the same data, so the first paint is already on it and nothing moves after load. A square
   and "(current round)" mark that round's tab, whichever tab is open. The panels of the other rounds stay in the page,
   hidden, so every game is in the HTML. Wide screens keep the whole tree; "By round" switches to the tabs.
2. **A card a game** (same file). Both teams as the 44 px rows of ADR 0049 (a team's button lights its path), the day
   (weekday and date) and kickoff in the card's head, a result, a projected margin or a live score under the teams, the
   site, or "Site not listed yet", and a visible "Game page" link, 44 px tall, below. A game that is played shows no site.
   Live scores stay in place, dashed and unconfirmed (ADR 0021); no card says "winner" or "leading" for a game under way.
3. **Who's left** (`lib/whos-left.ts`, pure and tested; `tree/whos-left.tsx`). For each bracket, the teams still in,
   highest State title chance first (a team the model cannot project after the rest, then by name), each with its next game
   (round, day, kickoff, opponent or "Winner of ...", its game page), its chance to win the State Championship where
   `lib/advancement.ts` works one out, a button that lights its path, and a link to its program page's playoff path
   (`/programs/<slug>#path`). It is worked out from the tree's boxes, so it cannot disagree with the drawing: a team is out
   when its last game is a confirmed final it did not win (a disputed final names no winner, so both teams stay in it); a
   team that won the State Championship is the one team left and says so. A bracket drawn by rounds only has a winner with
   "Next game not set yet". Chances are worded as the table below words them (`chanceTexts`) and marked a projection, not a
   result (ADR 0004). No team is listed under another organization (ADR 0012): each league's page and each bracket stand alone.
4. **A team's road** (`pathSteps`). Tapping a team anywhere (a card, the tree, "Light its path") still lights its games
   and the route ahead, and now also says so with a link to its program page's path and a "Its road, game by game" list:
   what it played (result and score, "won by forfeit", "result under review"), its next game, and each round its wins would
   lead to. In the rounds view a line of the list opens that round. The list is under the status line so tapping a card
   moves nothing the reader is looking at.
5. **The current round on `/playoffs`** (and each league's page). A "Current round" block above the brackets lists every
   bracket of that league with the round being played and its game count (a link down to that round on the page) and
   "Who's left: N teams" (a link to the bracket page's list). In each bracket's round list the current round is marked
   (`aria-current="location"`, filled, as on a bracket page) and its heading says "current round". The order of the rounds
   is unchanged (first to last), so earlier results keep their place. A past season has none of this.
6. **Static.** Everything above is worked out when the page is built (the pages rebuild with each results commit) from the
   data the pages already read; the one new client behavior is the tabs and the buttons. No new request, no new data file,
   no new page.

## Speed (ADR 0080)
- The bracket page's HTML grows by the cards' extra lines (the site, the day) and the list of teams left; the client code
  by about 6 KB of script (tabs, cards, the list, `lib/whos-left.ts`). The round columns' horizontal scroller and snap
  handling are gone. `/playoffs` gains a block of at most nine lines. Both stay inside the budgets in `lighthouserc.cjs`;
  the list's teams link with `prefetch={false}` as program links do.
- Nothing is added that loads or measures after load: the open tab and the lists are decided in the server's render.

## Accessibility (ADR 0081)
- ARIA tab pattern as above; `aria-controls` and `aria-labelledby` pair each tab and panel; a link's name holds the words it
  shows ("Game page" then "for A vs B"; the team's name then ", playoff path").
- Every link and button is at least 44 by 44 px; the tab bar scrolls inside itself when a bracket has more round names than
  a phone is wide, and its open tab is kept in view; the page itself never scrolls sideways.

## Consequences
- `e2e/bracket-rounds.spec.ts` (phone and desktop) checks the tab semantics and keys, a card's contents, who's left against
  the bracket's own data, the lit path and its road, and the current-round block and mark for every league that has a
  bracket; `e2e/bracket-tree.spec.ts`'s phone test follows the tabs. `scripts/whos-left.test.mjs` covers byes, forfeits,
  disputed finals, a champion, a bracket with no feeds, and UIL Division I from its fixture.
- The sample bracket (`/playoffs/bracket/sample`) shows the tabs, the cards and who's left with invented schools, so its
  screenshots changed.
- A team the alignments do not know has no program link; it is listed in plain text.
- `Box.date` (YYYY-MM-DD) joins the tree's data for the card's weekday.
