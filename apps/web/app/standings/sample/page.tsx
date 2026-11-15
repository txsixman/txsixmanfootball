import type { Metadata } from "next";
import type { Alignment } from "@/lib/alignments";
import { slugify } from "@/lib/slug";
import type { SeasonResult } from "@/lib/games";
import { standingsFrom } from "@/lib/standings";
import { PageHeader } from "../../ui";
import { StandingsLevels } from "../view";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Sample standings", robots: { index: false } };

// Invented schools in two regions of four districts, for the whole-page screenshots (e2e/screenshots.spec.ts): the real
// standings change every game week. Each district plays a round robin, then one game against its pair district.
const PLACES = ["Cedar Gap", "Salt Fork", "Dry Wash", "Mesa Verde", "Far Hill", "Low Creek", "Red Bluff", "Pine Hollow", "Stone Ford", "Elm Bend", "Owl Prairie", "Hawk Ridge", "Fox Run", "Iron Draw", "Quail Flat", "Bison Spring", "Lark Hill", "Wren Valley", "Juniper Mesa", "Coyote Wells", "Sage Creek", "Bluebonnet", "Kite Lake", "Granite Point"];
const alignments: Alignment[] = PLACES.map((school, i) => ({
  league: "UIL",
  division: "I",
  region: String(Math.floor(i / 12) + 1),
  district: String(Math.floor(i / 3) + 1),
  school,
  sourceUrl: "",
  span: "2026-28",
  slug: slugify(school),
}));
const score = (a: number, b: number) => 20 + ((a * 37 + b * 11) % 50);
const game = (date: string, h: number, a: number): SeasonResult => ({ id: `${date}-${h}-${a}`, href: "", date, status: "final", home: PLACES[h], away: PLACES[a], homeScore: score(h, a), awayScore: score(a, h), forfeit: false });
const results: SeasonResult[] = [];
for (let d = 0; d < 8; d++) {
  const [x, y, z] = [d * 3, d * 3 + 1, d * 3 + 2];
  results.push(game("2026-10-02", x, y), game("2026-10-09", y, z), game("2026-10-16", z, x));
  const pair = d % 2 ? d - 1 : d + 1;
  results.push(game("2026-09-04", x, pair * 3 + 2));
}

export default function SampleStandingsPage() {
  const districts = standingsFrom(alignments, results, new Set());
  return (
    <section aria-labelledby="standings">
      <PageHeader id="standings" eyebrow="Sample standings. Invented schools." title="Standings" note={`${districts.length} districts in two regions.`} />
      <StandingsLevels districts={districts} identities={new Map()} idPrefix="sample" />
    </section>
  );
}
