import { readFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./slug.ts";

// Finals the sources disagree on, with a different winner (ADR 0040): data/seed/disputed/<season>.csv (game_date,home,away),
// teams as the bracket and results rows spell them. Such a final is "disputed": its score shows, no winner is marked. Read at
// build time; a missing file means none. A row that does not parse fails the build (check-data.mjs checks it first).

const key = (date: string, a: string, b: string) => [date, ...[slugify(a), slugify(b)].sort()].join("|");
const cache = new Map<number, Promise<Set<string>>>();

async function read(season: number): Promise<Set<string>> {
  const file = path.join(process.cwd(), "../../data/seed/disputed", `${season}.csv`);
  const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  const [header, ...lines] = text.trim().split("\n");
  const out = new Set<string>();
  if (!header) return out;
  if (header !== "game_date,home,away") throw new Error(`${file}: unexpected header ${header}`);
  for (const line of lines) {
    const [date, home, away, ...rest] = line.split(",");
    if (rest.length || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !home || !away) throw new Error(`${file}: bad row ${line}`);
    out.add(key(date, home, away));
  }
  return out;
}

/** The disputed finals of a season, by game. */
export function loadDisputed(season: number): Promise<Set<string>> {
  if (!cache.has(season)) cache.set(season, read(season));
  return cache.get(season)!;
}

/** Whether a final is disputed. */
export const isDisputed = (disputed: Set<string>, date: string, home: string, away: string) => disputed.has(key(date, home, away));
