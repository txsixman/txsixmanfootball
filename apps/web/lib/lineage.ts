import { readFile } from "node:fs/promises";
import path from "node:path";
import { AliasesFile, LINEAGE_COLUMNS, LineageRow, parseCsv, parseJson } from "./data-schemas";
import { memo } from "./memo";
import { slugify } from "./slug";

// Mergers and renames from data/seed/lineage/programs.csv (ADR 0003): a hand file, one cited source a row. The CSV
// keeps each source; pages do not show it (ADR 0010).

export type Lineage = { predecessor: string; successor: string; event: string; season: number };

export async function loadLineage(): Promise<Lineage[]> {
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), "../../data/seed/lineage/programs.csv"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return parseCsv("data/seed/lineage/programs.csv", text, LINEAGE_COLUMNS, LineageRow).map(({ row }) => ({
    predecessor: row.predecessor,
    successor: row.successor,
    event: row.event,
    season: Number(row.season),
  }));
}

/** Former name's slug → today's program, e.g. "wellman" → Wellman-Union. */
export const successorOf = (lineage: Lineage[]) => new Map(lineage.map((l) => [slugify(l.predecessor), l.successor]));

/** UIL's own spellings of schools in its state final archive → the current name (tools/history/uil-aliases.json). */
export const loadAliases = memo<void, Record<string, string>>(async () => {
  const file = "tools/history/uil-aliases.json";
  const { _note, ...aliases } = parseJson(file, await readFile(path.join(process.cwd(), "../..", file), "utf8"), AliasesFile);
  return aliases;
});

export type OtherName = { name: string; note: string };

/**
 * A program's other names for its page: the schools that merged into it (with the year) and the older spellings UIL's
 * state final records use for it, and spellings a program merge folded into it. An alias that names a merged school belongs to the program that school became. No
 * source is named (ADR 0010).
 */
export function otherNames(slug: string, lineage: Lineage[], aliases: Record<string, string>, merges: Map<string, string> = new Map()): OtherName[] {
  const successors = successorOf(lineage);
  const merged = lineage
    .filter((l) => slugify(l.successor) === slug)
    .map((l) => ({ name: l.predecessor, note: l.event === "consolidation" ? `merged in ${l.season}` : `${l.event} in ${l.season}` }));
  const spellings = Object.entries(aliases)
    .filter(([, current]) => slugify(successors.get(slugify(current)) ?? current) === slug)
    .map(([spelling]) => ({ name: spelling, note: "as listed in state final records" }));
  // A name the game files spell for this program (data/corrections/programs.csv, merged by the admin console).
  const spelled = [...merges].filter(([, program]) => slugify(program) === slug).map(([name]) => ({ name, note: "as written in game results" }));
  return [...merged, ...spellings, ...spelled];
}
