import { loadAlignments } from "@/lib/alignments";
import { stateCardTitle } from "@/app/scores/[id]/card/state-card";
import { loadRatings, record } from "@/lib/ratings";
import { CURRENT_SEASON } from "@/lib/season";
import { championshipCardText } from "@/lib/share-text";
import { slugify } from "@/lib/slug";
import { stateChampionships } from "@/lib/state-championships";
import { cardSize } from "../../../../page-card";

// What a State Championship page's share card says (route.tsx draws it; the page's metadata uses the same words as the image's
// alt text). A module of its own: a route file may export nothing but its handlers.

const find = async (year: string, bracket: string) =>
  (await stateChampionships(CURRENT_SEASON)).find((c) => String(c.season) === year && c.slug === bracket);

export async function championshipCardOf(year: string, bracket: string) {
  const c = (await find(year, bracket))!;
  // The season record the page shows for each team (the ratings table's won-lost), for a game still to play.
  const rows = new Map((await loadRatings(c.season)).teams.map((t) => [slugify(t.team), t]));
  const side = (s: (typeof c.sides)[number]) => {
    const row = s.team ? rows.get(slugify(s.team)) : undefined;
    return { text: s.text, known: s.team !== undefined, record: row && record(row) };
  };
  const title = stateCardTitle(c.season, c.bracket);
  const text = championshipCardText({
    title,
    sides: [side(c.sides[0]), side(c.sides[1])],
    date: c.date,
    kickoff: c.kickoff,
    site: c.site,
    final: c.final,
    scores: c.scores,
  });
  return { c, text, alignments: await loadAlignments() };
}

/** The preview tags of a State Championship page: its card, 1200 by 630, with the words it says as its alt text, for Open Graph
 * and for a large Twitter card (ADR 0093). */
export async function championshipCardTags(year: string, bracket: string) {
  const images = [{ url: `/championships/${year}/${bracket}/card`, ...cardSize, alt: (await championshipCardOf(year, bracket)).text.alt }];
  return { openGraph: { images }, twitter: { card: "summary_large_image" as const, images } };
}
