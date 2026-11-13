# ADR 0031: The results store is the record; reads merge into it and read only what is missing

**Status:** Proposed Nov 13, 2026; accepted when its pull request is merged. Amends ADRs 0008, 0017 and 0021. Their other
rules stand.

## Context
- A full read re-read about 280 MaxPreps schedule pages and rebuilt `games.csv` and `playoffs.csv` from nothing. A
  score MaxPreps later dropped, blanked or changed by mistake simply vanished from the site on the next read.
- The hosted Postgres was only a copy, reloaded from the files on Mondays or when someone ran the load.
- Every read went back over finished games and finished seasons. That costs MaxPreps requests for nothing; ADR 0008
  asks the reader to be polite.

## Decision
1. **The store is the record.** It is the reader's `games.csv`, `playoffs.csv` and `outside.csv` in the private data repo
   (ADR 0017). A read merges into them (`tools/league-watch/store.mjs`) and never rebuilds them. A read may:
   - add a game;
   - fill an empty score;
   - drop an unplayed game that a page it read no longer lists (a postponed game comes back under its new date).

   It never deletes or blanks a stored score. A stored score that must go (a game that was not six-man, a wrong team)
   goes through `data/corrections` or a reviewed commit to the private repo, never a read.
2. **Corrections are kept, not lost.**
   - A stored final changes only when the source shows the same different score on two full reads in a row.
   - The first read records the proposal in `pending-scores.csv`. The second applies it and appends a line to
     `score-changes.csv`: when, which file and game, old and new score, source page. That file only grows.
   - A read that shows the stored score again drops the proposal.
   - The game stays unconfirmed on the site, as every robot-read score is (ADR 0004).
   - Game-day reads (`--tonight`, ADR 0030) only fill empty scores; they never propose a change.
3. **Read only what is missing** (the next change). The read list comes from the store:
   - team pages with an unscored game dated in the last 14 days or today;
   - teams whose season has no stored schedule yet.

   The store keeps each season's unplayed games in a private `schedule.csv` for this. A game final and older than 14
   days is not read again.
4. **A finished season is read once.** A past season read in full is marked complete (`season.json`). After that the
   reader stops before its first request unless it is run with `--reread`, which is Results watch's manual `reread` input.
5. **One safety pass a week** (the next change). A Monday-morning full read stays as an audit. It merges under rules
   1 and 2 and reports what differed in the run summary, as counts only. Every read already writes those counts.
6. **The site builds from the store.**
   - `data/seed/maxpreps-<year>/games.csv` and `playoffs.csv` are the published snapshot, written from the store by
     `publish.mjs` (ADR 0029).
   - The hosted database gets the season's games in the same Results watch run (`load.mjs --games <season>`), with the
     same upsert as the full load. A game whose row says the same thing is left alone, and no game is deleted.
   - The Monday full load (`supabase.yml`) still applies migrations, alignments and lineage.
7. **Fewer requests.** Rules 3 and 4 cut the pages read on an ordinary morning from about 280 to the teams with
   something new. That is better manners under ADR 0008, and it is the point of this decision as much as safety.

## Consequences
- A score once stored survives a source that later drops it. A real correction takes two reads to land and leaves a
  record.
- The private repo gains three files a season: `pending-scores.csv`, `score-changes.csv` and `season.json`.
  `publish.mjs` copies none of them.
- Each read's merge counts are in coverage.txt and the run summary: added, filled, unchanged, changed, proposed, kept
  and dropped.
- A wrong score that two reads agree on still lands. The correction path (`data/corrections`) is unchanged.
