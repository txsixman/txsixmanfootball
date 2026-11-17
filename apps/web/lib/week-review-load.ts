import { loadAlignments } from "./alignments";
import { loadBrackets } from "./brackets";
import { isDisputed, loadDisputed } from "./disputed";
import { gameKey, loadPlayoffGames, loadSeasonResults, type PlayoffGame } from "./games";
import { loadLineage, successorOf } from "./lineage";
import { memo } from "./memo";
import { schoolAlignments, teamInOrg } from "./org-games";
import { ORGS, type Org } from "./orgs";
import { pregame } from "./pregame";
import { FEW_GAMES, movement, type RatingRow } from "./ratings";
import { CURRENT_SEASON, FIRST_SEASON } from "./season";
import type { SeasonResult } from "./season-results";
import { slugify } from "./slug";
import { STATE_ROUNDS } from "./state-finals";
import { titleHistory } from "./title-history";
import { advancement, closestGames, furthestFromProjection, ratingMovers, weekEnd, type Advance, type Mover, type Off } from "./week-review";
import {
  biggestWins, firstLosses, firstPlayoffWins, firstWinsIn, oneScoreGames, streakChanges, teamSequences, upsets,
  type Decided, type StreakChange, type Upset,
} from "./week-recap";
import { rankingWeeks, weekRows } from "./week-rankings";
import { loadWeeks, resultSeasons, type Week } from "./weeks";

// One week of one organization, reviewed (/weeks/<season>/<week>): the same weeks as the Results pages (Monday to Sunday, week
// 1 holds the season's first game), the games with a team in the organization (ADR 0012), robot-read scores that are
// unconfirmed (ADR 0004), so nothing here names the winner of a game.

/** A rating mover with where it stands within the organization now (`place`) and the places it moved in the week. */
export type PlacedMover = Mover & { place: number; moved: number | "new" | undefined };
/** A streak that ended or reached a mark this week, with the game that ended it or its latest game. */
export type RecapStreak = StreakChange & { game: SeasonResult };
/** A first, from the data held here: a first playoff win, a first State Championship game, or an unbeaten team's first loss of the season. */
export type Milestone = { kind: "state-game" | "playoff-win" | "first-loss"; team: string; game: SeasonResult; unbeaten?: number };

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
  /** The game decided by the fewest points, whatever the margin (the home page's card). */
  closest?: SeasonResult;
  /** Games decided by one score or less, closest first. */
  oneScore: SeasonResult[];
  /** The week's wins by the most points. */
  wins: Decided[];
  /** Games the team with the lower chance to win won, lowest chance first, and how many games had a projection to judge by. */
  upsets: Upset[];
  judged: number;
  streaks: RecapStreak[];
  milestones: Milestone[];
  /** Game ids whose finals the sources dispute (ADR 0040): they name no winner. */
  disputed: ReadonlySet<string>;
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

/** The ids of a season's games whose finals the sources dispute (ADR 0040). */
export const disputedIds = memo(async (season: number): Promise<ReadonlySet<string>> => {
  const [games, disputed] = await Promise.all([loadSeasonResults(season), loadDisputed(season)]);
  return new Set(games.filter((g) => isDisputed(disputed, g.date, g.home, g.away)).map((g) => g.id));
});

/** Every team's games through a season, across seasons, with the seasons read (a streak is not joined across a season with none of the team's games). Shared: never mutate it. */
export const sequencesThrough = memo(async (season: number) => {
  const seasons = (await resultSeasons()).filter((s) => s <= season).sort((a, b) => a - b);
  const per = await Promise.all(seasons.map(async (s) => (await loadSeasonResults(s)).map((g) => ({ ...g, season: s }))));
  const ids = new Set((await Promise.all(seasons.map(disputedIds))).flatMap((d) => [...d]));
  return { seasons, sequences: teamSequences(per.flat(), ids) };
});

/** Every playoff game of every season held, with the program each team is counted under (a renamed school under the name it became, lib/lineage.ts). Shared: never mutate it. */
export const playoffHistory = memo<void, { seasons: { season: number; games: PlayoffGame[] }[]; program: (team: string) => string }>(async () => {
  const [alignments, lineage] = await Promise.all([loadAlignments(), loadLineage()]);
  const successors = successorOf(lineage);
  const seasons = await Promise.all(
    Array.from({ length: CURRENT_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i).map(async (season) => {
      return { season, games: await loadPlayoffGames(alignments, season) };
    }),
  );
  return { seasons, program: (team) => successors.get(slugify(team)) ?? team };
});
const firstWins = memo<void, Map<string, string>>(async () => {
  const { seasons, program } = await playoffHistory();
  return firstPlayoffWins(seasons.flatMap((s) => s.games), program);
});

/** The week's firsts for the organization's own teams, each with its game (a first needs an earlier season held to compare with, so the oldest season's playoffs claim none). */
export async function weekMilestones(org: Org, season: number, monday: string, sunday: string, games: SeasonResult[], sequences: Awaited<ReturnType<typeof sequencesThrough>>["sequences"], schools: Awaited<ReturnType<typeof schoolAlignments>>): Promise<Milestone[]> {
  const mine = (team: string) => teamInOrg(schools, org, team);
  const byKey = new Map(games.map((g) => [gameKey(g.date, g.home, g.away), g]));
  const byId = new Map(games.map((g) => [g.id, g]));
  const { seasons, program } = await playoffHistory();
  const week = seasons.find((s) => s.season === season)!.games.filter((g) => g.league === org.league && g.date >= monday && g.date <= sunday);
  const found: Milestone[] = [];
  if (season > FIRST_SEASON) {
    for (const { team, game } of firstWinsIn(week, await firstWins(), program)) {
      const result = byKey.get(gameKey(game.date, game.home, game.away));
      if (result && mine(team)) found.push({ kind: "playoff-win", team, game: result });
    }
  }
  // A State Championship game: each team's earlier ones come from its league's list (UIL's own archive from 1972, a private league's recorded finals, which start with the oldest season held).
  if (org.league === "UIL" || season > FIRST_SEASON) {
    for (const g of week.filter((g) => STATE_ROUNDS.has(g.round))) {
      const result = byKey.get(gameKey(g.date, g.home, g.away));
      const teams = [g.home, g.away].filter(mine);
      if (!result || !teams.length) continue;
      for (const h of await titleHistory(org.league, teams, season)) if (!h.past.length) found.push({ kind: "state-game", team: h.team, game: result });
    }
  }
  const teams = games.flatMap((g) => [g.home, g.away]).filter(mine);
  for (const l of firstLosses(sequences, teams, season, monday, sunday)) {
    const result = byId.get(l.id);
    if (result) found.push({ kind: "first-loss", team: l.team, game: result, unbeaten: l.unbeaten });
  }
  const order = ["state-game", "playoff-win", "first-loss"];
  return found.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (b.unbeaten ?? 0) - (a.unbeaten ?? 0) || a.team.localeCompare(b.team));
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
  const [disputed, { seasons, sequences }] = await Promise.all([disputedIds(season), sequencesThrough(season)]);
  const byId = new Map(shown.games.map((g) => [g.id, g]));
  // Streaks and firsts belong to the organization's own teams (ADR 0012); a game with an outside team still counts for the team in it.
  const mine = shown.games.flatMap((g) => [g.home, g.away]).filter((t) => teamInOrg(schools, org, t));
  const streaks = streakChanges(sequences, mine, seasons, shown.monday, sunday).flatMap((c) => (byId.has(c.id) ? [{ ...c, game: byId.get(c.id)! }] : []));
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
    closest: closestGames(shown.games, 1)[0],
    oneScore: oneScoreGames(shown.games, disputed),
    wins: biggestWins(shown.games, disputed),
    upsets: upsets(shown.games, before, disputed),
    judged: shown.games.filter((g) => before.has(g.id)).length,
    streaks,
    milestones: await weekMilestones(org, season, shown.monday, sunday, shown.games, sequences, schools),
    disputed,
    advanced: advancement(brackets.filter((b) => b.league === org.league), shown.monday, sunday),
  };
}
