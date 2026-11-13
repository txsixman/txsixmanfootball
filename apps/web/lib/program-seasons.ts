import { loadAlignments, slugify, type Alignment } from "./alignments";
import { playoffLabels } from "./game-pages";
import { gameKey, loadSeasonResults, playoffReach } from "./games";
import { memo } from "./memo";
import { fromResult, type Row } from "./program-games";
import { opponentRecords, seasonLine, type Meeting, type Rivalry, type SeasonLine } from "./program-history";
import { placeRows, rankedOrder } from "./rank-range";
import { placeTeams } from "./rankings";
import { loadRatings, type RatingRow } from "./ratings";

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

/**
 * A school's history over `seasons` (newest first, lib/ratings.ts ratingSeasons): one entry per season, with a dash-ready
 * line where the data has nothing, and its record against every opponent met (ADR 0013: from unconfirmed scores, as
 * everything on the page). A playoff game's row says which bracket and round it was and names no winner (ADR 0004).
 */
export async function programHistory(school: Alignment, seasons: number[]): Promise<{ entries: SeasonEntry[]; opponents: Rivalry[] }> {
  const perSeason = await Promise.all(
    seasons.map(async (season, i) => {
      const [org, reach, results, labels] = await Promise.all([
        orgSeason(`${season}|${school.league}`),
        playoffReach(season),
        loadSeasonResults(season),
        i === 0 ? undefined : playoffLabels(season),
      ]);
      const mine = results.filter((r) => r.home === school.school || r.away === school.school).sort((a, b) => a.date.localeCompare(b.date));
      const meetings = mine.map((r): Meeting => {
        const home = r.home === school.school;
        return { opponent: home ? r.away : r.home, date: r.date, us: home ? r.homeScore : r.awayScore, them: home ? r.awayScore : r.homeScore, forfeit: r.forfeit };
      });
      const found = org.teams.get(school.slug);
      const entry: SeasonEntry = {
        line: seasonLine({
          season,
          row: found?.row,
          meetings,
          rank: found?.rank,
          of: org.of,
          playoff: [...reach].find(([team]) => slugify(team) === school.slug)?.[1],
        }),
        played: labels ? mine.map((r) => fromResult(school.school, r, labels.get(gameKey(r.date, r.home, r.away)))) : [],
      };
      return { entry, meetings };
    }),
  );
  return { entries: perSeason.map((s) => s.entry), opponents: opponentRecords(perSeason.flatMap((s) => s.meetings)) };
}
