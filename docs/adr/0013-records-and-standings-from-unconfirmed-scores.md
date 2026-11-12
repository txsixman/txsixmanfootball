# ADR 0013: W-L records, standings and bracket advancement may come from unconfirmed scores

**Status:** Accepted Nov 11, 2026 (the owner chose "New ADR: records exempt"). Widens ADR 0011's Records-page exception;
ADR 0004 is otherwise unchanged.

## Context
ADR 0004 says only a confirmed final names a winner. ADR 0011 exempted the Records page. An audit (Nov 11) found that
other pages already rest on who won robot-read games, none of them confirmed yet: W-L columns on Rankings and the
weekly tables, district and overall records on Standings, records and "record against each" on program pages and
Matchup, and the Playoffs brackets, whose later rounds list the teams that advanced.

## Decision
- **W-L records, standings places and bracket advancement** may be computed from unconfirmed robot-read scores.
- Every page that shows them keeps its plain note that scores are not confirmed here and may change.
- **A game row still names no winner** unless its final is confirmed (ADR 0004): scoreboards, Results weeks, game
  pages and a program's list of games show the two scores and no "won", "beat" or winner marking.
- Forfeits still show W and L or the word, never the recorded 1-0 or 2-0 (ADR 0004).
- Confirmation stays as ADR 0011 defines it: three or more agreeing permitted sources.

## Consequences
- No visible change today: this writes down what the site already does, so the rule and the pages agree.
- When a score is corrected, every record, standings place and bracket built on it changes on the next build.
- Wording kept as is (the owner, Nov 11): projections read "Team by N · P% win probability" and `/rankings/how` says
  "favorite". Both are statements of the model, not betting terms (rating, projected margin and win probability stay
  the only numbers shown). Revisit at the attorney review before launch (ADR 0002).
