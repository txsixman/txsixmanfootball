# ADR 0071: Who is projected to go on, round by round, worked out exactly up the bracket

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It builds on ADR 0047 (slots and pairings the
bracket sets), ADR 0049 (the tree view) and ADR 0057 (home edge in playoff games), and widens the title chances of
`lib/title-chances.ts` (the last four, or a settled region) to every round of a bracket whose shape is known.

## Context
- The owner (Nov 15, 2026): "For the future rounds of the playoffs we need to show who we are projecting to go to the next
  rounds."
- Every bracket of the season already has its full shape: UIL Divisions I and II from UIL's own bracket file
  (`data/seed/uil-2026-28/bracket-2026.csv`, G1 to G31), TAIAO from its own bracket (`data/seed/brackets/2026.csv`), and
  TAPPS and TCAF from their listed games (`derivedSlots`). Before this, a slot no game sets yet read only "Winner of G17",
  and title chances showed only once a bracket was down to its last four.
- Every game page already shows a chance to win from the same ratings (`lib/projection.ts`).

## Decision
1. **Exact, not sampled.** `lib/advancement.ts` works up the bracket slot by slot, first round to last. A side fed by an
   earlier slot carries that slot's winner shares; a slot's winner is each team's share of its side times its chance to
   beat each team that could be on the other side. No simulation, so the numbers are the same on every build and every
   round's shares add up exactly.
2. **The same per-game chance as the game pages.** A listed game uses its own two teams at its own site (`projectAt`: the
   listed home team's edge, the `playoff_edge` share at a site the data does not call a home field, none in a State
   Championship). A pairing no site lists yet is on a neutral field, as the next-round projections already are
   (ADR 0047).
3. **What has happened stands.** A confirmed final (ADR 0040) gives its winner 100% for the next round and its loser is
   out, whatever the ratings say. A listed game has its two teams whatever the games before it say. A played game the
   sources disagree on (no confirmed winner) keeps its own pre-game chance at its site until the next round is listed.
4. **Projected slots.** In the tree, every side no game sets yet shows its most likely team and that team's chance to be
   there ("Projected 58% · Borden County"), muted, in a dashed outline, apart from real pairings and results. The game it
   waits on stays in its title ("Winner of G17"). Slots already set show their two teams and the game projection, as
   before. The exported image is unchanged: it shows only real pairings.
5. **"Chance to reach each round".** Under each bracket whose slots form one tree under one State Championship: the teams
   still in, a column per round still to be set (a round is set once every slot in it has its two teams), then "Win the
   State Championship", most likely champion first. "In" for a team already in a round. The table scrolls sideways inside
   itself on a phone, the team column held; the page never does.
6. **Program page.** A team still in gets one line in its Path to the State Championship: "Projected: N% to reach the
   <round> round, M% to win the State Championship." It replaces the last-four "State title chance" line there, which
   says the same thing.
7. **Too few games.** A team with fewer than `FEW_GAMES` (4) rated games, the rankings' own line for an unranked team, is
   not projected: its side reads "Not enough games to project", and so does every share it would change. Nothing is
   invented for it. (On Nov 15 no team still in was under the line.)
8. **Wording.** Every surface carries "A projection, not a result." The words are projected and chance to win, never
   betting words (CLAUDE.md), and the last round is always "State Championship".
9. **Freshness.** Worked out at build time from the files the pages already read (the bracket files, the playoff rows,
   `data/ratings/<season>.json`), so it rebuilds whenever finals or ratings change. No new data read. The season under
   way only: a past season's brackets are all played.

## Consequences
- This week's UIL brackets show a projected team in every open side from the regional round to the State Championship,
  and the table's columns run Regional, Semifinal, State Championship, Win the State Championship.
- The "Likely next pairings" block and the region title chances stay as they are; they say less than the table and agree
  with it.
- Tests: `scripts/advancement.test.mjs` (shares add up to 1, a played game's winner is in, a two-team bracket equals the
  single game's chance, too few games, the real UIL brackets of Nov 14) and `e2e/advancement.spec.ts` (375 px: a UIL
  bracket page and a program page).
