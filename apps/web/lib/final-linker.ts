import type { Alignment } from "./alignments";
import { EMPTY, type Identity } from "./identity";
import { slugify } from "./slug";

/** Where a state-final team name leads: its program page and logo, or, for a school that merged or renamed, the program it
 * became (`now`, ADR 0003) with a plain badge; a school with no program today has no link. */
export type Linker = (name: string) => { href?: string; identity: Identity; now?: string };

/** `successors`: lib/lineage.ts `successorOf`. Shared by the state championships page and the season pages. */
export function finalLinker(alignments: Alignment[], identities: ReadonlyMap<string, Identity>, successors: ReadonlyMap<string, string>): Linker {
  const slugs = new Set(alignments.map((a) => a.slug));
  return (name) => {
    const slug = slugify(name);
    if (slugs.has(slug)) return { href: `/programs/${slug}`, identity: identities.get(slug) ?? EMPTY };
    const now = successors.get(slug);
    return now && slugs.has(slugify(now)) ? { href: `/programs/${slugify(now)}`, identity: EMPTY, now } : { identity: EMPTY };
  };
}
