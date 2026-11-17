// The series pages' rules (/series/<a>/<b>, app/series, ADRs 0013 and 0097): which pairs of programs get a page, where it lives,
// the record in words, the longest streak, the biggest win each way and the state finals between the pair. Pure: it imports
// only types and two import-free files, so node can test it (scripts/series.test.mjs). lib/series-data.ts feeds it the data.
import type { Final } from "./champions.ts";
import { tally, type Tally } from "./program-history.ts";
import { slugify } from "./slug.ts";

/** A pair needs this many games in the seasons read before it has a page: a first rematch is a series (ADR 0097; it was three). */
export const MIN_MEETINGS = 2;

/** The address of a pair's page. The slugs are in alphabetical order whichever way they are given, and that order is the
 * only address that has a page (the reversed one answers with a permanent redirect to it, so a pair never has two pages). The same sort as `pairKey`. */
export const seriesHref = (x: string, y: string) => `/series/${[x, y].sort().join("/")}`;

/**
 * The pairs that get a page: every key of `games` (`pairKey` order, "a|b", lib/meetings.ts) with at least MIN_MEETINGS
 * games where both slugs are in `programs` (today's alignments, each with a program page). A pair of two organizations is
 * fine: it is two schools' games. In key order.
 */
export function seriesPairs(games: ReadonlyMap<string, readonly unknown[]>, programs: ReadonlySet<string>): [string, string][] {
  return [...games]
    .flatMap(([key, played]): [string, string][] => {
      const [a, b] = key.split("|");
      return played.length >= MIN_MEETINGS && a !== b && programs.has(a) && programs.has(b) ? [[a, b]] : [];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

/** One played game of a pair, as the series rules read it: teams by name or slug, `disputed` a final the sources give different winners (ADR 0040). */
export type SeriesGame = { date: string; home: string; away: string; homeScore: number; awayScore: number; forfeit?: boolean; disputed?: boolean };

type Scored = Pick<SeriesGame, "home" | "homeScore" | "awayScore" | "disputed">;

/** The two scores from `first`'s side. */
const sides = (first: string, g: Scored) =>
  slugify(g.home) === first ? { us: g.homeScore, them: g.awayScore } : { us: g.awayScore, them: g.homeScore };

/**
 * The record from `first`'s side, the same rule as a program page's "All opponents" list (ADR 0013): the higher score is the
 * win, and a forfeit (recorded 1-0 or 2-0) counts as a win or a loss like any result. A disputed final has no winner the
 * sources agree on, so it is listed and never counted (ADR 0097, which narrows ADR 0040's "series still count it").
 */
export function seriesRecord(first: string, games: Scored[]): Tally {
  return tally(games.filter((g) => !g.disputed).map((g) => sides(first, g)));
}

/** "Jayton won 6, Guthrie won 3, 1 tie": the side ahead first (the first-named when level), a tie count only when there is one.
 * Words, never "6-3": a bare "1-0" reads as a forfeit score (ADR 0004). `t` is from `first`'s side. */
export function recordWords(first: string, second: string, t: Tally): string {
  const [lead, trail]: [[string, number], [string, number]] = t.lost > t.won ? [[second, t.lost], [first, t.won]] : [[first, t.won], [second, t.lost]];
  return [`${lead[0]} won ${lead[1]}`, `${trail[0]} won ${trail[1]}`, ...(t.tied ? [`${t.tied} ${t.tied === 1 ? "tie" : "ties"}`] : [])].join(", ");
}

/** A school's record against one opponent in words, from its own side: "won 5, lost 2, tied 1" (a tie only when there is one). */
export const recordAgainst = (t: Tally) => `won ${t.won}, lost ${t.lost}${t.tied ? `, tied ${t.tied}` : ""}`;

type Who = "first" | "second";

/** Who won a game by its score (a forfeit's too), "tie" when level, undefined for a disputed final: no winner is named. */
function winner(first: string, g: Scored): Who | "tie" | undefined {
  if (g.disputed) return undefined;
  const { us, them } = sides(first, g);
  return us > them ? "first" : us < them ? "second" : "tie";
}

/** A run of wins by one side. `current`: nothing has ended it, so the latest meeting is part of it. */
type Streak<G> = { who: Who; length: number; from: G; to: G; current: boolean };

/**
 * The longest run of meetings one side won in a row (a later run wins a tie in length). A tie, a game the other side won and a
 * disputed final (no winner) end a run; a forfeit counts as a win like any result (ADR 0013). Two wins in a row are the shortest
 * run named. `games` in any order; they are read oldest first, and an equal date keeps the order given.
 */
export function longestStreak<G extends SeriesGame>(first: string, games: readonly G[]): Streak<G> | undefined {
  const ordered = [...games].sort((a, b) => a.date.localeCompare(b.date));
  let top: { who: Who; length: number; from: G; to: G } | undefined;
  let run: typeof top;
  for (const g of ordered) {
    const w = winner(first, g);
    if (w !== "first" && w !== "second") {
      run = undefined;
      continue;
    }
    run = run && run.who === w ? { ...run, length: run.length + 1, to: g } : { who: w, length: 1, from: g, to: g };
    if (!top || run.length >= top.length) top = run;
  }
  if (!top || top.length < 2) return undefined;
  return { ...top, current: run?.from === top.from && run.who === top.who };
}

/**
 * Each side's biggest win by points: a forfeit has no margin, so it is never one, and a disputed final names no winner (ADR 0097).
 * The bigger margin, then the winner's higher score, then the later game. A side with no such win has none here.
 */
export function biggestWins<G extends SeriesGame>(first: string, games: readonly G[]): { first?: G; second?: G } {
  const best = new Map<Who, { g: G; margin: number; score: number }>();
  for (const g of games) {
    if (g.forfeit || winner(first, g) === undefined || winner(first, g) === "tie") continue;
    const { us, them } = sides(first, g);
    const [who, margin, score] = us > them ? (["first", us - them, us] as const) : (["second", them - us, them] as const);
    const was = best.get(who);
    if (!was || margin > was.margin || (margin === was.margin && (score > was.score || (score === was.score && g.date > was.g.date)))) best.set(who, { g, margin, score });
  }
  return { first: best.get("first")?.g, second: best.get("second")?.g };
}

/**
 * Every pair's games with each school counted under the program it became, as ADR 0003 and ADR 0072 count a program's history: a
 * game under a merged or renamed school's old slug (`successors`: old slug to the program's name, lib/lineage.ts `successorOf`)
 * belongs to the successor's pair. A game between the two halves of one merger is no pair. Each pair's list is oldest first.
 */
export function mergedPairs<E extends { result: { date: string } }>(pairs: ReadonlyMap<string, readonly E[]>, successors: ReadonlyMap<string, string>): Map<string, E[]> {
  const out = new Map<string, E[]>();
  for (const [key, played] of pairs) {
    const [a, b] = key.split("|").map((slug) => (successors.has(slug) ? slugify(successors.get(slug)!) : slug));
    if (a === b) continue;
    const into = [a, b].sort().join("|");
    out.set(into, [...(out.get(into) ?? []), ...played]);
  }
  for (const list of out.values()) list.sort((x, y) => x.result.date.localeCompare(y.result.date));
  return out;
}

/** A program's own slug and those of the schools that merged into it (ADR 0003), as its program page counts its finals. */
const names = (slug: string, lineage: { predecessor: string; successor: string }[]) =>
  new Set([slug, ...lineage.filter((l) => slugify(l.successor) === slug).map((l) => slugify(l.predecessor))]);

/** The state finals the two programs played each other in, newest first, merged schools included. */
export function finalsBetween(finals: Final[], a: string, b: string, lineage: { predecessor: string; successor: string }[]): Final[] {
  const [first, second] = [names(a, lineage), names(b, lineage)];
  return finals
    .filter((f) => {
      const [champion, runnerUp] = [slugify(f.champion), slugify(f.runnerUp)];
      return (first.has(champion) && second.has(runnerUp)) || (second.has(champion) && first.has(runnerUp));
    })
    .sort((x, y) => y.season - x.season || x.division.localeCompare(y.division));
}
