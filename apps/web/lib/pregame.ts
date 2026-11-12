import { gameKey, loadSeasonResults, playoffGameKeys } from "./games";
import { memo } from "./memo";
import { project, type Projection } from "./projection";
import { loadRatings } from "./ratings";

/**
 * What the ratings said before each game: both teams' ratings at the end of the week before (the table's `trend`), the home
 * edge and spread as fit through that week (`week_home_field`, `week_sigma`), a partial home edge for playoff games
 * (`playoff_edge`). Keyed by game id (SeasonResult.id).
 *
 * A game is judged only once both teams had played 4 games (week-before ratings were well calibrated from there across
 * 2021 to 2026: favorites given 80-90% won 83%), never a tie, never a forfeit's 1-0 or 2-0, and never before the trend
 * starts (week 4) or with a team unrated that week.
 *
 * Every Results week page and the Records page ask for the same season: it is worked out once per build worker, and
 * shared, so never mutate it.
 */
export const pregame = memo(async (season: number): Promise<Map<string, Projection>> => {
  const [table, games, playoffs] = await Promise.all([loadRatings(season), loadSeasonResults(season), playoffGameKeys(season)]);
  const weeks = table.weeks ?? [];
  const judged = new Map<string, Projection>();
  const snapshots = new Map<number, typeof table>(); // one table per week, shared by that week's games
  const played = new Map<string, number>(); // games each team had played before this one
  for (const g of [...games].sort((a, b) => a.date.localeCompare(b.date))) {
    const before = Math.min(played.get(g.home) ?? 0, played.get(g.away) ?? 0);
    for (const t of [g.home, g.away]) played.set(t, (played.get(t) ?? 0) + 1);
    if (before < 4 || g.homeScore === g.awayScore || g.forfeit) continue;
    const week = weeks.findLastIndex((w) => w < g.date);
    if (week < 0) continue;
    let snapshot = snapshots.get(week);
    if (!snapshot) {
      snapshot = {
        ...table,
        home_field: table.week_home_field?.[week] ?? table.home_field,
        sigma: table.week_sigma?.[week] ?? table.sigma,
        teams: table.teams.flatMap((t) => (t.trend?.[week] != null ? [{ ...t, rating: t.trend[week]! }] : [])),
      };
      snapshots.set(week, snapshot);
    }
    const p = project(snapshot, g.home, g.away, playoffs.has(gameKey(g.date, g.home, g.away)));
    if (p) judged.set(g.id, p);
  }
  return judged;
});
