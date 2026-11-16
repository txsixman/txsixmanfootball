import { readFile } from "node:fs/promises";
import path from "node:path";
import { AliasesFile, LINEAGE_COLUMNS, type LINEAGE_EVENTS, LineageRow, NAME_COLUMNS, NameRow, parseCsv, parseJson } from "./data-schemas";
import { memo } from "./memo";
import { slugify } from "./slug";

// Mergers and renames from data/seed/lineage/programs.csv (ADR 0003) and other names of one school from
// data/seed/lineage/names.csv (ADR 0072): hand files, one cited source a row. The CSVs keep each source; pages do not
// show it (ADR 0010).

export type Lineage = { predecessor: string; successor: string; event: (typeof LINEAGE_EVENTS)[number]; season: number };
/** A spelling or a former name of one school, no lineage event. `until`: the former name's last season, if known. */
type SchoolName = { name: string; program: string; kind: "spelling" | "former"; until?: number };

async function readSeed(file: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(process.cwd(), "../..", file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadLineage(): Promise<Lineage[]> {
  const file = "data/seed/lineage/programs.csv";
  const text = await readSeed(file);
  if (!text) return [];
  return parseCsv(file, text, LINEAGE_COLUMNS, LineageRow).map(({ row }) => ({
    predecessor: row.predecessor,
    successor: row.successor,
    event: row.event,
    season: Number(row.season),
  }));
}

export async function loadNames(): Promise<SchoolName[]> {
  const file = "data/seed/lineage/names.csv";
  const text = await readSeed(file);
  if (!text) return [];
  return parseCsv(file, text, NAME_COLUMNS, NameRow).map(({ row }) => ({
    name: row.name,
    program: row.program,
    kind: row.kind,
    ...(row.until ? { until: Number(row.until) } : {}),
  }));
}

/** How many programs each predecessor went to: more than one is a split, whose history belongs to none of them. */
const successorCounts = (lineage: Lineage[]) => {
  const counts = new Map<string, number>();
  for (const l of lineage) counts.set(slugify(l.predecessor), (counts.get(slugify(l.predecessor)) ?? 0) + 1);
  return counts;
};

/**
 * The rows whose predecessor's State Championships count toward the successor (ADR 0072): a rename, or a consolidation
 * into one program. An annexation, a split, or a co-op lists the name on the page but keeps its finals under it.
 */
export function countingRows(lineage: Lineage[]): Lineage[] {
  const counts = successorCounts(lineage);
  return lineage.filter((l) => (l.event === "rename" || l.event === "consolidation") && counts.get(slugify(l.predecessor)) === 1);
}

/** Former name's slug → today's program, for the rows that count (e.g. "wellman" → Wellman-Union). */
export const successorOf = (lineage: Lineage[]) => new Map(countingRows(lineage).map((l) => [slugify(l.predecessor), l.successor]));

/** UIL's own spellings of schools in its state final archive → the current name (tools/history/uil-aliases.json). */
export const loadAliases = memo<void, Record<string, string>>(async () => {
  const file = "tools/history/uil-aliases.json";
  const { _note, ...aliases } = parseJson(file, await readFile(path.join(process.cwd(), "../..", file), "utf8"), AliasesFile);
  return aliases;
});

/** Where a name sits on the page: the schools a program was formed from, what it became, and its other names. */
type OtherNameGroup = "formed" | "became" | "name";
export type OtherName = { name: string; note: string; group: OtherNameGroup; /** The program page to link, when that program has one. */ slug?: string };

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

/** On the successor's page: what happened to the school it was formed from. `split`: the school went to more than one. */
function formedNote(l: Lineage, split: boolean): string {
  if (split || l.event === "split") return `part of its district joined this program's in ${l.season}`;
  if (l.event === "consolidation") return `merged into this program in ${l.season}`;
  if (l.event === "annexation") return `its district joined this program's in ${l.season}`;
  if (l.event === "rename") return `renamed in ${l.season}`;
  return `a co-op with this program from ${l.season}`;
}

/** On the predecessor's page (when it still has one): what it became. */
function becameNote(l: Lineage, split: boolean): string {
  if (split || l.event === "split") return `part of this district joined it in ${l.season}`;
  if (l.event === "consolidation") return `this school merged into it in ${l.season}`;
  if (l.event === "annexation") return `this district joined it in ${l.season}`;
  if (l.event === "rename") return `this program's name from ${l.season}`;
  return `a co-op with this program from ${l.season}`;
}

/**
 * A program's other names for its page, each with its years, in three groups: the schools it was formed from (the year,
 * then the seasons that school played a state final), the programs it became, and its other names (older spellings UIL's
 * state final archive uses, the spellings and former names in names.csv, and spellings a program merge folded into it).
 * The finals file keeps only today's spelling, so a UIL spelling's years are those of its school's finals (the spelling
 * shows in some of them). An alias that names a merged school belongs to the program that school became. `programs`:
 * slugs with a page, the only names that link. No source is named (ADR 0010).
 */
export function otherNames(
  slug: string,
  lineage: Lineage[],
  aliases: Record<string, string>,
  {
    merges = new Map<string, string>(),
    finals = [],
    programs = new Set<string>(),
    names = [],
  }: { merges?: Map<string, string>; finals?: FinalYears; programs?: ReadonlySet<string>; names?: SchoolName[] } = {},
): OtherName[] {
  const successors = successorOf(lineage);
  const counts = successorCounts(lineage);
  const link = (name: string) => (programs.has(slugify(name)) ? { slug: slugify(name) } : {});
  const years = (name: string) => finalsSpan(finals, name);
  const split = (l: Lineage) => (counts.get(slugify(l.predecessor)) ?? 0) > 1;
  const formed = lineage
    .filter((l) => slugify(l.successor) === slug)
    .map((l) => ({
      name: l.predecessor,
      note: `${formedNote(l, split(l))}${years(l.predecessor) && `, State Championships ${years(l.predecessor)}`}`,
      group: "formed" as const,
      ...link(l.predecessor),
    }));
  const became = lineage
    .filter((l) => slugify(l.predecessor) === slug)
    .map((l) => ({ name: l.successor, note: becameNote(l, split(l)), group: "became" as const, ...link(l.successor) }));
  const spellings = Object.entries(aliases)
    .filter(([, current]) => slugify(successors.get(slugify(current)) ?? current) === slug)
    .map(([spelling, current]) => ({ name: spelling, note: spellingNote(years(current)), group: "name" as const }));
  const own = names
    .filter((n) => slugify(n.program) === slug)
    .map((n) => ({
      name: n.name,
      note: n.kind === "spelling" ? "an older spelling" : `former name${n.until ? `, through ${n.until}` : ""}`,
      group: "name" as const,
    }));
  // A name the game files spell for this program (data/corrections/programs.csv, merged by the admin console).
  const spelled = [...merges].filter(([, program]) => slugify(program) === slug).map(([name]) => ({ name, note: "as written in game results", group: "name" as const }));
  return [...formed, ...became, ...spellings, ...own, ...spelled];
}
