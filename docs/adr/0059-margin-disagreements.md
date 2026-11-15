# ADR 0059: Margin disagreements are a private list, and change no rating

**Status:** Proposed Nov 15, 2026; accepted when its pull request is merged. It builds on ADR 0026 (the private finals
cross-check), ADR 0032 and ADR 0033 (the second source's season history and its check) and ADR 0040 (disputed finals). It
changes no permission term, no page and no rating.

## Context
- The second source and MaxPreps sometimes name the same winner with different scores. ADR 0040 puts only a different winner
  on the disputed list; a game whose margin alone differs stays an ordinary final, scored as MaxPreps has it.
- A margin matters to the ratings, which fit margins. A wrong margin pulls a rating, so the question was whether these games
  should count for less.
- 2026, as of Nov 15: the two private reports below hold 842 games, 763 of them with both sources' scores. Leaving out 16
  with a forfeit-shaped score on one side, 4 with a different winner and 1 tie, 742 name the same winner. 694 of those have
  the same margin. The 48 others differ by 1 to 44 points: 23 by 1 or 2, 15 by 3 to 6, then a gap, with none at 7 and 10
  games at 8 or more (8, 8, 12, 14, 21, 21, 33, 38, 44, 44).

## Decision
- **The threshold is 7 points.** One touchdown is 6 points in six-man. Gaps of 6 or less are the common ones (a missed try,
  a touchdown given to the wrong quarter's total); the 2026 counts break there, and every gap above it is more than a score
  apart.
- **The list is private.** `tools/league-watch/margins.mjs` reads the two private reports that compare the sources: the finals
  cross-check (`davecampbells-<season>/finals-check.csv`) and the season's history check
  (`davecampbells-history-<season>/history-check.csv`). It writes `davecampbells-<season>/margin-check.csv` in the private
  data repo, one row a game: date, both programs, both scores and the gap. A game in both reports is judged by the finals
  check, the newer read. A different winner (ADR 0040), a tie, a forfeit-shaped score (1-0 or 2-0) on either side, or a
  missing score is never listed. Results watch runs it after the finals cross-check, under the same `SECOND_FINALS` switch,
  and commits the file by name with the cross-check's files (`commit-results.sh`).
- **Counts only in public.** The run summary gives the number of games compared and listed, never a team or a score, as ADR
  0026 allows for a disagreement. Nothing public holds a game of the list or a second-source score. The owner's `/admin` page
  shows nothing of it: `/admin` reads only the public repo, and no count of the cross-check is shown there today for this to
  join.
- **The ratings are unchanged.** MaxPreps' score stands, as it does for every final (ADR 0040). The backtest below found no
  gain from treating the listed games differently.

## The backtest (2026, today's settings: tau 25, logistic scale 14.56, the chain from 2018 of ADR 0057)
Each week of 2026 is predicted from earlier games only, as `run.py --backtest` does, scored always against MaxPreps' margins.
Only the training games change. 661 games are scored; the 10 listed games are among the training data.

| Variant | Log loss | Change (standard error) | Margin error | Change (standard error) |
|---|---|---|---|---|
| Today's model | 0.29277 | | 11.982 | |
| Listed games at the smaller of the two margins | 0.29275 | -0.00002 (0.00071) | 12.018 | +0.036 (0.027) |
| Listed games left out | 0.29383 | +0.00106 (0.00147) | 11.948 | -0.034 (0.058) |

The 652 games that are not on the list give the same picture. Every change is well inside one or two standard errors; neither
variant moves the winner picked by more than 3 games in 661. Down-weighting between the two (a weight between 1 and 0) cannot
do better than the two ends here. The season-end table would move: up to 6 rating points for a team with a listed game. That
is a reason to know the list, not a reason to change the ratings: the backtest cannot tell which source was right.

## Consequences
- A large margin disagreement is visible to the owner in the private repo, for a hand check against a third source; a
  correction still needs three agreeing sources or a cited fact (ADR 0011), through `data/corrections/games.csv`.
- If a later season's backtest shows a clear gain, a new ADR can let `run.py` read the private list as it reads other private
  inputs (`PRIVATE_DATA`), with nothing from it copied into public `data/ratings` beyond what the ratings already publish.
- The threshold is checked again when a season's history check is run: if the gaps stop breaking at 6, the number changes by
  a new ADR.
