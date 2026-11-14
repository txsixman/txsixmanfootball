import type { SeasonResult } from "./season-results";

// Team leaders for a season's hub page: points scored and points allowed per game. Robot-read scores are unconfirmed
// (ADR 0004), so these are averages from unconfirmed scores; a forfeit (recorded 1-0 or 2-0) is left out of everything,
// the game count too, because its recorded score is not a score (lib/forfeit.ts).

/** A team needs this many played (non-forfeit) games in the season to be listed. */
export const LEADER_MIN_GAMES = 6;

export type Leader = { team: string; games: number; average: number };

/** The top `top` teams by points scored per game (most first) and by points allowed per game (fewest first), among the
 * teams `include` accepts that played at least `min` games. Ties go to the team with more games, then by name. */
export function teamLeaders(
  games: Pick<SeasonResult, "home" | "away" | "homeScore" | "awayScore" | "forfeit">[],
  include: (team: string) => boolean,
  { min = LEADER_MIN_GAMES, top = 3 }: { min?: number; top?: number } = {},
): { scored: Leader[]; allowed: Leader[] } {
  const totals = new Map<string, { games: number; scored: number; allowed: number }>();
  const add = (team: string, scored: number, allowed: number) => {
    if (!include(team)) return;
    const t = totals.get(team) ?? { games: 0, scored: 0, allowed: 0 };
    t.games += 1;
    t.scored += scored;
    t.allowed += allowed;
    totals.set(team, t);
  };
  for (const g of games) {
    if (g.forfeit) continue;
    add(g.home, g.homeScore, g.awayScore);
    add(g.away, g.awayScore, g.homeScore);
  }
  const eligible = [...totals].filter(([, t]) => t.games >= min);
  const rank = (value: (t: { scored: number; allowed: number }) => number, direction: 1 | -1): Leader[] =>
    eligible
      .map(([team, t]) => ({ team, games: t.games, average: value(t) / t.games }))
      .sort((a, b) => direction * (a.average - b.average) || b.games - a.games || a.team.localeCompare(b.team))
      .slice(0, top);
  return { scored: rank((t) => t.scored, -1), allowed: rank((t) => t.allowed, 1) };
}
