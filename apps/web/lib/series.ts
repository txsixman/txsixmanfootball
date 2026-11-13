// The series pages' rules (/series/<a>/<b>, app/series): which pairs of programs get a page, where it lives, the record
// from the first-named side and the state finals between the pair. Pure: it imports only types and two import-free files,
// so node can test it (scripts/series.test.mjs). lib/series-data.ts feeds it the data.
import type { Final } from "./champions.ts";
import { tally, type Tally } from "./program-history.ts";
import { slugify } from "./slug.ts";

/** A pair needs this many games in the seasons read before it has a page: two games are not a series. */
export const MIN_MEETINGS = 3;

/** The address of a pair's page. The slugs are in alphabetical order whichever way they are given, and that order is the
 * only address that has a page (the reversed one is a 404, so a pair never has two pages). The same sort as `pairKey`. */
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

/**
 * The record from `first`'s side, the same rule as a program page's "All opponents" list (ADR 0013): the higher score is the
 * win, scores may be unconfirmed, and a forfeit (recorded 1-0 or 2-0) counts as a win or a loss like any result.
 */
export function seriesRecord(first: string, games: { home: string; homeScore: number; awayScore: number }[]): Tally {
  return tally(games.map((g) => (slugify(g.home) === first ? { us: g.homeScore, them: g.awayScore } : { us: g.awayScore, them: g.homeScore })));
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
