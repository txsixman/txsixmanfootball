// What was projected and what happened, side by side (ADR 0044): "Projected: Oglesby by 45+ · 99% chance to win · Final:
// Oglesby by 52". The projection is the one from before the game (lib/pregame.ts for a game already played), so a miss
// reads as one: "Projected: Jayton by 7 · 74% chance to win · Final: Guthrie by 3". Pure, no imports: the node tests run it
// as it is. No betting word, and no "upset" label.

/** A game's outcome so far, as the pages hold it. `live`: under way, with the live read's score. */
export type Outcome = {
  home: string;
  away: string;
  homeScore?: number | null;
  awayScore?: number | null;
  state: "final" | "live" | "scheduled" | "postponed";
  disputed?: boolean;
  forfeit?: boolean;
  /** A final score not confirmed yet (a live read that saw the game end): it names no winner. */
  unconfirmed?: boolean;
};

/**
 * What happened, in the projection's terms:
 * - a final: "Final: Oglesby by 52", or "Final: tied";
 * - a forfeit: "Forfeit" (never its 1-0 or 2-0, ADR 0004);
 * - a disputed final: "Disputed", with no winner (ADR 0040);
 * - a final not confirmed yet: "Reported: 14–28 · Unconfirmed", with no winner;
 * - a game under way: "Now: 14–28 · Unconfirmed" (away first, as the pages list the teams), or "Now: tied". A live score
 *   names no leader (ADR 0021);
 * - nothing yet: undefined.
 */
export function outcomeText(o: Outcome): string | undefined {
  if (o.forfeit) return "Forfeit";
  const scored = o.homeScore != null && o.awayScore != null;
  if (o.state === "final") {
    if (o.disputed) return "Disputed";
    if (!scored) return undefined;
    if (o.unconfirmed) return `Reported: ${o.awayScore}–${o.homeScore} · Unconfirmed`;
    if (o.homeScore === o.awayScore) return "Final: tied";
    const [winner, by] = o.homeScore! > o.awayScore! ? [o.home, o.homeScore! - o.awayScore!] : [o.away, o.awayScore! - o.homeScore!];
    return `Final: ${winner} by ${by}`;
  }
  if (o.state === "live" && scored) return o.homeScore === o.awayScore ? "Now: tied" : `Now: ${o.awayScore}–${o.homeScore} · Unconfirmed`;
  return undefined;
}

/** "Projected: <projection text> · <outcome>", the outcome left out while there is none; undefined with no projection. */
export function projectedLine(projected: string | undefined, o?: Outcome): string | undefined {
  if (!projected) return undefined;
  return [`Projected: ${projected}`, o && outcomeText(o)].filter(Boolean).join(" · ");
}

/** A robot-read result's outcome: a final, a forfeit, or disputed when the sources give it different winners (ADR 0040). */
export const resultOutcome = (r: { home: string; away: string; homeScore: number; awayScore: number; forfeit: boolean }, disputed = false): Outcome => ({
  home: r.home,
  away: r.away,
  homeScore: r.homeScore,
  awayScore: r.awayScore,
  state: "final",
  disputed,
  forfeit: r.forfeit,
});
