import { heading, loadAlignments, placeLabel } from "@/lib/alignments";
import { initials, loadGames, loadSeasonResults } from "@/lib/games";
import { memo } from "@/lib/memo";
import { lead, seasonRows } from "@/lib/program-games";
import { loadRanked, rankLabel } from "@/lib/rankings";
import { record } from "@/lib/ratings";
import { programCardText } from "@/lib/share-text";
import { CURRENT_SEASON } from "@/lib/season";
import { OPEN_GRAPH } from "@/lib/site";
import { EMPTY, loadIdentities } from "@/lib/identity";
import { cardSize } from "../../../page-card";

// What a program page's share card says (route.tsx draws it; the page's metadata uses the same words as the image's alt text).
// A module of its own: a route file may export nothing but its handlers. Once per program per build worker.

export const programCardOf = memo(async (slug: string) => {
  const [all, identities, ranked] = await Promise.all([loadAlignments(), loadIdentities(), loadRanked()]);
  const school = all.find((a) => a.slug === slug)!;
  const identity = identities.get(slug) ?? EMPTY;
  const r = ranked.teams.find((t) => t.school.slug === slug);
  const place = placeLabel(school);
  // The latest game with a score this season, the way the program page's "Latest score" box has it (lib/program-games.ts).
  const { latest } = seasonRows(school.school, await loadGames(all), await loadSeasonResults(CURRENT_SEASON));
  const text = programCardText({
    name: school.school,
    mascot: identity.mascot,
    group: heading(school),
    place: place === "Teams" ? "" : place,
    season: ranked.season,
    rank: r && rankLabel(r).text,
    record: r && record(r),
    latest: latest?.score ? { score: latest.score, versus: `${lead(latest)} ${latest.opponent}` } : undefined,
  });
  return { school, identity, text, initials: initials(school.school) };
});

/** The preview tags of a program page (and of each of its season pages): the program's card, 1200 by 630, with the words it says
 * as its alt text, for Open Graph and for a large Twitter card (ADR 0093). */
export async function programCardTags(slug: string) {
  const images = [{ url: `/programs/${slug}/card`, ...cardSize, alt: (await programCardOf(slug)).text.alt }];
  return { openGraph: { ...OPEN_GRAPH, images }, twitter: { card: "summary_large_image" as const, images } };
}
