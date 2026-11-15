import { readFile } from "node:fs/promises";
import path from "node:path";
import { HOME_FIELD_COLUMNS, HomeFieldRow, parseCsv } from "./data-schemas.ts";
import { memo } from "./memo.ts";
import { slugify } from "./slug.ts";

// Each program's own field (ADR 0061): data/seed/schools/home-fields.csv, by program slug, from where it played its regular-season
// home games. Read at build time; a missing file means none is known. No page names where a field came from (ADR 0010).

/** Each program's field ("Jaybird Stadium, Jayton") and the season it was seen, by program slug. */
export type HomeFields = Map<string, { site: string; season: number }>;

export function parseHomeFields(text: string): HomeFields {
  if (!text.trim()) return new Map();
  return new Map(parseCsv("data/seed/schools/home-fields.csv", text, HOME_FIELD_COLUMNS, HomeFieldRow).map(({ row }) => [row.program, { site: `${row.site_name}, ${row.site_city}`, season: Number(row.season) }]));
}

/**
 * A regular-season game's site line: the home team's own field when it is known for that season and the game is not
 * marked neutral ("Jaybird Stadium, Jayton (home)"), else the home team ("Jayton (home)"), or "Neutral site". Another
 * season's field is not used: a program can move.
 */
export function regularSeasonSite(fields: HomeFields, home: string, neutral: boolean, season: number): string {
  if (neutral) return "Neutral site";
  const field = fields.get(slugify(home));
  return field && field.season === season ? `${field.site} (home)` : `${home} (home)`;
}

const read = () =>
  readFile(path.join(process.cwd(), "../../data/seed/schools/home-fields.csv"), "utf8").then(parseHomeFields, (e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return new Map() as HomeFields;
    throw e;
  });

/** Read once per process: never mutate it. */
export const loadHomeFields = memo<void, HomeFields>(read);
