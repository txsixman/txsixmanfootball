# ADR 0020: Game scores from SixManFootball.com, with its owner's written permission

**Status:** Accepted Nov 13, 2026 (the owner). Supersedes ADR 0008's "No" for SixManFootball.com only; every other part
of ADR 0008 stands, and MaxPreps stays the backup source.

## Context
ADR 0008 ruled SixManFootball.com out because its robots.txt names AI crawlers (`anthropic-ai`, `ClaudeBot`,
`Claude-Web` and others) and its owner had not agreed to anything else. Since then:
- **The site's owner has given written permission** for this site to read its game scores. The permission is held by
  the owner of this project, outside this repository; neither the letter nor the site owner's name is kept here.
- Its robots.txt blocks AI-training crawlers by name, and its `User-agent: *` group allows the site apart from forum,
  account and admin paths. A score reader that is honestly named, is not an AI crawler and reads only score pages
  falls under that `*` group.

Fans want scores as games are played; this site is where Texas six-man scores are posted first.

## Decision
SixManFootball.com is the **primary** score source and MaxPreps (ADR 0008, 0015, 0019) the **backup**, under these
conditions. Breaking any one of them stops the reader until it is fixed:
1. **Honest identity:** `TXSixManFootballBot/1.0 (+https://txsixmanfootball.com/about; contact@txsixmanfootball.com)`.
   Never a browser's user agent, never a Claude or Anthropic one.
2. **robots.txt on every run:** read before any page; no robots.txt (not a 200) means no read. A Disallow for our agent
   or for `*` on a path means that path is never requested.
3. **Polite:** score and schedule pages only, never forum, account, search or admin paths. Only on a day with a bracket
   game still unscored (the `due` gate and 10-minute cadence of ADR 0019). One request at a time, a few seconds apart;
   a 429 or 5xx backs off (honouring `Retry-After`) and ends the run after repeated failures.
4. **Scores only:** date, teams, score, period or final. No posts, articles, comments, photos, logos or other text is
   copied or kept. Nothing read is ever used to train an AI model.
5. **Display unchanged:** scores stay unconfirmed and name no winner (ADRs 0004, 0013); pages name no source (ADRs
   0009, 0010); the source page stays in the private captures (ADR 0017).
6. **Stop on request:** if the site's owner withdraws permission or asks for a change, the reader stops or changes the
   same day.

## Consequences
- Finals, and later scores of games under way, can come from the site where they are posted first.
- Two sources agreeing on a score could later count toward confirming it (ADR 0011). That is the owner's call and is
  not part of this decision.
- Logos still never come from SixManFootball.com (ADRs 0006, 0016).
- The partnership hard lines (plan section 15) stand: no poaching, no disparaging, its name used only as permitted.
