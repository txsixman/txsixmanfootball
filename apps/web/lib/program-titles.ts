import { loadFinals } from "./champions";
import { countingRows, loadLineage } from "./lineage";
import { memo } from "./memo";
import { slugify } from "./slug";

/** UIL state titles by program slug (the archive's and any UIL State Championship the results robot has recorded that it does not
 * list yet, lib/champions.ts loadFinals; the private leagues' titles are counted apart, on the program page), a renamed or merged school's titles counted under the program it became (ADR 0072):
 * the figure a program page shows (app/programs/[slug]). Worked out once per build worker, so a page's description adds no
 * file read. Never mutate it. */
export const titlesBySlug = memo<void, Map<string, number>>(async () => {
  const [finals, lineage] = await Promise.all([loadFinals(), loadLineage()]);
  const successors = Map.groupBy(countingRows(lineage), (l) => slugify(l.predecessor));
  const titles = new Map<string, number>();
  for (const f of finals) {
    const champion = slugify(f.champion);
    for (const slug of new Set([champion, ...(successors.get(champion) ?? []).map((l) => slugify(l.successor))])) {
      titles.set(slug, (titles.get(slug) ?? 0) + 1);
    }
  }
  return titles;
});
