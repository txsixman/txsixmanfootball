import { loadSeasonResults } from "./games";
import { loadRatings, type RatingRow } from "./ratings";
import { loadWeeks } from "./weeks";

// The rankings as they stood at the end of a week of the season, from the table's `trend` (run.py --season rates the
// season's games up to each Sunday). Records count the games played by that Sunday, forfeits included; `rated` is the
// ratings' own count through that Sunday (`rated_trend`: forfeits, no contests and duplicates left out), not a second
// definition made here. Weeks are numbered as on the Results pages (week 1 holds the first game).

export type RankingWeek = { number: number; sunday: string; index: number };

const sundayOf = (monday: string) => new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);

/** The weeks of a season that have a trend column, in order. */
export async function rankingWeeks(season: number): Promise<RankingWeek[]> {
  const [table, weeks] = await Promise.all([loadRatings(season), loadWeeks(season)]);
  const columns = table.weeks ?? [];
  return weeks.flatMap((w) => {
    const sunday = sundayOf(w.monday);
    const index = columns.indexOf(sunday);
    return index < 0 ? [] : [{ number: w.number, sunday, index }];
  });
}

/** Every team rated by the end of the week, with its record then; `was` is its rating a week before (null if unrated). */
export async function weekRows(season: number, week: RankingWeek): Promise<(RatingRow & { played: number })[]> {
  const [table, games] = await Promise.all([loadRatings(season), loadSeasonResults(season)]);
  const tally = new Map<string, { won: number; lost: number; tied: number }>();
  for (const g of games) {
    if (g.date > week.sunday) continue;
    for (const [team, us, them] of [[g.home, g.homeScore, g.awayScore], [g.away, g.awayScore, g.homeScore]] as const) {
      const t = tally.get(team) ?? { won: 0, lost: 0, tied: 0 };
      if (us > them) t.won += 1;
      else if (us < them) t.lost += 1;
      else t.tied += 1;
      tally.set(team, t);
    }
  }
  return table.teams
    .flatMap((t) => {
      const rating = t.trend?.[week.index];
      if (rating == null) return [];
      const was = week.index > 0 ? (t.trend?.[week.index - 1] ?? null) : undefined;
      const record = tally.get(t.team) ?? { won: 0, lost: 0, tied: 0 };
      // `played` is every game of the season's files through that Sunday (a forfeit too); `rated` is the ratings' own count.
      return [{ team: t.team, rating, was, rated: t.rated_trend?.[week.index] ?? 0, played: record.won + record.lost + record.tied, ...record }];
    })
    .sort((a, b) => b.rating - a.rating || a.team.localeCompare(b.team));
}
