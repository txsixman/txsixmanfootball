# ADR 0008: Game results read from MaxPreps

**Status:** Accepted Nov 10, 2026 (the owner: "just scrape", after the risks below were put to him twice).
Supersedes ADR 0002's ban on other sites' compilations **for game results only**, and ADR 0007's hand-entry rule.
ADR 0002 still governs everything else (history, rankings, stories, photos, logos).

## Context
The owner will not hand-enter about 785 regular-season games. He asked for results from SixManFootball.com, MaxPreps and
Dave Campbell's Texas Football, with people also able to enter schedules. Each site's robots.txt was read on
Nov 10, 2026:

| Site | What robots.txt and the pages say | Used? |
|---|---|---|
| SixManFootball.com | Blocks `anthropic-ai`, `ClaudeBot` and `Claude-Web` (and other AI crawlers) from the whole site | **No.** Its owner opted out of Claude by name; we do not get around that with another user agent |
| Dave Campbell's (davecampbells.com) | Six-man team pages carry no schedule or results; scores load from `/api`, which robots.txt disallows | **No.** Nothing readable without breaking robots.txt |
| MaxPreps | Disallows `/team/`, `/school/`, `/scores/`, `/contest/`; allows team schedule pages `/tx/<city>/<team>/football/schedule/` | **Yes**, schedule pages only |

## Decision
- `tools/league-watch/maxpreps.mjs` reads **team schedule pages only** (a regex refuses any other path), one request
  every 2.5 seconds, each page once a run, with a plain user agent. Never MaxPreps' APIs.
- It starts from seed teams and follows opponents who are in our alignments, so it walks the six-man network.
- **Facts only:** date, home and away team, final score. No narratives, stats, players, photos, rankings or logos.
- Output: `data/seed/maxpreps-2026/games.csv` (same columns as the capture files; `end_reason` is `unknown`, so the
  ratings treat a 45-point margin as possibly ended by the rule) and `coverage.txt` (schools not reached). Written by
  the reader, never by hand.
- **Every row keeps its MaxPreps game URL** as `source_url`, so a correction or takedown can find it.
- **Stop on request:** if MaxPreps asks, the reader is switched off and its rows are removed the same day.
- Hand-captured playoff games (`playoffs-2026.csv`) win over a MaxPreps row for the same game.
- **Runs by itself:** `.github/workflows/results-watch.yml` reads Friday, Saturday and Sunday mornings, August to
  January, rerates the season (`services/ratings/run.py --season`) and commits both to `main`; Vercel deploys it.
  Each season gets its own `data/seed/maxpreps-<year>/`; a new season starts from last season's `teams.csv`.
- A school MaxPreps names differently goes in `tools/league-watch/maxpreps-aliases.json` (MaxPreps name to ours).
- People entering schedules and scores themselves stays the plan (Phase 3 score entry).

## Risks the owner accepted
1. **MaxPreps terms of use** forbid automated collection. CBS can block the reader or send a demand letter, aimed at
   the owner personally until an LLC exists.
2. **The SixManFootball.com partnership (plan section 15)** is weaker: its owner may see results sourced from a
   competitor he cannot audit. We do not read his site.
3. **Data quality:** MaxPreps scores are entered by coaches and fans; they are unconfirmed under ADR 0004.

## Consequences
- Ratings run on the regular season, not one playoff game a team.
- `CLAUDE.md`'s hard rule now reads: never SixManFootball.com, never CalPreps, MaxPreps schedule pages only under
  this ADR.
