# ADR 0050: Late finals count a night as over from 3:00 AM Central

**Status:** Proposed Nov 14, 2026; accepted when its pull request is merged. It changes one point of ADR 0046 (when a
game night is over for the late-final fill and the missing-finals alert) and nothing else ADR 0046 decided.

## Context
- ADR 0046 counted a bracket game as late from 6:00 AM Central the morning after its game night (the readers' own
  `gameNight` boundary).
- The late-final step runs only on the morning read, scheduled at 11:23 UTC on Fridays, Saturdays and Sundays, and on a
  dispatch that is not a game-day read. From November to March, 11:23 UTC is 5:23 AM Central, before 6:00 AM.
- So an on-time morning read treated the night just played as "tonight": it filled nothing and raised no alert for it.
  The Sunday read missed Saturday's games, and the next morning read is on Friday. It only worked when GitHub started the
  read late.

## Decision
- For the late-final fill and the missing-finals alert, a game night is over from 3:00 AM Central the next morning
  (`nightOver` in `tools/league-watch/late-finals.mjs`). The 6:00 AM `gameNight` boundary of the readers is unchanged.
- The tests pin both edges (2:59 AM not over, 3:00 AM over) and the morning read's own time in November and October.

## Consequences
- Each morning read checks the night before, whether or not GitHub starts it on time.
- A dispatch between 3:00 and 6:00 AM Central can now name a game that ran very late as missing. That is an alert only,
  and the next read clears it once a score is in.
