# ADR 0104: The road to the State Championship on a program page

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It adds to ADR 0071 (chances to reach each
round, worked out exactly up the bracket), ADR 0094 (who's left and a team's path) and ADR 0083 (State Championship pages).

## Context
- The playoffs run Nov 19 to 21. A fan on a phone opens a team's program page and wants to know what is ahead: who the
  team plays next, who it could meet after that, and how likely each round is.
- The page had "Path to the State Championship": the games played and listed, and, only where two games of a round pair up
  (two semifinals, two area games of a region), the likely opponents of the one round after. Nothing past that round, and
  nothing for a bracket whose later rounds the league's own file holds (UIL's G1 to G31).
- `lib/advancement.ts` (ADR 0071) already works out, slot by slot, each team's chance to be in each round and to win it.

## Decision
1. **A section "Road to the State Championship"** (`app/programs/road-to-final.tsx`, id `road`) above "Path to the State
   Championship" on the program page of a team still in a bracket of the season under way, one block per bracket (a school
   in two leagues has two, ADR 0012). It lists each round still to play, first to last, in the bracket's own round names
   (`roundLabel`), the last always "State Championship". The first is the team's next game, marked so, with its day,
   kickoff and site, and a "Game page" link when the game has a page (listed, or set by the bracket, ADR 0079).
2. **Each round gives** the chance to reach it and the chance to win it (a reach already certain is left out; a bye has no
   win), and the teams it could meet there, most likely first, up to three, each linked to its program with its chance of
   being there and the projected margin and chance to win of that meeting; any others are counted with their combined
   chance ("1 other team, 3% together"). A round whose opponent is known says "Opponent".
3. **Same model.** `lib/road.ts` reads `slotShares` (ADR 0071): a team's reach is its side's share of the round's slot, its
   chance to win is that slot's winner share, the opponents are the other side's shares. So a round's reach equals the one
   before it's win, and the last round's win is the State Championship chance of the bracket's table. A listed game is
   projected at its own site, a pairing no site lists on a neutral field (ADR 0057). A team with fewer than `FEW_GAMES`
   rated games is given no chance and no margin ("Not enough games to project"), and nothing it touches is guessed.
4. **What has happened stands.** Only a confirmed final (ADR 0040) settles a game. A score no source confirms advances no
   one and puts no one out: the game stays on the road as "Score not confirmed yet", no winner or leader named, its
   chances as before the score (as the bracket's table already does). A team whose last settled game is a loss is out.
5. **Out and champion.** A team that is out has no section; a line "Out in the <round> round of the <bracket> bracket."
   stands where the section would. A team that has won the State Championship shows "<season> State Champion" in the
   section. A team with a bye notes "Bye in the <round> round" and its road starts at the next game. A team still in with
   no game set yet says "Its next game is not set yet" so its link resolves.
6. **A "Path" link** in each row of who's-left (`tree/whos-left.tsx`, every bracket page) goes to `/programs/<slug>#road`; the
   team's name now goes to its program page. (`/playoffs/this-round` has one link per game, not per team, and is left as is.)
7. **Replaces** the old "If it advances" block of the Path section and `aheadFor` (`lib/playoff-path.ts`): the road covers
   every case it did, and every later round too. The Path section keeps the games played and listed.
8. **Static.** Worked out when the page is built from the data the pages already read; no client script, no clock after load
   (the day and kickoff are text, not the live "Starts 7:00 PM CT" status), so nothing moves after load. Wording: projected
   margin, chance to win, "A projection, not a result."; never betting words (ADR 0045).

## Consequences
- `Bracket.roads` (`lib/brackets.ts`): each team's road by name, this season only.
- Tests: `scripts/road.test.mjs` (a team in round 1, one that is out, a champion, a bye, an unconfirmed score, too few games,
  a private league's bracket from its listed games) and `e2e/road.spec.ts` (375 px: a live team's page, its links at least
  44 px, no sideways scroll; a team that is out has no section); `e2e/bracket-rounds.spec.ts` follows the Path link.
