# ADR 0047: Next-round games from the bracket, and checks that winners go on

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged.

## Context
- A bracket page showed only the games a site lists. After a round's finals, the next round's games could be known
  for a day or more before any site listed them ("Fort Bend Chargers vs winner of Tyler Heat–THESA").
- Nothing checked that a listed later-round game had the right two teams, that a team that lost never appeared later,
  or that every winner with a known next game was placed in it.
- Which games feed which next slot is a fact of the bracket, not of the scores. Guessing it from district numbers or
  seeds is not allowed.

## Decision
1. **Where a bracket's slots come from.** Only from a league's own public bracket or from what the data closes alone:
   - TAIAO: `tools/league-watch/taiao.mjs` clicks each "Division N Bracket" tab on the page it already reads (ADR 0005),
     and writes each slot code and its two sides (a team, "bye" or "winner:<slot>") to
     `data/seed/brackets/<season>.csv`. Robot-written, never by hand; no source column (ADR 0010).
   - UIL: `data/seed/uil-<span>/bracket-<season>.csv`, entered by hand from UIL's own 2026 Division I and II brackets
     (downloaded by hand; the files are never committed). Game codes G1 to G31: bi-district G1 to G16 with each team's
     district seed (W5, R6), area G17 to G24, regional G25 to G28 ("quarterfinals" on UIL's bracket), semifinals G29 and
     G30, the final G31; G(16+k) is fed by G(2k-1) and G(2k) in every round. A kickoff and site only where the bracket
     lists one (Division I G19). Seeds, regions and feeds only, no source column.
   - Every league without its own bracket: two listed semifinals feed the final. For UIL, two area games inside one
     region feed that region's regional game (the regions are closed sub-brackets).
2. **Next-round games before a listing** (`lib/bracket-fill.ts`): once a feeding game is a final (ADR 0040), its
   winner goes into the next slot. A slot shows when one side is a team and the other is a team or the winner of a
   listed game: "A vs B" with the projected margin and chance to win on a neutral field, or "Team vs winner of X–Y".
   No date or site, because none is listed. A listed game always replaces the built row. Shown on bracket pages, league
   playoff pages, Scores ("Next games") and program pages, where it replaces the "if it advances" guess. Current season
   only.
3. **A kickoff and site from a league's bracket** fill a listed game that `data/seed/game-details` has nothing for, never
   over a kept one (ADR 0041), and a kickoff only on the listed game's own date.
4. **Checks** (`bracketProblems`, run by `apps/web/scripts/check-data.mjs` for the current season, so they fail CI and
   the Results watch integrity report and its alert). Each line is keyed for `data/integrity-exceptions.json`:
   - a listed later-round game whose team is not the winner of the slot that feeds it;
   - a winner whose next slot lists a game with the other side but not that winner;
   - a listed game in a round the bracket covers that is none of its pairings;
   - a team that lost a final and appears in a later round of the same bracket;
   - UIL's bracket file against the alignments: every team in that division, in the slot's region, in its seed's
     district, and every feed an earlier slot.
5. **Cross-check against the feed** (`davecampbells.mjs --kickoffs`, in Results watch): a UIL game the second source
   places at position k of a round must be the pairing of G(first code of the round + k). The run summary gives the
   count; a misfit (named by game code, never a school) goes to the robot alert.

## Consequences
- The weekly TAIAO job commits `data/seed/brackets` with the alignments, in the same pull request.
- A round may hold only built rows. "Latest round" labels use the last round with a listed game (`latestRound`).
- A disputed final names no winner, so it builds nothing past it.
- A new UIL season needs its bracket file by hand once the brackets are out; the feed cross-check catches a typo.
- The first run found a listed TAIAO Division 2 semifinal that TAIAO's own bracket does not pair; it is a known
  exception in `data/integrity-exceptions.json` until the listing is corrected.
