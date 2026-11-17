import { loadAlignments, slugify } from "./alignments";
import type { Game } from "./demo-games";
import { bracketGames, builtGamePages, gamePairs, type Entry } from "./game-pages";
import { loadLineage, successorOf } from "./lineage";
import { memo } from "./memo";
import { pairKey } from "./meetings";
import { mergedPairs, seriesPairs } from "./series";

/** A pair of programs with a page, `first` and `second` in alphabetical order, and every game they played (oldest first). */
type Series = { first: string; second: string; games: Entry[] };

/** A merged or renamed school's old slug to the program it became (lib/lineage.ts `successorOf`, ADR 0072). Shared: never mutate it. */
export const successors = memo<void, ReadonlyMap<string, string>>(async () => successorOf(await loadLineage()));

/** Every series page, worked out once per build worker (about 3,700 game pairs are checked). A merged or renamed school's old
 * games count under the program it became (ADR 0003, ADR 0097). Shared: never mutate it. */
export const loadSeries = memo<void, Series[]>(async () => {
  const [pairs, alignments, back] = await Promise.all([gamePairs(), loadAlignments(), successors()]);
  const merged = mergedPairs(pairs, back);
  return seriesPairs(merged, new Set(alignments.map((a) => a.slug))).map(([first, second]) => ({ first, second, games: merged.get(`${first}|${second}`)! }));
});

/** The programs each program has a series page with, by slug: the program page links to the ones it has. Shared: never mutate it. */
export const seriesPartners = memo<void, ReadonlyMap<string, ReadonlySet<string>>>(async () => {
  const partners = new Map<string, Set<string>>();
  for (const { first, second } of await loadSeries()) {
    partners.set(first, (partners.get(first) ?? new Set()).add(second));
    partners.set(second, (partners.get(second) ?? new Set()).add(first));
  }
  return partners;
});

/**
 * The games not yet played between two programs, by `pairKey`: the ones the bracket lists and the ones it sets with both teams
 * known (lib/game-pages.ts), earliest first and a game with no day last. The invented sample games never match a program.
 * Shared: never mutate it.
 */
export const upcomingMeetings = memo<void, ReadonlyMap<string, Game[]>>(async () => {
  const out = new Map<string, Game[]>();
  for (const g of [...(await bracketGames()), ...(await builtGamePages())]) {
    if (g.state !== "scheduled") continue;
    const key = pairKey(slugify(g.home.name), slugify(g.away.name));
    out.set(key, [...(out.get(key) ?? []), g]);
  }
  for (const list of out.values()) list.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.id.localeCompare(b.id));
  return out;
});
