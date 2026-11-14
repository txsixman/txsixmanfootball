# ADR 0049: The bracket drawn as a tree, by round on phones, and as an image

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged.

## Context
- A bracket page listed its games round by round. Fans read a bracket as a tree: who plays whom next, and the road to
  the final. The site asked for "a true bracket view", exportable, built for phones and desktops.
- ADR 0047 gave the shape (which slot feeds which) for UIL (its own bracket, by hand) and TAIAO (its own bracket tabs,
  by robot). TAPPS and TCAF have no league file.
- The site's rules still apply: every link and button at least 44px tall, no sideways page scroll on a phone, no source
  named on a page or image, the words "projected margin" and "chance to win" only.

## Decision
1. **The shape.** A league's own bracket where the data has one (ADR 0047). Otherwise the listed games give it: each
   listed game is a slot, fed by the game each of its teams played in the round before; two listed semifinals feed the
   final. Nothing is guessed further: a bracket whose later rounds are not listed is shown by rounds only, with no
   tree (`derivedSlots` in `lib/bracket-fill.ts`).
2. **The layout** (`lib/bracket-layout.ts`, pure, tested): rounds as columns, the final's two halves mirrored so they meet
   in the middle, each game halfway between the two games that feed it, a shorter half centered. UIL's regions and
   TAIAO's North and South run down the outer edges. Pixel sizes come from one function the page and the image share.
3. **Each box** (`lib/bracket-tree.ts`): its code (G17, NQ1) and date (time while not played), two team rows, and a
   line for the result or the projection.
   - Played: both scores, the winner of a confirmed final in bold (ADR 0040); a forfeit says the word; a disputed final
     names no winner.
   - Under way: the live score in place, "Live · Q3 · Unconfirmed" (ADR 0021).
   - Not played: the two teams, or "Winner of G17" ("Winner of Kress–Jayton" where the bracket has no codes); each
     team's chance to win where its score will go; the projected margin and the site, when listed.
4. **On the page** (`app/playoffs/tree/`, one client component, no chart library): wide screens open on the whole tree,
   phones on one round at a time (columns that snap, with the round names held at the top). Either view can switch; the
   phone's whole bracket opens fitted to the screen and pinches like any page. Tapping a team lights its games and
   the route still ahead of it; tapping a game opens its page. The round-by-round list stays below, with the same
   games, and a skip link leads to it. Team rows are 44px buttons, so the boxes are tall; the tree scrolls inside its
   frame, never the page.
5. **Export.** "Download image": `/playoffs/bracket/<slug>/image/share.png` (1200 by 630, names and scores) and
   `full.png` (the page's drawing at full size), drawn at build time from the same data, with the site's name and
   address. "Print" fits the drawing on one landscape page. "Copy link" and "Share" (the phone's share sheet).

## Consequences
- The bracket is as current as the page: rebuilt with each results commit, live scores in the browser only.
- The site has no dark mode yet. The drawing uses only the site's color tokens, so it follows when one is added.
- A bracket with no league file is drawn only once its listed games connect to one final. That is TAPPS and TCAF
  from their semifinals on, and never earlier.
