import { loadAlignments, slugify, uniquePrograms, type Alignment } from "./alignments";
import { playoffLabels } from "./game-pages";
import { gameKey, loadSeasonResults, playoffReach } from "./games";
import { memo } from "./memo";
import { shownBefore } from "./pregame";
import { fromResult, type Row } from "./program-games";
import { opponentRecords, seasonLine, seasonsWithGames, type Meeting, type Rivalry, type SeasonLine } from "./program-history";
import type { GameLine } from "./program-records";
import { placeRows, rankedOrder } from "./rank-range";
import { placeTeams } from "./rankings";
import { loadRatings, ratingSeasons, type RatingRow } from "./ratings";

/** One organization's teams of one season (`<season>|<league>`) with the rank each takes in that season's final table. It
 * is the rankings page's own rule (placeTeams, placeRows: ranks count one organization's teams, a team with too few games
 * is not ranked, teams are placed by the current alignments), worked out once per build and shared by every program page:
 * never mutate it. */
const orgSeason = memo(async (key: string) => {
  const [season, league] = [Number(key.split("|")[0]), key.slice(key.indexOf("|") + 1)];
  const [table, alignments] = await Promise.all([loadRatings(season), loadAlignments()]);
  const rows = placeTeams(table.teams, alignments).placed.filter((p) => p.school.league === league);
  const places = placeRows(rows);
  return {
    of: rankedOrder([...rows]).length,
    teams: new Map<string, { row: RatingRow; rank?: number }>(rows.map((r) => [r.school.slug, { row: r, rank: places.get(r.team)?.rank }])),
  };
});

export type SeasonEntry = {
  line: SeasonLine;
  /** The season's games, oldest first, each linking to its game page. Empty for the season under way: its games are listed above on the page. */
  played: Row[];
};

/** One season of one school: its table line and its games (oldest first), and the games behind the line (`lines`, each with its
 * page and whether it was a playoff game, which the season's playoff file says). `labelled`: tag each playoff game with its bracket
 * and round in `played`; the season under way is listed above on the program page, so it skips them. */
export async function programSeason(school: Alignment, season: number, labelled: boolean): Promise<{ entry: SeasonEntry; meetings: Meeting[]; lines: GameLine[] }> {
  const [org, reach, results, labels, shown] = await Promise.all([
    orgSeason(`${season}|${school.league}`),
    playoffReach(season),
    loadSeasonResults(season),
    playoffLabels(season),
    labelled ? shownBefore(season) : undefined,
  ]);
  const mine = results.filter((r) => r.home === school.school || r.away === school.school).sort((a, b) => a.date.localeCompare(b.date));
  const meetings = mine.map((r): Meeting => {
    const home = r.home === school.school;
    return { opponent: home ? r.away : r.home, date: r.date, us: home ? r.homeScore : r.awayScore, them: home ? r.awayScore : r.homeScore, forfeit: r.forfeit };
  });
  const lines = mine.map((r, i): GameLine => ({ ...meetings[i], season, href: r.href, playoff: labels.has(gameKey(r.date, r.home, r.away)) }));
  const found = org.teams.get(school.slug);
  const entry: SeasonEntry = {
    line: seasonLine({
      season,
      row: found?.row,
      meetings,
      rank: found?.rank,
      of: org.of,
      playoff: [...reach].find(([team]) => slugify(team) === school.slug)?.[1],
      playoffGames: lines.filter((g) => g.playoff),
    }),
    played: labelled ? mine.map((r) => fromResult(school.school, r, labels.get(gameKey(r.date, r.home, r.away)), shown?.before.get(r.id), shown?.disputed.has(r.id))) : [],
  };
  return { entry, meetings, lines };
}

/**
 * A school's history over `seasons` (newest first, lib/ratings.ts ratingSeasons): one entry per season, with a dash-ready
 * line where the data has nothing, and its record against every opponent met (ADR 0013: from unconfirmed scores, as
 * everything on the page). A playoff game's row says which bracket and round it was and names no winner (ADR 0004).
 */
export async function programHistory(school: Alignment, seasons: number[]): Promise<{ entries: SeasonEntry[]; opponents: Rivalry[]; games: GameLine[] }> {
  const perSeason = await Promise.all(seasons.map((season, i) => programSeason(school, season, i !== 0)));
  return { entries: perSeason.map((s) => s.entry), opponents: opponentRecords(perSeason.flatMap((s) => s.meetings)), games: perSeason.flatMap((s) => s.lines) };
}

/** The programs with a season page, by slug, each with its seasons newest first (a season page needs a game read that season). One page each
 * at /programs/<slug>/<season>. Shared: never mutate it. */
export const programSeasonPages = memo<void, ReadonlyMap<string, number[]>>(async () => {
  const [alignments, seasons] = await Promise.all([loadAlignments(), ratingSeasons()]);
  const teams = new Map(await Promise.all(seasons.map(async (s) => [s, new Set((await loadSeasonResults(s)).flatMap((r) => [r.home, r.away]))] as const)));
  return new Map(uniquePrograms(alignments).flatMap((a): [string, number[]][] => {
    const found = seasonsWithGames(a.school, teams);
    return found.length ? [[a.slug, found]] : [];
  }));
});
