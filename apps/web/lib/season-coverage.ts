import type { Alignment } from "./alignments";
import { slugify } from "./slug";

// How much of today's field a past season's games reach: the schools in the alignments a page covers, and how many of
// them have a game in that season's files. Past seasons are read from today's alignments only, so some schools are
// missing; the pages say so in one line.

export type Coverage = { played: number; total: number };

/** Schools in `alignments` (a school listed twice counts once, by slug) and how many have a game in `games`. */
export function seasonCoverage(alignments: Pick<Alignment, "slug">[], games: { home: string; away: string }[]): Coverage {
  const slugs = new Set(alignments.map((a) => a.slug));
  const seen = new Set(games.flatMap((g) => [slugify(g.home), slugify(g.away)]));
  return { played: [...slugs].filter((s) => seen.has(s)).length, total: slugs.size };
}

export const coverageLine = ({ played, total }: Coverage) => `Games from ${played} of ${total} schools for this season.`;
