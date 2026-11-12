import { loadAlignments } from "./alignments";
import { gameKey, loadSeasonResults, playoffGameKeys, type SeasonResult } from "./games";
import { memo } from "./memo";
import { homeEdge, homeWinProbability } from "./projection";
import { placeTeams } from "./rankings";
import { rankedOrder } from "./rank-range";
import { loadRatings, type RatingsTable } from "./ratings";

// How hard a team's record was, from the ratings' own win probabilities (the figures beside the predictive rating).
//
// Benchmark: the average rating of the BENCHMARK_TEAMS best-rated teams of the team's organization (all of UIL for a UIL
// team, both divisions: ADR 0012 keeps organizations apart). Only teams with enough games count.
// Strength of schedule (sos): the average rating of the opponents played.
// Strength of record (sor): the team's wins minus the wins the benchmark team would be expected to get against the same
// opponents at the same sites. +2 means two wins more than a typical top-25 team would have got from this schedule;
// a 9-0 team on a soft schedule is near 0, a 4-6 team on the hardest schedule can be well above it.
// Games that count: played, against an opponent with a rating, not a forfeit (a forfeit says nothing about strength, as
// in the ratings). A tie is half a win. A robot-read playoff game gives the listed home side the playoff share of the home
// edge, as everywhere else on the site (lib/projection.ts `homeEdge`).
// Best win / worst loss: the win over the highest-rated opponent, the loss to the lowest-rated one. A forfeit can be a
// worst loss (the record counts it) and is shown as "Forfeit", never a score; it is never a best win.

export const BENCHMARK_TEAMS = 25;

export type Meeting = { opponent: string; us: number; them: number; forfeit: boolean; href: string };
export type TeamSchedule = {
  /** Games the figures rest on. */
  games: number;
  /** Average rating of the opponents in those games. */
  sos: number;
  /** Wins in those games (a tie counts half). */
  wins: number;
  /** Wins the benchmark team would be expected to get against the same schedule. */
  expected: number;
  /** wins - expected. */
  sor: number;
  best?: Meeting;
  worst?: Meeting;
};

/** The score as shown: "42-14" from the team's side, or the word for a forfeit. */
export const meetingScore = (m: Meeting) => (m.forfeit ? "Forfeit" : `${m.us}-${m.them}`);

type Tally = { sos: number; wins: number; expected: number; games: number; best?: Meeting & { rating: number }; worst?: Meeting & { rating: number } };

/** Every team's figures for one season. Pure: `benchmark` is the benchmark team's rating, `playoffs` the keys of the
 * season's playoff games (gameKey). Empty when the table cannot give a win probability. */
export function scheduleStats(table: RatingsTable, results: SeasonResult[], playoffs: Set<string>, benchmark: number): Map<string, TeamSchedule> {
  const rating = new Map(table.teams.map((t) => [t.team, t.rating]));
  const tally = new Map<string, Tally>();
  for (const g of results) {
    const neutral = playoffs.has(gameKey(g.date, g.home, g.away));
    const edge = homeEdge(table, neutral);
    for (const [team, opponent, us, them, site] of [
      [g.home, g.away, g.homeScore, g.awayScore, edge],
      [g.away, g.home, g.awayScore, g.homeScore, -edge],
    ] as const) {
      const theirs = rating.get(opponent);
      if (theirs == null || !rating.has(team)) continue;
      const t = tally.get(team) ?? { sos: 0, wins: 0, expected: 0, games: 0 };
      tally.set(team, t);
      const meeting = { opponent, us, them, forfeit: g.forfeit, href: g.href, rating: theirs };
      if (us < them && (!t.worst || theirs < t.worst.rating || (theirs === t.worst.rating && them - us > t.worst.them - t.worst.us))) t.worst = meeting;
      if (g.forfeit) continue;
      const p = homeWinProbability(benchmark - theirs + site, table);
      if (p == null) return new Map();
      t.games += 1;
      t.sos += theirs;
      t.expected += p;
      t.wins += us > them ? 1 : us === them ? 0.5 : 0;
      if (us > them && (!t.best || theirs > t.best.rating || (theirs === t.best.rating && us - them > t.best.us - t.best.them))) t.best = meeting;
    }
  }
  return new Map(
    [...tally].flatMap(([team, t]) =>
      t.games ? [[team, { games: t.games, sos: t.sos / t.games, wins: t.wins, expected: t.expected, sor: t.wins - t.expected, best: t.best, worst: t.worst }] as const] : [],
    ),
  );
}

/** A season's figures for the teams of one organization's page: the benchmark is that organization's own top teams. */
const loadSchedules = memo(async (key: string): Promise<{ benchmark: number; stats: Map<string, TeamSchedule> }> => {
  const [season, league] = [Number(key.split(":")[0]), key.split(":")[1]];
  const [table, results, playoffs, alignments] = await Promise.all([loadRatings(season), loadSeasonResults(season), playoffGameKeys(season), loadAlignments()]);
  const own = placeTeams(table.teams, alignments).placed.filter((r) => r.school.league === league);
  const top = rankedOrder(own).slice(0, BENCHMARK_TEAMS);
  const benchmark = top.length ? top.reduce((n, t) => n + t.rating, 0) / top.length : 0;
  return { benchmark, stats: scheduleStats(table, results, playoffs, benchmark) };
});

/** `loadSchedules` for a season and organization (league name as the alignments spell it). */
export const schedulesFor = (season: number, league: string) => loadSchedules(`${season}:${league}`);
