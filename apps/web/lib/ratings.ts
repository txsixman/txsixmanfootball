import { readdir, readFile } from "node:fs/promises";
import { memo } from "./memo";
import path from "node:path";
import { RatingsTable as RatingsSchema, parseJson } from "./data-schemas";

// Written by services/ratings/run.py --season, from hand captures and robot-read results (ADR 0008). CI and the
// results-watch workflow rewrite data/ratings/<season>.json; the site leads with the latest season.
/** `rated`: games against listed schools the rating rests on (played, not a forfeit, a no contest or a duplicate), the ONE
 * definition (services/ratings/rows.py); `rated_outside`: its games against schools we do not list, which also inform it.
 * `sd`: the rating's standard deviation (rating +/- sd is a range the data cannot tell apart). `was`: the rating through
 * the Sunday before the latest results week, null if unrated then. `trend`, `rated_trend`: the rating and `rated` through
 * each week in the table's `weeks`, null before the team had a rated game. */
export type RatingRow = {
  team: string; rating: number; rated: number; won: number; lost: number; tied: number;
  sd?: number; rated_outside?: number; was?: number | null; trend?: (number | null)[]; rated_trend?: (number | null)[];
};

/** A rating must move more than this many points in a week before the rankings show an arrow: smaller moves are noise
 * (a rating's standard deviation is about 10 points). */
export const MOVE_THRESHOLD = 4;

/** Places moved since a week earlier, within the rows shown (a tab ranks only its own teams): +3 is up three, "new"
 * for a team unrated a week ago, undefined when the table carries no week-earlier ratings. 0 when the rating moved by
 * MOVE_THRESHOLD points or less, whatever the places did. */
export function movement(rows: RatingRow[]): Map<string, number | "new"> | undefined {
  if (!rows.some((r) => r.was !== undefined)) return undefined;
  const before = rows.filter((r) => r.was != null).sort((a, b) => b.was! - a.was! || a.team.localeCompare(b.team));
  const placeBefore = new Map(before.map((r, i) => [r.team, i + 1]));
  return new Map(
    rows.map((r, i) => [
      r.team,
      !placeBefore.has(r.team) ? "new" : Math.abs(r.rating - r.was!) > MOVE_THRESHOLD ? placeBefore.get(r.team)! - (i + 1) : 0,
    ]),
  );
}

/** Below this many rated games a rating is marked: one result can move it a long way. */
export const FEW_GAMES = 4;
/** How a projected margin becomes a win probability (services/ratings/model.py CALIBRATION): logistic, `scale` points. */
type Calibration = { family: "logistic"; scale: number };
/**
 * home_field and sigma: the model's home edge and game-to-game spread, for projections (lib/projection.ts). `calibration`
 * turns a margin into a win probability (sigma is not in it: a constant scale fit the walk-forward games better).
 * `playoff_edge`: the share of home_field a robot-read playoff game's listed home team gets (those sites are mostly
 * neutral). `week_home_field`, `week_sigma`: the same two numbers as fit through each of `weeks` (same order as `trend`).
 * `group_means`: each group's mean rating (UIL I, UIL II, TAPPS, TAIAO, TCAF, Independent); `report`: what the fit left out.
 */
export type RatingsTable = {
  season?: number; games: number; games_outside?: number; home_field?: number; sigma?: number; playoff_edge?: number;
  calibration?: Calibration; group_means?: Record<string, number>; weeks?: string[]; week_home_field?: (number | null)[];
  week_sigma?: (number | null)[]; report?: Record<string, number>; teams: RatingRow[];
};

const DIR = () => path.join(process.cwd(), "../../data/ratings");

/** Seasons with a ratings table, newest first. Read once per process (about 15 calls a program page): never mutate it. */
export const ratingSeasons = memo<void, number[]>(async () =>
  (await readdir(DIR())).filter((f) => /^\d{4}\.json$/.test(f)).map((f) => Number(f.slice(0, 4))).sort((a, b) => b - a),
);

/** A season's table; the latest season when none is named. Shared across pages: never mutate it. */
export async function loadRatings(season?: number): Promise<RatingsTable & { season: number; file: string }> {
  return readTable(season ?? (await ratingSeasons())[0]);
}

const readTable = memo(async (year: number | undefined): Promise<RatingsTable & { season: number; file: string }> => {
  if (!year) throw new Error("no data/ratings/<season>.json; run services/ratings/run.py --season <year>");
  const file = `${year}.json`;
  const table: RatingsTable = parseJson(`data/ratings/${file}`, await readFile(path.join(DIR(), file), "utf8"), RatingsSchema);
  return { ...table, season: year, file: `data/ratings/${file}` };
});

export const record = ({ won, lost, tied }: Pick<RatingRow, "won" | "lost" | "tied">) => (tied ? `${won}-${lost}-${tied}` : `${won}-${lost}`);

export { signed } from "./signed";
