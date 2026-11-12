# ADR 0011: Records may name winners from unconfirmed scores; three agreeing sources confirm a score

**Status:** Accepted Nov 11, 2026 (the owner: "Allow new adr and if more than two sources show correct it is confirmed").
Narrows ADR 0004's "only a confirmed final names a winner" for the Records page, and adds a way for a robot-read
score to become confirmed.

## Decision
- **Records page exception.** `/records` may name winners from unconfirmed scores: longest winning runs, unbeaten
  seasons and biggest upsets. The page keeps its note that scores are not confirmed and may change. Every other page
  keeps ADR 0004 as written: a scoreboard or game page names a winner only for a confirmed final.
- **Confirmation by agreement.** A score is confirmed when **more than two** independent sources (three or more) show
  the same final. Each source must be one the project may use (ADRs 0002, 0005, 0008); SixManFootball.com and
  CalPreps never count. A source that copies another (the same feed shown on two sites) counts once.
- Forfeits still show W and L, never the recorded 1-0 or 2-0 (ADR 0004).
- Sources stay in the data, never on the page (ADR 0010); the page shows only the label (Confirmed, Unconfirmed,
  Disputed).

## Consequences
- Records can show winning runs and upsets now, from the robot-read results of ADR 0008.
- Today every robot-read score has one source, so none is confirmed yet. Confirming needs a per-game source count in
  the data: a second and third permitted source (hand capture, league pages, school sites, coach reports) recorded
  against the same game. That is new work; until it lands, the confirmation rule has nothing to act on.
- Sources that disagree mark the game Disputed (ADR 0004), whatever the count.
