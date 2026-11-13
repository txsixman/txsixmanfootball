import { loadBrackets } from "./brackets";
import { memo } from "./memo";
import { schoolAlignments, teamInOrg } from "./org-games";
import { ORGS, type Org } from "./orgs";
import { pregame } from "./pregame";
import { FEW_GAMES, movement, type RatingRow } from "./ratings";
import type { SeasonResult } from "./season-results";
import { advancement, biggestMargins, closestGames, furthestFromProjection, ratingMovers, weekEnd, type Advance, type Mover, type Off } from "./week-review";
import { rankingWeeks, weekRows } from "./week-rankings";
import { loadWeeks, resultSeasons, type Week } from "./weeks";

// One week of one organization, reviewed (/weeks/<season>/<week>): the same weeks as the Results pages (Monday to Sunday, week
// 1 holds the season's first game), the games with a team in the organization (ADR 0012), robot-read scores that are
// unconfirmed (ADR 0004), so nothing here names the winner of a game.

/** A rating mover with where it stands within the organization now (`place`) and the places it moved in the week. */
export type PlacedMover = Mover & { place: number; moved: number | "new" | undefined };
export type WeekReview = {
  org: Org;
  season: number;
  week: number;
  monday: string;
  sunday: string;
  games: SeasonResult[];
  /** False for a week with no rating column (the ratings are tracked from a season's fourth week). */
  tracked: boolean;
  rises: PlacedMover[];
  drops: PlacedMover[];
  furthest: Off[];
  closest: SeasonResult[];
  biggest: SeasonResult[];
  advanced: Advance[];
};

/** A season's weeks for one organization, shared by every page that asks (about 370 week pages, each wants its neighbors). */
const weeksOf = memo(async (key: string): Promise<Week[]> => {
  const [season, slug] = key.split("|");
  return loadWeeks(Number(season), ORGS.find((o) => o.slug === slug));
});
export const orgWeeks = (season: number, org: Org) => weeksOf(`${season}|${org.slug}`);

/** The weeks of an organization's season that have a page: those with at least one of its games, in order. */
export const reviewedWeeks = async (season: number, org: Org): Promise<Week[]> => (await orgWeeks(season, org)).filter((w) => w.games.length);

/** Every (season, week) that has a page for the organization, newest season first, weeks in order. */
export async function reviewPages(org: Org): Promise<{ season: number; week: number }[]> {
  const seasons = await resultSeasons(org);
  return (await Promise.all(seasons.map(async (season) => (await reviewedWeeks(season, org)).map((w) => ({ season, week: w.number }))))).flat();
}

/** The newest week with a game for the organization (UIL by default): what the home and Scores pages link to, decided at build. */
export async function latestReview(org: Org = ORGS[0]): Promise<{ season: number; week: number } | undefined> {
  const [season] = await resultSeasons(org);
  const week = season === undefined ? undefined : (await reviewedWeeks(season, org)).at(-1);
  return week && { season, week: week.number };
}

export async function loadWeekReview(org: Org, season: number, number: number): Promise<WeekReview | undefined> {
  const shown = (await orgWeeks(season, org)).find((w) => w.number === number);
  if (!shown?.games.length) return undefined;
  const sunday = weekEnd(shown.monday);
  const [schools, before, brackets, columns] = await Promise.all([schoolAlignments(), pregame(season), loadBrackets(season), rankingWeeks(season)]);
  const column = columns.find((w) => w.number === number);
  // Rank counted among this organization's teams, as the Rankings page counts it (ADR 0012).
  const rows: RatingRow[] = column ? (await weekRows(season, column)).filter((r) => teamInOrg(schools, org, r.team)) : [];
  const ranked = rows.filter((r) => r.rated >= FEW_GAMES);
  const moved = movement(ranked);
  const placed = (m: Mover): PlacedMover => ({ ...m, place: ranked.findIndex((r) => r.team === m.team) + 1, moved: moved?.get(m.team) });
  const { rises, drops } = ratingMovers(rows, FEW_GAMES);
  return {
    org,
    season,
    week: number,
    monday: shown.monday,
    sunday,
    games: shown.games,
    tracked: Boolean(column) && column!.index > 0,
    rises: rises.map(placed),
    drops: drops.map(placed),
    furthest: furthestFromProjection(shown.games, before),
    closest: closestGames(shown.games),
    biggest: biggestMargins(shown.games),
    advanced: advancement(brackets.filter((b) => b.league === org.league), shown.monday, sunday),
  };
}
