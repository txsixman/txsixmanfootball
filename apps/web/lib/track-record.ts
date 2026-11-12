import { loadSeasonResults } from "./games";
import { pregame } from "./pregame";
import { resultSeasons } from "./weeks";

// How well the week-before projections picked games (lib/pregame.ts): for each band of the favorite's win probability,
// how many games, how often the ratings said the favorite would win (`expected`, their average win probability) and how
// often it did. Only games pregame judges count: both teams with four games played,
// no ties, no forfeits. It says how often the ratings were right, never which result was "correct" (ADR 0004).

type Band = { from: number; to: number; games: number; favoriteWon: number; expected: number };
export type TrackRecord = { seasons: number[]; games: number; favoriteWon: number; bands: Band[] };

const EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 0.99, 1.0001];

export async function loadTrackRecord(): Promise<TrackRecord> {
  const seasons = await resultSeasons();
  const bands: Band[] = EDGES.slice(0, -1).map((from, i) => ({ from, to: EDGES[i + 1], games: 0, favoriteWon: 0, expected: 0 }));
  for (const season of seasons) {
    const [games, before] = await Promise.all([loadSeasonResults(season), pregame(season)]);
    for (const g of games) {
      const p = before.get(g.id);
      if (!p) continue;
      const winner = g.homeScore > g.awayScore ? g.home : g.away;
      const band = bands.find((b) => p.winProbability >= b.from && p.winProbability < b.to)!;
      band.games += 1;
      band.expected += p.winProbability;
      if (winner === p.favorite) band.favoriteWon += 1;
    }
  }
  const counted = bands.filter((b) => b.games > 0);
  return {
    seasons,
    games: counted.reduce((n, b) => n + b.games, 0),
    favoriteWon: counted.reduce((n, b) => n + b.favoriteWon, 0),
    bands: counted.map((b) => ({ ...b, expected: b.expected / b.games })),
  };
}
