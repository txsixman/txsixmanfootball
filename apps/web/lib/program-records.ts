// A program's all-time numbers and records (ADR 0089), from the games and season lines lib/program-seasons.ts already builds.
// Pure: it imports only types and lib/program-history.ts (itself import-free), so node can test it directly
// (scripts/program-records.test.mjs). Scores are unconfirmed (ADR 0013), so every figure here says "read", and a forfeit
// counts as a win or a loss in a record or a streak but is never a margin (its recorded 1-0 or 2-0 is no score, ADR 0004).
import type { Meeting, SeasonLine, Tally } from "./program-history.ts";

/** One game of a program from its own side, with the season and the game's page. `playoff`: a playoff game (the season's playoff file lists it). */
export type GameLine = Meeting & { season: number; href: string; playoff: boolean };

/** A program with fewer games than this on record has too little for all-time numbers: the page says so instead. */
export const LITTLE_DATA = 5;

/** A season of fewer games than this is not a candidate for "best season": a short schedule read is not a season. */
export const BEST_SEASON_MIN_GAMES = 6;

const margin = (g: Pick<Meeting, "us" | "them">) => g.us - g.them;

/** The win by the most points (a forfeit has no margin), then the one with more points scored, then the latest. */
export function biggestWin(games: GameLine[]): GameLine | undefined {
  return games
    .filter((g) => !g.forfeit && margin(g) > 0)
    .reduce<GameLine | undefined>((best, g) => (!best || margin(g) > margin(best) || (margin(g) === margin(best) && (g.us > best.us || (g.us === best.us && g.date > best.date))) ? g : best), undefined);
}

/** The loss by the most points, then the latest. */
export function biggestLoss(games: GameLine[]): GameLine | undefined {
  return games
    .filter((g) => !g.forfeit && margin(g) < 0)
    .reduce<GameLine | undefined>((best, g) => (!best || margin(g) < margin(best) || (margin(g) === margin(best) && g.date > best.date) ? g : best), undefined);
}

/** A run of wins in a row. `current`: nothing has ended it and the program played in the latest season read. */
type Streak = { wins: number; from: GameLine; to: GameLine; current: boolean };

/**
 * The longest run of wins in a row across every season read (a later run wins a tie), as lib/records.ts counts the
 * site's records: a tie or a loss ends a run, and so does a read season (`seasons`) in which the program has no game, because
 * a run cannot be joined across a hole in the record. Two wins are the shortest run named.
 */
export function longestWinStreak(games: GameLine[], seasons: readonly number[]): Streak | undefined {
  const ordered = [...games].sort((a, b) => a.date.localeCompare(b.date));
  const latest = Math.max(...seasons);
  let top: Streak | undefined;
  let run: { wins: number; from: GameLine; to: GameLine } | undefined;
  let before: number | undefined;
  for (const g of ordered) {
    if (before !== undefined && seasons.some((s) => s > before! && s < g.season)) run = undefined;
    before = g.season;
    if (g.us > g.them) {
      run = run ? { ...run, wins: run.wins + 1, to: g } : { wins: 1, from: g, to: g };
      if (!top || run.wins >= top.wins) top = { ...run, current: false };
    } else run = undefined;
  }
  if (!top || top.wins < 2) return undefined;
  return { ...top, current: run?.from === top.from && ordered.at(-1)!.season === latest };
}

/** The share of games won, a tie counting half. */
export const winShare = (t: Tally) => (t.won + t.lost + t.tied ? (t.won + t.tied / 2) / (t.won + t.lost + t.tied) : 0);

/**
 * The best completed season by share of games won, then the most wins, then the latest. `skip`: the season under way. A
 * season rated only from games against schools we do not list has no record to compare, and one of fewer games than
 * BEST_SEASON_MIN_GAMES is too short.
 */
export function bestSeason(lines: SeasonLine[], skip?: number): SeasonLine | undefined {
  return lines
    .filter((l) => l.season !== skip && l.record && !l.outsideOnly && l.record.won + l.record.lost + l.record.tied >= BEST_SEASON_MIN_GAMES)
    .reduce<SeasonLine | undefined>((best, l) => {
      if (!best) return l;
      const [a, b] = [winShare(l.record!), winShare(best.record!)];
      return a > b || (a === b && (l.record!.won > best.record!.won || (l.record!.won === best.record!.won && l.season > best.season))) ? l : best;
    }, undefined);
}

type Totals = {
  /** Seasons with a record, and the first and last of them. */
  seasons: number; first: number; last: number;
  record: Tally;
  /** Seasons that reached a playoff round, and the record in those playoff games. */
  playoffSeasons: number; playoffRecord: Tally;
};

/** The all-time numbers over the season lines that hold a record (a dash season adds nothing). */
export function programTotals(lines: SeasonLine[]): Totals | undefined {
  const have = lines.filter((l) => l.record && !l.outsideOnly);
  if (!have.length) return undefined;
  const sum = (pick: (l: SeasonLine) => Tally | null) =>
    have.reduce<Tally>((n, l) => {
      const t = pick(l);
      return t ? { won: n.won + t.won, lost: n.lost + t.lost, tied: n.tied + t.tied } : n;
    }, { won: 0, lost: 0, tied: 0 });
  const seasons = have.map((l) => l.season);
  return {
    seasons: have.length, first: Math.min(...seasons), last: Math.max(...seasons),
    record: sum((l) => l.record),
    playoffSeasons: have.filter((l) => l.playoff).length,
    playoffRecord: sum((l) => l.playoffRecord),
  };
}

/** A State Championship a program played in: the season and whether it won. */
type StateGame = { season: number; won: boolean };

/** State Championship games and titles over every league's list, with the years, newest first. */
export function stateSummary(games: StateGame[]) {
  const years = (won: boolean) => games.filter((g) => g.won === won).map((g) => g.season).sort((a, b) => b - a);
  return { games: games.length, titles: years(true), runnerUp: years(false) };
}

/** "2018 to 2022, 2024": runs of consecutive years joined, for a page that names the seasons with no games. */
export function yearSpans(years: readonly number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (const y of sorted) {
    const last = spans.at(-1);
    if (last && y === last[1] + 1) last[1] = y;
    else spans.push([y, y]);
  }
  return spans.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a} and ${b}` : `${a} to ${b}`)).join(", ");
}
