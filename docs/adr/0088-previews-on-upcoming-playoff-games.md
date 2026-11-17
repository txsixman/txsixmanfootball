# ADR 0088: A real preview on every upcoming playoff game page

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0079 (pages for the games the
bracket sets) and the game-night preview (`app/scores/game-preview.tsx`), and uses ADR 0057 (no home edge at a
State Championship), ADR 0040 (a final names a winner unless disputed) and ADR 0083 (recorded champions).

## Context
- The playoff weeks (UIL area Nov 19 to 21, other leagues' later rounds) are when fans open game pages most. A game not yet played
  already had a preview: each team's record, rating and rank, the projection, head-to-head and the opponents both met.
- It lacked the things a fan reads first: how each team has been playing lately, what is at stake after the game, and for a State
  Championship each team's history. And it was shown only for a game with a day: a game the bracket sets with no day yet (ADR
  0079; kickoffs arrive later in the week) fell back to the old "Going in" and "Earlier meetings" sections.
- Every fact needed is already in the build's own data. Nothing new is read, and nothing is a client fetch.

## Decision
- **Every game not yet played with both teams known gets the preview**, dated or not. An undated game counts every game read so
  far, as its detail already did (`resolveGame`).
- **Last five games** for each team (`lib/preview-parts.ts` `lastGames`): its own games before this one, regular season and
  playoffs, newest first, each linking to its page, with the score from the team's own side. A final shows W, L or T (a screen
  reader hears "Win", "Loss", "Tie"); a forfeit shows the word and no mark, never its 1-0 or 2-0 (ADR 0004); a disputed final shows
  its score and no mark (ADR 0040). A team with no earlier game has no block.
- **The projection in plain words**: the page's own line ("Jayton by 12 · 74% chance to win · A projection, not a result."), plus
  one sentence that says what is in it: "It gives neither team a home edge" for a State Championship and for a game the bracket
  sets (both are projected with no home edge, ADR 0057 and ADR 0079), "It includes the home edge for the listed home team" for
  any other listed playoff game, and a link to how ratings work. No new numbers.
- **Head-to-head** says how many times the two have met since 2018 and the date of the last meeting, above the list that was
  already there; the link to the series page stays below the preview where it was.
- **Common opponents** are unchanged.
- **Where the winner goes next** (`nextGame`): found in the bracket's own tree (`lib/bracket-tree.ts`): the box fed by this game's box.
  It shows the round, the opponent's side as the bracket words it (a team, or "winner of A and B" when the other feeder's two
  teams are known, or the league's own "Winner of G17"), and the day, kickoff and site only when the league's bracket lists
  them. It is left out where nothing is fed by the game (a State Championship, a bracket whose later rounds no data closes) or the
  winner has a bye. Today UIL lists a few later-round days and sites, the other leagues none, so most show round and opponent only.
  A kickoff's day is its Central day (a 7 PM Friday kickoff is already Saturday in UTC).
- **State Championship history** at a State Championship only: each team's earlier ones in its league's list, its titles and
  appearances "on record", its latest five with the score. UIL's list is its archive since 1972 (plus a recorded final the archive
  lacks, ADR 0083); a private league's is its recorded finals since 2018. A team with none is "No earlier State Championship on
  record", never "first appearance", because the lists have a start. One helper, `lib/title-history.ts`, now serves this and the
  State Championship page.
- **Static, no client JavaScript.** Everything is worked out at build time, in the same pass as the page; a page reads a few
  memoised maps. Link rows use `prefetch={false}`, as every tall list does (ADR 0080), so the added links cost no bytes
  until tapped. Every new link is a 44 px block with its shown text as its name (ADR 0081), and the page tests run axe and the
  tap-size check on one page of each new kind.
- **Left out on purpose:** the winner's next game for a team that already has a listed later game (it cannot happen before this
  one is played); a "pick" or a "who should win" line (words stay rating, projected margin and chance to win, ADR 0045).

## Consequences
- On Nov 16, 2026, 27 upcoming playoff games had a preview and all 27 had last-five blocks for both teams; 22 had a next game; 5
  were State Championships with history (TAPPS and TCAF; UIL's are in December).
- The game-night e2e no longer reads the next-game block as part of "the preview names no winner": that block says "the winner
  plays ..." by design, and has its own tests (`e2e/game-preview.spec.ts`, `scripts/game-preview.test.mjs`).
- `state-championships.ts` still writes a Central day from a bracket slot's UTC kickoff by cutting the string (`slice(0, 10)`),
  right for a State Championship's afternoon kickoff and wrong for an evening one. Not changed here: only the preview needed an
  evening kickoff's day, and it takes it from the Central clock.
