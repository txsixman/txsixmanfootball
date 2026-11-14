import type { Outcome } from "./outcome";
import type { Game } from "./demo-games";

export type Side = "home" | "away";

export const isForfeit = (g: Game) => /forfeit/i.test(g.endReason ?? "");

function ahead(g: Game): Side | null {
  if (g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return null;
  return g.homeScore > g.awayScore ? "home" : "away";
}

/** Only a confirmed final names a winner. An unconfirmed or disputed score crowns nobody. */
export function winnerOf(g: Game): Side | null {
  return g.state === "final" && g.verification === "confirmed" ? ahead(g) : null;
}

/** The side to highlight: the confirmed winner, or the leader of a confirmed live game. */
export function leaderOf(g: Game): Side | null {
  if (g.state === "live" && g.verification === "confirmed") return ahead(g);
  return isForfeit(g) ? null : winnerOf(g);
}

/** The quarter being played now. Zero at halftime or when the game is not live. */
export function currentPeriod(g: Game): number {
  if (g.state !== "live") return 0;
  const quarter = /^Q(\d)/.exec(g.status);
  return quarter ? Number(quarter[1]) : 0;
}

/** How many quarters happened. A game ended by the 45-point rule stops early. */
export function playedPeriods(g: Game): number {
  const text = g.state === "live" ? g.status : (g.endReason ?? "");
  if (/half/i.test(text)) return 2;
  const quarter = /Q(\d)/.exec(text);
  return quarter ? Number(quarter[1]) : 4;
}

/** A scoreboard game's outcome so far, for its "Projected: … · Final: …" line (lib/outcome.ts). */
export const outcomeOf = (g: Game): Outcome => ({
  home: g.home.name,
  away: g.away.name,
  homeScore: g.homeScore,
  awayScore: g.awayScore,
  state: g.state,
  disputed: g.verification === "disputed",
  forfeit: isForfeit(g),
  unconfirmed: g.verification === "unconfirmed",
});
