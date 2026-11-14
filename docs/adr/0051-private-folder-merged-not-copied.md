# ADR 0051: The run's captures are merged onto the private repo's newest main, never copied over it

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It adds to ADR 0031 (the private store and
its two-read rule) and ADR 0046 (late finals, moved games), and changes nothing they decided.

## Context
- The Results watch commits the private data repo's `maxpreps-<season>/` folder last, after reading and filling. On every
  try `commit-results.sh` reset to the newest main, deleted the folder and copied the run's whole copy back.
- Anything committed to that folder while the run was reading (a hand fill, a late final, a correction) was therefore
  silently wiped by the run's older copy of the same file.

## Decision
1. **Merge, never copy.** `tools/league-watch/remerge.mjs <run's folder> <private folder> --base <folder as the run
   started>` lays the run's captures on main's folder. The base is the private checkout's HEAD before the read. Where
   main's copy of a file is still the base, nobody else touched it and the run's copy goes in as it is (the usual case,
   the same result as the old copy). Where it is not, only what the run changed or added (its delta against the base)
   is laid on main's copy, and every row the run left alone stays as main has it.
2. **Keyed files go through the store's own merge** (`mergeStored`): games.csv and playoffs.csv. A row only main has
   stays; a stored final is never overwritten (a different score is a proposal that applies after two reads); a score
   fills a blank, a blank never replaces a score. No unplayed row is dropped by the merge, so a postponed game's old
   row waits for the next read.
3. **The other files:** pending-scores.csv keeps main's proposals plus the run's new ones minus the ones the run
   settled; score-changes.csv only grows (a run's line is kept only for a file whose rows went in as the run had them);
   moved-games.csv keeps every move from both sides; outside.csv and teams.csv keep main's rows and take the run's new
   or changed ones; schedule.csv is the union minus what the run dropped and minus any game now scored; a report
   (coverage.txt, season.json) is the run's copy when the run rewrote it, else main's.
4. **Unchanged:** the finals cross-check's two files in `davecampbells-<season>/` are whole-file reports, still copied by
   name (ADR 0032).

## Consequences
- A commit to the private folder during a run survives. A run's own applied score change that lands on a row main also
  changed is proposed again and applied by the next read, not lost and not forced.
- A failed merge (a header that is not the store's) fails the step; the private repo is not pushed and the next run tries again.
