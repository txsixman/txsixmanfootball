# ADR 0067: Kickoffs and sites for next-round pairings the bracket sets before any listing

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It widens ADR 0036's and ADR 0041's morning
read from listed bracket games to the pairings ADR 0047's bracket fill sets by winners.

## Context
- The morning read looked up kickoffs and sites only for bracket games listed in `data/seed/maxpreps-<season>/playoffs.csv`.
- After the 2026 bi-district round, that file listed 2 of the 16 UIL area games. The other 14 pairings were already set by
  bi-district winners on the playoff pages (ADR 0047), so the read never looked up their kickoffs and they showed no time.

## Decision
1. **Due games come from the bracket too** (`tools/league-watch/bracket-due.mjs`). Each league's own bracket file (UIL's
   `bracket-<season>.csv`, the robot-read `data/seed/brackets/<season>.csv`) is filled with the season's finals by the same
   code the pages use (`apps/web/lib/bracket-fill.ts`). Every slot whose two teams are both known and that no listed game
   holds yet is due. Later rounds are handled the same way as they fill. Listed games are never duplicated, because a slot
   holding a listed game is not built.
2. **Dating:** a built pairing has no date. It takes the Central date of the second source's first game between its two
   teams from today to 21 days ahead, each team known by the team map, or by school name for a team the map lacks. A pairing
   the source has no game for yet stays blank and is counted, never guessed.
3. **Merge and words:** the rows go through the same never-overwrite merge (`mergeKickoffs`) and ADR 0041's site rules
  . No page names a source.
4. **Summary:** the run log counts listed games and built pairings apart: how many were built, how many the source has a
   game for, and how many kickoffs were found for them. It gives counts only, never a school.
5. **Pages:** a next-round pairing on a playoff page shows the day, the kickoff status and the site the file has for its
   two teams after their last listed games. Otherwise it shows "date and site not listed yet", as before. Once a listing
   has the game, the listed row replaces it.

## Consequences
- An area game's kickoff shows as soon as the second source lists it, without waiting for the results reader's listing.
- Coaches may not set some times until the Monday before the game; those pairings stay blank until a later morning read.
- The read asks the source about a few more teams each morning: one per built pairing, within its 2.5 second gap.
