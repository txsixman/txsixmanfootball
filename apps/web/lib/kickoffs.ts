import { readFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./slug.ts";

// Kickoff times (ADR 0036) from data/seed/game-details/<season>.csv (date,home,away,kickoff_utc,site_name,site_city), the
// teams as the bracket rows spell them. Read at build time; a missing file means no time is known yet. A row that does not parse is dropped and
// counted on the build log, never shown.

const key = (date: string, a: string, b: string) => [date, ...[slugify(a), slugify(b)].sort()].join("|");
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const cache = new Map<number, Promise<Map<string, string>>>();

async function read(season: number): Promise<Map<string, string>> {
  const file = path.join(process.cwd(), "../../data/seed/game-details", `${season}.csv`);
  const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  const [header, ...lines] = text.trim().split("\n");
  const out = new Map<string, string>();
  if (!header) return out;
  if (header !== "date,home,away,kickoff_utc,site_name,site_city") throw new Error(`${file}: unexpected header ${header}`);
  let dropped = 0;
  for (const line of lines) {
    const [date, home, away, utc, , , ...rest] = line.split(",");
    if (rest.length || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !home || !away || (utc && !UTC.test(utc))) dropped++;
    else if (utc) out.set(key(date, home, away), utc);
  }
  if (dropped) console.warn(`${file}: ${dropped} row(s) dropped, not date,home,away,kickoff_utc`);
  return out;
}

/** The kickoff times of a season, by game. */
export function loadKickoffs(season: number): Promise<Map<string, string>> {
  if (!cache.has(season)) cache.set(season, read(season));
  return cache.get(season)!;
}

/** A game's kickoff (UTC) when known. */
export const kickoffOf = (kickoffs: Map<string, string>, date: string, home: string, away: string) => kickoffs.get(key(date, home, away));
