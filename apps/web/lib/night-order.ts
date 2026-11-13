import type { NightGame } from "./tonight";

/** A round's games as a fan wants them on the night: under way first, then not started, then finished (a forfeit with
 * the finals); the round's own order within each. `isLive` says which games have a live score now (read in the browser). */
export function nightOrder<G extends Pick<NightGame, "state">>(games: G[], isLive: (g: G) => boolean): G[] {
  const rank = (g: G) => (g.state !== "later" ? 2 : isLive(g) ? 0 : 1);
  return games.map((g, i) => ({ g, i, r: rank(g) })).sort((a, b) => a.r - b.r || a.i - b.i).map(({ g }) => g);
}
