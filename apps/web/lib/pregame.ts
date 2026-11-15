import { isDisputed, loadDisputed } from "./disputed";
import { gameKey, loadSeasonResults, playoffFields } from "./games";
import { memo } from "./memo";
import { project, projectionText, type Field, type Projection } from "./projection";
import { FEW_GAMES, loadRatings, type RatingsTable } from "./ratings";
import { slugify } from "./slug";

/**
 * What the ratings said before each game: both teams' ratings at the end of the week before (the table's `trend`), the home
 * edge and game-to-game noise as fit through that week (`week_home_field`, `week_sigma`), the `playoff_edge` share for a playoff
 * game and none for a State Championship (`playoffFields`). Keyed by game id (SeasonResult.id).
 *
 * A game is judged only once both teams had FEW_GAMES rated games by the week before (`rated_trend`: forfeits, no
 * contests and duplicates left out, as /rankings and services/ratings/backtest.py count them; week-before ratings were
 * well calibrated from there across 2021 to 2026: favorites given 80-90% won 83%), never a tie, never a forfeit's 1-0 or
 * 2-0, and never before the trend starts (week 4) or with a team unrated that week.
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
  const [table, games, playoffs] = await Promise.all([loadRatings(season), loadSeasonResults(season), playoffFields(season)]);
  const judged = new Map<string, Projection>();
  const snapshots = new Map<number, RatingsTable>(); // one table per week, shared by that week's games
  const ratedBy = new Map(table.teams.map((t) => [slugify(t.team), t.rated_trend ?? []])); // rated games through each week
  const enough = (team: string, week: number) => (ratedBy.get(slugify(team))?.[week] ?? 0) >= FEW_GAMES;
  for (const g of [...games].sort((a, b) => a.date.localeCompare(b.date))) {
    const week = (table.weeks ?? []).findLastIndex((w) => w < g.date); // the week projectBefore reads
    if (week < 0 || !enough(g.home, week) || !enough(g.away, week)) continue;
    if (judging && (g.homeScore === g.awayScore || g.forfeit)) continue;
    const p = projectBefore(table, g, playoffs.get(gameKey(g.date, g.home, g.away)) ?? false, snapshots);
    if (p) judged.set(g.id, p);
  }
  return judged;
}

/**
 * A game's projection from the ratings at the end of the week before it (`trend`, `week_home_field`, `week_sigma` at the
 * last week ending before its date), never the table's current ones. A week's values are fit on the games through that
 * Sunday (services/ratings/run.py with_trend), so rating the game itself, or any later one, leaves this unchanged.
 * Undefined before the trend starts or with a team unrated that week. `site`: the game's field (`playoffFields`), or true
 * for a playoff game's share, false for a home field. `snapshots` shares one table per week.
 */
export function projectBefore(
  table: RatingsTable,
  g: { date: string; home: string; away: string },
  site: boolean | Field,
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
  const f = typeof site === "boolean" ? { neutral: site } : site;
  return project(snapshot, g.home, g.away, f.neutral, f.trueNeutral ?? false);
}
