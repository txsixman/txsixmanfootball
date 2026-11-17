import { ratingMovers, type Mover } from "./week-review";
import type { SeasonResult } from "./season-results";
import { STATE_ROUNDS } from "./state-finals";
import { teamSequences } from "./week-recap";

// A season in review (ADR 0099): one organization's season counted from its results, ratings and playoff games, with no
// sentence written by hand. The pure rules live here (no file access, so the node tests run this file as it is); the loader
// is lib/season-review-load.ts. A final score is confirmed (ADR 0040), so a result may name its winner; a game the sources
// dispute names none and is left out of every list that needs one. A fact the data cannot support is left out, never filled in.

/** A team needs this many games in the season to be listed for its record: a short schedule read is not a season. */
export const RECORD_MIN_GAMES = 6;
/** A run of wins this long is a streak worth naming. */
export const STREAK_MIN = 5;
/** One score in six-man: a touchdown and a two-point conversion (the week recap's rule too, lib/week-recap.ts). */
const ONE_SCORE = 8;
/** The longest a list runs, however many teams tie at its end. */
const LIST_MAX = 10;

type Sequences = ReturnType<typeof teamSequences>;

/**
 * The first `n` of `rows` (already in order), plus every later row that ties the last one shown on `same`, up to LIST_MAX
 * rows: a list never ends in the middle of a tie.
 */
function withTies<T>(rows: T[], n: number, same: (a: T, b: T) => boolean): T[] {
  if (rows.length <= n) return rows;
  let end = n;
  while (end < rows.length && end < LIST_MAX && same(rows[end], rows[n - 1])) end += 1;
  return rows.slice(0, end);
}

export type Totals = { games: number; forfeits: number; played: number; averageMargin?: number };

/**
 * The games, the forfeits among them and the average margin of the games actually played. A forfeit's recorded score and a
 * no contest (0-0) are no score, so neither enters the margin (ADR 0004); the average is left out when no game was played.
 */
export function seasonTotals(games: Pick<SeasonResult, "homeScore" | "awayScore" | "forfeit">[]): Totals {
  const played = games.filter((g) => !g.forfeit && g.homeScore + g.awayScore > 0);
  const margin = played.reduce((sum, g) => sum + Math.abs(g.homeScore - g.awayScore), 0);
  return {
    games: games.length,
    forfeits: games.filter((g) => g.forfeit).length,
    played: played.length,
    ...(played.length ? { averageMargin: margin / played.length } : {}),
  };
}

export type TeamRecord = { team: string; won: number; lost: number; tied: number; games: number };

/**
 * Every listed team's record in the season, from its games (a forfeit is a win or a loss like any other, ADR 0013; a no
 * contest is no game). A disputed final names no winner, so it is in no record, and a team with one is never called
 * unbeaten. Only teams `include` accepts with at least RECORD_MIN_GAMES games.
 */
function records(sequences: Sequences, include: (team: string) => boolean): (TeamRecord & { unsettled: boolean })[] {
  const out: (TeamRecord & { unsettled: boolean })[] = [];
  for (const [team, entries] of sequences) {
    if (!include(team) || entries.length < RECORD_MIN_GAMES) continue;
    const count = (r: string) => entries.filter((e) => e.result === r).length;
    out.push({ team, won: count("W"), lost: count("L"), tied: count("T"), games: entries.length, unsettled: count("U") > 0 });
  }
  return out;
}

/** The share of games won, a tie counting half (lib/program-records.ts winShare), over the games that named a result. */
const share = (r: Pick<TeamRecord, "won" | "lost" | "tied">) => (r.won + r.lost + r.tied ? (r.won + r.tied / 2) / (r.won + r.lost + r.tied) : 0);

/**
 * The teams with no loss (a tie is not a loss) and how the best records stand: the share of games won, then the most wins,
 * then name. `best` runs to ten and keeps every team tied with the last one shown. A team with a disputed final is not
 * called unbeaten and has no place in the best records.
 */
export function bestRecords(sequences: Sequences, include: (team: string) => boolean): { unbeaten: TeamRecord[]; best: TeamRecord[] } {
  const rows = records(sequences, include)
    .filter((r) => !r.unsettled)
    .map(({ unsettled: _unsettled, ...r }) => r)
    .sort((a, b) => share(b) - share(a) || b.won - a.won || b.games - a.games || a.team.localeCompare(b.team));
  return {
    unbeaten: rows.filter((r) => r.lost === 0),
    best: withTies(rows, 5, (a, b) => share(a) === share(b) && a.won === b.won),
  };
}

export type SeasonStreak = { team: string; length: number; first: string; last: string; open: boolean };

/**
 * The longest runs of wins in a row inside the season, one per team (its longest; the later one on a tie). A tie, a loss
 * and a disputed final end a run. `open`: no game ended it, the run reaches the team's last game of the season. Runs shorter
 * than STREAK_MIN are not listed; the five longest, with every team tied at the end of the list up to ten.
 */
export function seasonStreaks(sequences: Sequences, include: (team: string) => boolean): SeasonStreak[] {
  const rows: SeasonStreak[] = [];
  for (const [team, entries] of sequences) {
    if (!include(team)) continue;
    let top: SeasonStreak | undefined;
    let run = 0;
    for (const [i, e] of entries.entries()) {
      run = e.result === "W" ? run + 1 : 0;
      if (run >= STREAK_MIN && (!top || run >= top.length)) top = { team, length: run, first: entries[i - run + 1].id, last: e.id, open: i === entries.length - 1 };
    }
    if (top) rows.push(top);
  }
  rows.sort((a, b) => b.length - a.length || a.team.localeCompare(b.team));
  return withTies(rows, 5, (a, b) => a.length === b.length);
}

/** A playoff game as lib/games.ts loadPlayoffGames gives it, the fields these rules read. */
type PlayoffGame = {
  league: string; bracket: string; round: string; date: string; home: string; away: string;
  homeScore?: number; awayScore?: number; forfeit: boolean; confirmed: boolean;
};

export type CloseGame = { game: PlayoffGame; margin: number; state: boolean };

/**
 * The playoff games decided by one score or less (a tie counting), closest first, a State Championship game ahead of any other
 * round at the same margin. Only a played, confirmed game that is not a forfeit counts; a disputed final is not confirmed.
 */
export function closestPlayoffGames(games: PlayoffGame[], n = 5): CloseGame[] {
  return games
    .flatMap((game): CloseGame[] => {
      if (!game.confirmed || game.forfeit || game.homeScore == null || game.awayScore == null) return [];
      const margin = Math.abs(game.homeScore - game.awayScore);
      return margin <= ONE_SCORE ? [{ game, margin, state: STATE_ROUNDS.has(game.round) }] : [];
    })
    .sort((a, b) => a.margin - b.margin || Number(b.state) - Number(a.state) || b.game.date.localeCompare(a.game.date) || a.game.home.localeCompare(b.game.home))
    .slice(0, n);
}

/** The name of a playoff round as a heading-free label: "State Championship", "Semifinal", "Bi-district". */
export function roundName(round: string): string {
  if (STATE_ROUNDS.has(round)) return "State Championship";
  const names: Record<string, string> = { "round-1": "First round", "bi-district": "Bi-district", area: "Area", quarterfinal: "Quarterfinal", regional: "Regional", semifinal: "Semifinal" };
  return names[round] ?? round;
}

export type Riser = Mover & { startRated: number };

/** A team needs this many rated games at the end of week 4 to have a starting rating worth comparing: by then a rating rests
 * on a few games and last season's level, and most teams have played three or four. */
const START_MIN_RATED = 3;

/**
 * The teams whose rating rose most from the end of week 4 to the end of the season (`start`: the rating at week 4, null if
 * unrated then). A team needs START_MIN_RATED rated games at week 4 and `few` at the end, so one early result does not fill the
 * list. A rise that rounds to 0.0 is not a rise.
 */
export function biggestRisers(
  rows: { team: string; rating: number; rated: number; start: number | null; startRated: number }[],
  few: number,
  n = 5,
): Riser[] {
  const startRated = new Map(rows.map((r) => [r.team, r.startRated]));
  const { rises } = ratingMovers(
    rows.filter((r) => r.startRated >= START_MIN_RATED).map((r) => ({ team: r.team, rating: r.rating, was: r.start, rated: r.rated })),
    few,
    n,
  );
  return rises.map((m) => ({ ...m, startRated: startRated.get(m.team)! }));
}
