import type { Projection } from "./projection";
import type { SeasonResult } from "./season-results";
import { slugify } from "./slug";
import { closestGames, marginOf as points, played } from "./week-review";

// The week recap's pure rules (ADR 0092): upsets, biggest wins, games within one score, streaks that ended or reached a mark,
// and milestones (a first playoff win, a first State Championship game, an unbeaten team's first loss). Everything is counted
// from the results and the ratings the site already holds; a fact the data does not hold is left out, never filled in. A final
// score is confirmed (ADR 0040) so a win may be named, except in a game the sources dispute: it names no winner, so it is
// never an upset, a big win, a streak or a milestone. No file access: the node tests run this file as it is.

const inOrder = (a: SeasonResult, b: SeasonResult) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** One score in six-man: a touchdown and a two-point conversion. A game this close or closer is "one score or less". */
const ONE_SCORE = 8;
/** A streak this long is notable; one reaches the mark at every multiple of it (5, 10, 15 ...). */
const STREAK_MIN = 5;
/** A team needs this many games without a loss for its first loss to be a milestone. */
const UNBEATEN_MIN = 4;

/** The games decided by one score or less (a tie counts), closest first, forfeits, no contests and disputed finals left out. */
export const oneScoreGames = (games: SeasonResult[], disputed: ReadonlySet<string>, n = 10): SeasonResult[] =>
  closestGames(games, games.length).filter((g) => points(g) <= ONE_SCORE && !disputed.has(g.id)).slice(0, n);

export type Decided = { game: SeasonResult; winner: string; loser: string; won: number; lost: number; margin: number };

/** A played game with a winner: not a forfeit, a tie, a no contest or a disputed final (`disputed`: game ids). */
function decided(g: SeasonResult, disputed: ReadonlySet<string>): Decided | undefined {
  if (!played(g) || disputed.has(g.id) || g.homeScore === g.awayScore) return undefined;
  const homeWon = g.homeScore > g.awayScore;
  return { game: g, winner: homeWon ? g.home : g.away, loser: homeWon ? g.away : g.home, won: Math.max(g.homeScore, g.awayScore), lost: Math.min(g.homeScore, g.awayScore), margin: points(g) };
}

/** The wins by the most points, forfeits, ties and disputed finals left out. */
export const biggestWins = (games: SeasonResult[], disputed: ReadonlySet<string>, n = 5): Decided[] =>
  games.flatMap((g) => decided(g, disputed) ?? []).sort((a, b) => b.margin - a.margin || inOrder(a.game, b.game)).slice(0, n);

export type Upset = Decided & {
  /** The winner's chance to win before the game, from the ratings at the end of the week before (lib/pregame.ts): under one half. */
  chance: number;
};

/**
 * Games the team the ratings gave the lower chance to win won. `before` is what the ratings said the week before each game
 * (lib/pregame.ts, which leaves out ties, forfeits and teams with under four rated games). A chance that rounds to a half is
 * no upset. Lowest chance first, then the later game.
 */
export function upsets(games: SeasonResult[], before: ReadonlyMap<string, Projection>, disputed: ReadonlySet<string>): Upset[] {
  return games
    .flatMap((g) => {
      const d = decided(g, disputed);
      const p = before.get(g.id);
      if (!d || !p || p.favorite === d.winner) return [];
      const chance = 1 - p.winProbability;
      return Math.round(chance * 100) < 50 ? [{ ...d, chance }] : [];
    })
    .sort((a, b) => a.chance - b.chance || b.game.date.localeCompare(a.game.date) || a.game.id.localeCompare(b.game.id));
}

/** One game of a team from its own side. `result` U: the sources dispute the final, so it is neither a win nor a loss. */
type Entry = {
  id: string; date: string; season: number; opponent: string; us: number; them: number; forfeit: boolean;
  result: "W" | "L" | "T" | "U";
};

/**
 * Every team's games, oldest first, from the seasons given: a no contest (0-0) is no game, and a forfeit is a win or a loss
 * like any other result (ADR 0013).
 */
export function teamSequences(games: (SeasonResult & { season: number })[], disputed: ReadonlySet<string>): Map<string, Entry[]> {
  const by = new Map<string, Entry[]>();
  for (const g of games) {
    if (g.homeScore + g.awayScore === 0) continue;
    for (const [team, us, them, opponent] of [[g.home, g.homeScore, g.awayScore, g.away], [g.away, g.awayScore, g.homeScore, g.home]] as const) {
      const result = disputed.has(g.id) ? "U" : us > them ? "W" : us < them ? "L" : "T";
      const list = by.get(team) ?? [];
      list.push({ id: g.id, date: g.date, season: g.season, opponent, us, them, forfeit: g.forfeit, result });
      by.set(team, list);
    }
  }
  for (const list of by.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return by;
}

type Run = { kind: "W" | "L"; n: number } | undefined;

/**
 * The run in force after each game: wins in a row or losses in a row. A tie, a disputed final and a read season with none of
 * the team's games (`seasons`) end a run, because a run cannot be joined across a hole in the record (lib/records.ts).
 */
function runs(entries: Entry[], seasons: readonly number[]): Run[] {
  let run: Run;
  return entries.map((e, i) => {
    const was = entries[i - 1]?.season;
    if (was !== undefined && seasons.some((s) => s > was && s < e.season)) run = undefined;
    run = e.result === "W" || e.result === "L" ? (run?.kind === e.result ? { kind: e.result, n: run.n + 1 } : { kind: e.result, n: 1 }) : undefined;
    return run;
  });
}

export type StreakChange = {
  team: string;
  /** "ended": a run of `length` games ended this week. "reached": a winning run now at a mark (STREAK_MIN, 10, 15 ...), `length` games long. */
  change: "ended" | "reached";
  kind: "win" | "loss";
  length: number;
  /** The game that ended the run, or the latest game of the run (a SeasonResult id). */
  id: string;
  opponent: string;
};

/**
 * The streaks of `teams` that changed between `monday` and `sunday`: a run of STREAK_MIN or more games that ended, and a
 * winning run that reached a multiple of STREAK_MIN. A run ended by a disputed final is not claimed (it may be alive). Longest
 * first, then by team.
 */
export function streakChanges(sequences: ReadonlyMap<string, Entry[]>, teams: Iterable<string>, seasons: readonly number[], monday: string, sunday: string): StreakChange[] {
  const out: StreakChange[] = [];
  for (const team of new Set(teams)) {
    const entries = sequences.get(team);
    if (!entries) continue;
    const run = runs(entries, seasons);
    const lastBefore = entries.findLastIndex((e) => e.date < monday);
    const last = entries.findLastIndex((e) => e.date <= sunday);
    if (last <= lastBefore) continue;
    const [before, after] = [lastBefore >= 0 ? run[lastBefore] : undefined, run[last]];
    const week = entries.slice(lastBefore + 1, last + 1);
    if (before && before.n >= STREAK_MIN && !(after?.kind === before.kind && after.n === before.n + week.length)) {
      const ender = week.find((e) => e.result !== before.kind);
      if (ender && ender.result !== "U") out.push({ team, change: "ended", kind: before.kind === "W" ? "win" : "loss", length: before.n, id: ender.id, opponent: ender.opponent });
    }
    const had = before?.kind === "W" ? before.n : 0;
    if (after?.kind === "W" && after.n >= STREAK_MIN && Math.floor(after.n / STREAK_MIN) > Math.floor(had / STREAK_MIN)) {
      out.push({ team, change: "reached", kind: "win", length: after.n, id: entries[last].id, opponent: entries[last].opponent });
    }
  }
  return out.sort((a, b) => b.length - a.length || a.team.localeCompare(b.team) || a.change.localeCompare(b.change));
}

type FirstLoss = { team: string; unbeaten: number; id: string; opponent: string };

/**
 * Teams that lost, in the week, for the first time of `season` after at least UNBEATEN_MIN games with no loss or tie. A forfeit
 * loss and a disputed final are not claimed; a forfeit win before it counts as a game, as it does in the record.
 */
export function firstLosses(sequences: ReadonlyMap<string, Entry[]>, teams: Iterable<string>, season: number, monday: string, sunday: string): FirstLoss[] {
  const out: FirstLoss[] = [];
  for (const team of new Set(teams)) {
    const mine = (sequences.get(team) ?? []).filter((e) => e.season === season);
    const at = mine.findIndex((e) => e.result === "L" || e.result === "T" || e.result === "U");
    const e = mine[at];
    if (at < UNBEATEN_MIN || e.result !== "L" || e.forfeit || e.date < monday || e.date > sunday) continue;
    out.push({ team, unbeaten: at, id: e.id, opponent: e.opponent });
  }
  return out.sort((a, b) => b.unbeaten - a.unbeaten || a.team.localeCompare(b.team));
}

/** A playoff game as lib/games.ts loadPlayoffGames gives it, the fields these rules read. */
type PlayoffResult = {
  round: string; date: string; home: string; away: string; homeScore?: number; awayScore?: number; forfeit: boolean; confirmed: boolean;
};

/** The key two files agree on for one game: its date and both teams, whatever their order. */
const playoffKey = (g: Pick<PlayoffResult, "date" | "home" | "away">) => [g.date, ...[slugify(g.home), slugify(g.away)].sort()].join("|");

const winnerOf = (g: PlayoffResult): string | undefined =>
  !g.confirmed || g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore ? undefined : g.homeScore > g.awayScore ? g.home : g.away;

/**
 * Each team's earliest playoff win in `all` (every season held, every league), as the key of that game. `program` names a
 * team's program (a renamed school counts under the name it became, lib/lineage.ts). A forfeit win counts as a win here, so a
 * team is never called a first-time winner when the data holds an earlier forfeit win.
 */
export function firstPlayoffWins(all: PlayoffResult[], program: (team: string) => string): Map<string, string> {
  const first = new Map<string, { date: string; key: string }>();
  for (const g of all) {
    const winner = winnerOf(g);
    if (!winner) continue;
    const [team, key] = [program(winner), playoffKey(g)];
    const was = first.get(team);
    if (!was || g.date < was.date || (g.date === was.date && key < was.key)) first.set(team, { date: g.date, key });
  }
  return new Map([...first].map(([team, { key }]) => [team, key]));
}

/** The playoff games of `week` that were a team's first win in the data: played, confirmed, not a forfeit, not a tie. */
export function firstWinsIn(week: PlayoffResult[], first: ReadonlyMap<string, string>, program: (team: string) => string): { team: string; game: PlayoffResult }[] {
  return week.flatMap((game) => {
    const winner = game.forfeit ? undefined : winnerOf(game);
    return winner && first.get(program(winner)) === playoffKey(game) ? [{ team: winner, game }] : [];
  });
}
