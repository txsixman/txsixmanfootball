import type { WinChance } from "./advancement";
import type { PlayoffGame } from "./games";
import { project, projectAt } from "./projection";
import { FEW_GAMES, type RatingsTable } from "./ratings";
import { slugify } from "./slug";

/**
 * The per-game win chance the game pages show (lib/projection.ts), for the bracket's advancement chances (ADR 0071): a
 * listed game at its own site, a pairing no site lists yet on a neutral field. undefined for a team with fewer than
 * FEW_GAMES rated games, too few to project.
 */
export function winChance(table: RatingsTable): WinChance<PlayoffGame> {
  const rated = new Map(table.teams.map((t) => [slugify(t.team), t.rated]));
  const enough = (team: string) => (rated.get(slugify(team)) ?? 0) >= FEW_GAMES;
  return (a, b, game) => {
    if (!enough(a) || !enough(b)) return undefined;
    const p = game ? projectAt(table, game) : project(table, a, b, true, true);
    return p && (p.favorite === a ? p.winProbability : 1 - p.winProbability);
  };
}
