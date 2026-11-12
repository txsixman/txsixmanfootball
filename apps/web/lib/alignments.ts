import { readFile } from "node:fs/promises";
import path from "node:path";
import { ALIGNMENT_COLUMNS, AlignmentRow, parseCsv } from "./data-schemas";

export type Alignment = {
  league: string;
  division: string;
  region: string;
  district: string;
  school: string;
  sourceUrl: string;
  /** The years this alignment covers, as the league states them. */
  span: string;
  slug: string;
};
export type DistrictGroup = { heading: string; region: string; district: string; schools: Alignment[] };

const SEEDS = [
  { dir: "uil-2026-28", span: "2026-28" },
  { dir: "tapps-2026-28", span: "2026-28" },
  { dir: "private-2026", span: "2026" },
];

import { memo } from "./memo";
import { slugify } from "./slug";

export { slugify };

// Read at build time, once per process (shared: never mutate it). The database replaces this once a Supabase project exists.
export const loadAlignments = memo<void, Alignment[]>(async () => {
  const files = await Promise.all(
    SEEDS.map(async ({ dir, span }) => ({
      span,
      text: await readFile(path.join(process.cwd(), `../../data/seed/${dir}/alignments.csv`), "utf8"),
    })),
  );
  return files.flatMap(({ span, text }, i) =>
    parseCsv(`data/seed/${SEEDS[i].dir}/alignments.csv`, text, ALIGNMENT_COLUMNS, AlignmentRow).map(({ row }) => ({
      league: row.league,
      division: row.division,
      region: row.region,
      district: row.district,
      school: row.school,
      sourceUrl: row.source_url,
      span,
      slug: slugify(row.school),
    })),
  );
});

const indexes = new WeakMap<Alignment[], Map<string, Alignment[]>>();

/** The program a team name from any game file means, found by slug so case, apostrophes and spacing never lose the
 * link. A school listed in two leagues has one row each (ADR 0012): the one in `league` wins when the page knows its
 * organization, else the first in file order (UIL, TAPPS, then the private files), so the answer never depends on
 * iteration order. */
export function programFor(alignments: Alignment[], name: string, league?: string): Alignment | undefined {
  const found = programsFor(alignments, name);
  return found.find((a) => a.league === league) ?? found[0];
}

/** Every alignment row a team name means: one per league that lists the school (two for Sherman Grayson Christian
 * School, in TAIAO and TCAF), in file order; none for a team no alignment knows. */
export function programsFor(alignments: Alignment[], name: string): Alignment[] {
  let index = indexes.get(alignments);
  if (!index) {
    index = new Map();
    for (const a of alignments) index.set(a.slug, [...(index.get(a.slug) ?? []), a]);
    indexes.set(alignments, index);
  }
  return index.get(slugify(name)) ?? [];
}

/** One alignment per slug (the first), for static params: a slug listed twice must not be generated twice. */
export function uniquePrograms(alignments: Alignment[]): Alignment[] {
  const seen = new Set<string>();
  return alignments.filter((a) => !seen.has(a.slug) && seen.add(a.slug));
}

export function heading({ league, division, region }: Pick<Alignment, "league" | "division" | "region">): string {
  if (division === "Six-Man") return league;
  return Number(region) ? `${league} Division ${division}` : `${league} Division ${division} ${region}`.trim();
}

/** "Region 2 · District 5", "District 3", "Independent", or "Teams" for a league without districts. */
export function placeLabel({ region, district }: Pick<Alignment, "region" | "district">): string {
  if (district === "0") return "Teams";
  if (!/^\d+$/.test(district)) return district;
  return Number(region) ? `Region ${region} · District ${district}` : `District ${district}`;
}

export function byDistrict(rows: Alignment[]): DistrictGroup[] {
  const groups = new Map<string, DistrictGroup>();
  for (const row of rows) {
    const title = heading(row);
    const key = `${title}|${row.district}`;
    const group = groups.get(key) ?? { heading: title, region: row.region, district: row.district, schools: [] };
    group.schools.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}
