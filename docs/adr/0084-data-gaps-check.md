# ADR 0084: A data-gaps check counts what the site would show as missing, and fails on a new gap

**Status:** Proposed Nov 16, 2026 (pilot mode; the owner may override); accepted when its pull request is merged.

## Context
- `check-data.mjs` checks each file, and `data-integrity.mjs` checks one season's games against each other. Neither
  counts what a visitor sees as missing: a played playoff game with no kickoff or site, a program page with no season,
  a team the ratings table counts differently from the game files, a program with no logo.
- A sweep of every season on Nov 16, 2026 (main at `e41e4e0`) found, with no allow list: no game without a date; 2
  past playoff games with no score; 1 played UIL playoff game with no kickoff or site and 2 TAIAO games with no site that
  no rule explains; no unknown team names (175 past bracket rows against schools outside the alignments, ADR 0069); no
  duplicate games; 1 playoff game games.csv lacks; 6 programs with no 2026 game and 2 whose only games are forfeits;
  no alignment row without a league; no game the ratings skip without a reason, 2018 to 2026; 8 programs with no logo.
  23 gaps had no recorded reason.

## Decision
1. **`apps/web/scripts/data-gaps.mjs`** finds eleven kinds of gap, every season: `no-date`, `no-score`, `no-kickoff`,
   `no-site`, `unknown-team`, `duplicate`, `score-mismatch`, `empty-season`, `no-league`, `ratings-mismatch`, `no-logo`.
   It reads the files as the site does (corrections applied; kickoffs and sites through `lib/kickoffs.ts`) and prints a
   count per kind: found, known by rule, allowed, new.
2. **A gap is known in one of two ways.** By rule, in the code, citing its ADR: a TAPPS or TCAF bracket game's site and
   kickoff (ADRs 0064, 0065), a withheld site (ADR 0076), a forfeit or no contest (ADR 0004), a past bracket game against
   an unlisted school (ADR 0069), a program whose only games are forfeits, a game of today or later. By hand, in
   `data/gaps-allowed.json`: kind, key, reason, reviewed date.
3. **It fails** on a new gap, on an allow-list entry that matches nothing (the fix landed: remove it), and on an entry for
   a gap a rule already explains. CI's `web-checks` job and `scripts/check.sh` run it. The robots do not: a gap never
   blocks a results commit, but main's next CI run names it.
4. **A playoff game's kickoff and site are due the day after the game,** once the morning read has run (ADR 0077).
5. **Ratings are checked against the files:** each team's rated games and record in `data/ratings/<season>.json` must
   equal the season's game files, less forfeits (rated never, in the record), 0-0 no contests and copies.
6. **Fixed in the same change:** logos for High Island, CHANT, St. Mary's (Taylor) and Grace (Perrin) from their Dave
   Campbell's team pages, and The Covenant Preparatory School's from its own site (ADRs 0006, 0016). St. Mary's and
   Grace had an initials badge only because no allowed source had a logo (the owner, Nov 11); one now does. The 2022
   TAIAO Division 2 "final" CenTex v BVCHEA, listed with no score a week after the same two teams' semifinal, is voided.

## Consequences
- After the change: 0 new gaps, 15 allowed with reasons, 2 unscored past games down to 1, 8 programs without a logo
  down to 3.
- Three allow-list entries (CHANT, Covenant Prep, High Island with no 2026 game) go stale once the next full results read
  moves their games out of the private `outside.csv`. Main's CI then fails until those entries are removed, by design.
- A playoff game left with no kickoff or site past its day turns CI red until it is filled or allowed with a reason.
