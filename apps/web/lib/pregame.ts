import { isDisputed, loadDisputed } from "./disputed";
import { gameKey, loadSeasonResults, playoffGameKeys } from "./games";
import { memo } from "./memo";
import { project, projectionText, type Projection } from "./projection";
import { loadRatings, type RatingsTable } from "./ratings";

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
export const pregame = memo((season: number) => before(season, true));

/**
 * The same projections for display beside a game's outcome ("Projected: … · Final: …"): also ties and forfeits, which are
 * left out only of judging how the ratings did. Keyed by game id, and by `gameKey` for a bracket game, which has an id of
 * its own. Only ratings from the week before the game: never the table's current ones, which already count it.
 */
export const pregameShown = memo(async (season: number) => {
  const byId = await before(season, false);
  const games = await loadSeasonResults(season);
  return { byId, byKey: new Map(games.flatMap((g) => (byId.has(g.id) ? [[gameKey(g.date, g.home, g.away), byId.get(g.id)!] as const] : []))) };
});

/** What a program row needs to show "Projected: … · Final: …" (lib/program-games.ts): each result's projection text from the
 * week before, by id, and the ids of the season's disputed finals, which name no winner (ADR 0040). */
export type ShownBefore = { before: ReadonlyMap<string, string>; disputed: ReadonlySet<string> };

export const shownBefore = memo(async (season: number): Promise<ShownBefore> => {
  const [{ byId }, disputed, games] = await Promise.all([pregameShown(season), loadDisputed(season), loadSeasonResults(season)]);
  return {
    before: new Map([...byId].map(([id, p]) => [id, projectionText(p)])),
    disputed: new Set(games.filter((g) => isDisputed(disputed, g.date, g.home, g.away)).map((g) => g.id)),
  };
});

async function before(season: number, judging: boolean): Promise<Map<string, Projection>> {
  const [table, games, playoffs] = await Promise.all([loadRatings(season), loadSeasonResults(season), playoffGameKeys(season)]);
  const judged = new Map<string, Projection>();
  const snapshots = new Map<number, RatingsTable>(); // one table per week, shared by that week's games
  const played = new Map<string, number>(); // games each team had played before this one
  for (const g of [...games].sort((a, b) => a.date.localeCompare(b.date))) {
    const earlier = Math.min(played.get(g.home) ?? 0, played.get(g.away) ?? 0);
    for (const t of [g.home, g.away]) played.set(t, (played.get(t) ?? 0) + 1);
    if (earlier < 4 || (judging && (g.homeScore === g.awayScore || g.forfeit))) continue;
    const p = projectBefore(table, g, playoffs.has(gameKey(g.date, g.home, g.away)), snapshots);
    if (p) judged.set(g.id, p);
  }
  return judged;
}

/**
 * A game's projection from the ratings at the end of the week before it (`trend`, `week_home_field`, `week_sigma` at the
 * last week ending before its date), never the table's current ones. A week's values are fit on the games through that
 * Sunday (services/ratings/run.py with_trend), so rating the game itself, or any later one, leaves this unchanged.
 * Undefined before the trend starts or with a team unrated that week. `snapshots` shares one table per week.
 */
export function projectBefore(
  table: RatingsTable,
  g: { date: string; home: string; away: string },
  playoff: boolean,
  snapshots = new Map<number, RatingsTable>(),
): Projection | undefined {
  const week = (table.weeks ?? []).findLastIndex((w) => w < g.date);
  if (week < 0) return undefined;
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
  return project(snapshot, g.home, g.away, playoff);
}
