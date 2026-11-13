import { loadAlignments } from "./alignments";
import { gamePairs, type Entry } from "./game-pages";
import { memo } from "./memo";
import { seriesPairs } from "./series";

/** A pair of programs with a page, `first` and `second` in alphabetical order, and every game they played (oldest first). */
type Series = { first: string; second: string; games: Entry[] };

/** Every series page, worked out once per build worker (about 2,500 game pairs are checked). Shared: never mutate it. */
export const loadSeries = memo<void, Series[]>(async () => {
  const [pairs, alignments] = await Promise.all([gamePairs(), loadAlignments()]);
  return seriesPairs(pairs, new Set(alignments.map((a) => a.slug))).map(([first, second]) => ({ first, second, games: pairs.get(`${first}|${second}`)! }));
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
