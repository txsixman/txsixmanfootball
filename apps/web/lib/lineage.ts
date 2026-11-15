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

export type OtherName = { name: string; note: string; /** The program page to link, when that program has one. */ slug?: string };

type FinalYears = { season: number; champion: string; runnerUp: string }[];

/** A spelling's years are its school's finals, a bound: one final is exact, a span says "between" (it shows in some). */
const spellingNote = (span: string) => (span.includes(" to ") ? `in State Championship records between ${span.replace(" to ", " and ")}` : `in State Championships${span && ` ${span}`}`);

/** "1983", "1997 to 2017", or "" when the name has no state final: the seasons a name appears in the finals. */
const finalsSpan = (finals: FinalYears, name: string) => {
  const years = finals.filter((f) => slugify(f.champion) === slugify(name) || slugify(f.runnerUp) === slugify(name)).map((f) => f.season);
  if (years.length === 0) return "";
  const [first, last] = [Math.min(...years), Math.max(...years)];
  return first === last ? `${first}` : `${first} to ${last}`;
};

/**
 * A program's other names for its page, each with its years: the schools that merged into it (the merger year, then the
 * seasons the school played a state final), the program it merged into, if any, the older spellings UIL's state final
 * archive uses for it, and spellings a program merge folded into it. The finals file keeps only today's spelling, so a
 * spelling's years are those of its school's finals (the spelling shows in some of them). An alias that names a merged
 * school belongs to the program that school became. `programs`: slugs with a page, the only names that link. No source
 * is named (ADR 0010).
 */
export function otherNames(
  slug: string,
  lineage: Lineage[],
  aliases: Record<string, string>,
  { merges = new Map<string, string>(), finals = [], programs = new Set<string>() }: { merges?: Map<string, string>; finals?: FinalYears; programs?: ReadonlySet<string> } = {},
): OtherName[] {
  const successors = successorOf(lineage);
  const link = (name: string) => (programs.has(slugify(name)) ? { slug: slugify(name) } : {});
  const years = (name: string) => finalsSpan(finals, name);
  const merged = lineage
    .filter((l) => slugify(l.successor) === slug)
    .map((l) => ({
      name: l.predecessor,
      note: `${l.event === "consolidation" ? "merged into this program" : l.event} in ${l.season}${years(l.predecessor) && `, State Championships ${years(l.predecessor)}`}`,
      ...link(l.predecessor),
    }));
  const became = lineage
    .filter((l) => slugify(l.predecessor) === slug)
    .map((l) => ({ name: l.successor, note: `${l.event === "consolidation" ? "this school merged into it" : l.event} in ${l.season}`, ...link(l.successor) }));
  const spellings = Object.entries(aliases)
    .filter(([, current]) => slugify(successors.get(slugify(current)) ?? current) === slug)
    .map(([spelling, current]) => ({ name: spelling, note: spellingNote(years(current)) }));
  // A name the game files spell for this program (data/corrections/programs.csv, merged by the admin console).
  const spelled = [...merges].filter(([, program]) => slugify(program) === slug).map(([name]) => ({ name, note: "as written in game results" }));
  return [...merged, ...became, ...spellings, ...spelled];
}
