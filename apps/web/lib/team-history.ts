import { loadAlignments, programsFor, type Alignment } from "./alignments";
import { memo } from "./memo";
import { rankMatrix, type HistoryPoint } from "./rank-history";
import { FEW_GAMES, loadRatings } from "./ratings";

// One program's season by week (ADR 0091): the matrix of a season and organization is built once per process and shared
// by every program page and season page, so a build does not sort each week's table again for each of 280 programs.
const matrix = memo<string, Map<string, HistoryPoint[]>>(async (key) => {
  const [season, league] = [Number(key.split(":")[0]), key.split(":")[1]];
  const [table, alignments] = await Promise.all([loadRatings(season), loadAlignments()]);
  return rankMatrix(table, (team) => programsFor(alignments, team).some((a) => a.league === league), FEW_GAMES);
});

/** The weeks of `season` the school's team was rated, with its rank among its organization's teams each week; empty when
 * the season has no weekly columns or no rated team of this school. Past seasons place teams by today's alignments, as
 * the rankings pages do. */
export async function teamHistory(season: number, school: Pick<Alignment, "slug" | "league">): Promise<HistoryPoint[]> {
  const [table, alignments, weeks] = await Promise.all([loadRatings(season), loadAlignments(), matrix(`${season}:${school.league}`)]);
  const team = table.teams.find((t) => programsFor(alignments, t.team).some((a) => a.slug === school.slug && a.league === school.league));
  return (team && weeks.get(team.team)) || [];
}
