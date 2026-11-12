import { loadSeasonResults, type SeasonResult } from "./games";
import { gameInOrg, schoolAlignments } from "./org-games";
import type { Org } from "./orgs";
import { ratingSeasons } from "./ratings";

// A season's results week by week. A week runs Monday to Sunday; week 1 holds the season's first game.
export type Week = { number: number; monday: string; games: SeasonResult[] };

const DAY = 86_400_000;
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};

/** Every week with a game, in order; games in a week by date, then home team. With `org`, each week holds only the
 * games with a team in that organization (ADR 0012), but the weeks stay the season's, so a week number means the same
 * thing in every organization and a week with none of its games is empty rather than missing. */
export async function loadWeeks(season: number, org?: Org): Promise<Week[]> {
  const schools = org && (await schoolAlignments());
  const games = [...(await loadSeasonResults(season))].sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
  if (!games.length) return [];
  const first = Date.parse(`${mondayOf(games[0].date)}T12:00:00Z`);
  const weeks = new Map<number, Week>();
  for (const g of games) {
    const monday = mondayOf(g.date);
    const number = Math.round((Date.parse(`${monday}T12:00:00Z`) - first) / (7 * DAY)) + 1;
    if (!weeks.has(number)) weeks.set(number, { number, monday, games: [] });
    if (!schools || gameInOrg(schools, org, g)) weeks.get(number)!.games.push(g);
  }
  return [...weeks.values()];
}

/** Seasons that have results, newest first; with `org`, only seasons with a game involving one of its teams. */
export async function resultSeasons(org?: Org): Promise<number[]> {
  const seasons = await ratingSeasons();
  const schools = org && (await schoolAlignments());
  const withGames = await Promise.all(
    seasons.map(async (s) => {
      const games = await loadSeasonResults(s);
      return (schools ? games.some((g) => gameInOrg(schools, org, g)) : games.length) ? s : undefined;
    }),
  );
  return withGames.filter((s) => s !== undefined);
}

/** "Aug 24": the Monday a week starts. */
export const weekLabel = (monday: string) =>
  new Date(`${monday}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
