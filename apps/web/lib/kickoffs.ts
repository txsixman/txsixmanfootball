import { readFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./slug.ts";

// Kickoff times (ADR 0036) and sites (ADR 0041) from data/seed/game-details/<season>.csv
// (date,home,away,kickoff_utc,site_name,site_city), the teams as the bracket rows spell them. Read at build time; a missing
// file means nothing is known yet. A row that does not parse is dropped and counted on the build log, never shown.

const key = (date: string, a: string, b: string) => [date, ...[slugify(a), slugify(b)].sort()].join("|");
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
type Details = { kickoffs: Map<string, string>; sites: Map<string, string> };
const cache = new Map<number, Promise<Details>>();

async function read(season: number): Promise<Details> {
  const file = path.join(process.cwd(), "../../data/seed/game-details", `${season}.csv`);
  const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  const [header, ...lines] = text.trim().split("\n");
  const out = new Map<string, string>();
  const sites = new Map<string, string>();
  if (!header) return { kickoffs: out, sites };
  if (header !== "date,home,away,kickoff_utc,site_name,site_city") throw new Error(`${file}: unexpected header ${header}`);
  let dropped = 0;
  for (const line of lines) {
    const [date, home, away, utc, name, city, ...rest] = line.split(",");
    if (rest.length || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !home || !away || (utc && !UTC.test(utc))) {
      dropped++;
      continue;
    }
    if (utc) out.set(key(date, home, away), utc);
    // A site is its name, with its city when known: "Shotwell Stadium, Abilene".
    if (name) sites.set(key(date, home, away), city ? `${name}, ${city}` : name);
  }
  if (dropped) console.warn(`${file}: ${dropped} row(s) dropped, not date,home,away,kickoff_utc`);
  return { kickoffs: out, sites };
}

const details = (season: number) => {
  if (!cache.has(season)) cache.set(season, read(season));
  return cache.get(season)!;
};

/** The kickoff times of a season, by game. */
export const loadKickoffs = async (season: number): Promise<Map<string, string>> => (await details(season)).kickoffs;

/** The sites of a season's games, by game: "<name>, <city>". */
export const loadSites = async (season: number): Promise<Map<string, string>> => (await details(season)).sites;

/** A game's kickoff (UTC) when known. */
export const kickoffOf = (kickoffs: Map<string, string>, date: string, home: string, away: string) => kickoffs.get(key(date, home, away));

/** What a bracket game's page says of where it is played: the site when known, never a guess (ADR 0041). A bracket's home
 * team is only its designation, so it is not taken as the site. */
export const NO_SITE = "Site not listed yet";
export const siteOf = (sites: Map<string, string>, date: string, home: string, away: string) => sites.get(key(date, home, away)) ?? NO_SITE;
