import { readFile } from "node:fs/promises";
import path from "node:path";
import { bracketSlots, fill, ROUND_ORDER, type FillGame } from "./bracket-fill.ts";
import { loadSlotRows } from "./bracket-slots.ts";
import { slugify } from "./slug.ts";
import { addressFrom, type Address } from "./address.ts";

// Kickoff times (ADR 0036), sites (ADR 0041) and site addresses (ADR 0066) from data/seed/game-details/<season>.csv
// (date,home,away,kickoff_utc,site_name,site_city,site_street,site_state,site_zip; a file from before addresses has the
// first six), the teams as the bracket rows spell them. Read at build time; a missing
// file means nothing is known yet. A row that does not parse is dropped and counted on the build log, never shown.

const key = (date: string, a: string, b: string) => [date, ...[slugify(a), slugify(b)].sort()].join("|");
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** A game of the file by its two teams alone (ADR 0067): a next-round pairing no listing dates yet finds its game here. */
type PairDetail = { date: string; kickoff?: string; site?: string; address?: Address };
type Details = { kickoffs: Map<string, string>; sites: Map<string, string>; addresses: Map<string, Address>; pairs: Map<string, PairDetail[]> };
const pairKey = (a: string, b: string) => [slugify(a), slugify(b)].sort().join("|");
const HEADER = "date,home,away,kickoff_utc,site_name,site_city";
const ADDRESS_HEADER = `${HEADER},site_street,site_state,site_zip`;
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
  const addresses = new Map<string, Address>();
  const pairs = new Map<string, PairDetail[]>();
  if (!header) return { kickoffs: out, sites, addresses, pairs };
  if (header !== HEADER && header !== ADDRESS_HEADER) throw new Error(`${file}: unexpected header ${header}`);
  const width = header.split(",").length;
  let dropped = 0;
  for (const line of lines) {
    const fields = line.split(",");
    const [date, home, away, utc, name, city, street, state, zip] = fields;
    if (fields.length !== width || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !home || !away || (utc && !UTC.test(utc))) {
      dropped++;
      continue;
    }
    if (utc) out.set(key(date, home, away), utc);
    // A site is its name, with its city when known: "Shotwell Stadium, Abilene".
    if (name) sites.set(key(date, home, away), city ? `${name}, ${city}` : name);
    const address = name ? addressFrom({ site_street: street, site_city: city, site_state: state, site_zip: zip }) : undefined;
    if (address) addresses.set(key(date, home, away), address);
    if (utc || name) {
      const list = pairs.get(pairKey(home, away)) ?? [];
      list.push({ date, ...(utc && { kickoff: utc }), ...(name && { site: city ? `${name}, ${city}` : name }), ...(address && { address }) });
      pairs.set(pairKey(home, away), list);
    }
  }
  if (dropped) console.warn(`${file}: ${dropped} row(s) dropped, not date,home,away,kickoff_utc`);
  // What a league's own bracket lists for a game now on the schedule (ADR 0047), only where this file has nothing: a kept
  // detail is never overwritten (ADR 0041).
  for (const d of await bracketDetails(season)) {
    if (d.utc && !out.has(d.key)) out.set(d.key, d.utc);
    if (d.site && !sites.has(d.key)) sites.set(d.key, d.site);
  }
  return { kickoffs: out, sites, addresses, pairs };
}

const centralDate = (utc: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(utc));

/** The kickoff and site a bracket slot lists, keyed to the listed game that fills it. A kickoff on another day than the
 * listed game's is not used: the listing's date stands. */
async function bracketDetails(season: number): Promise<{ key: string; utc?: string; site?: string }[]> {
  const rows = (await loadSlotRows(season)).filter((r) => r.kickoff_utc || r.site);
  if (!rows.length) return [];
  const file = path.join(process.cwd(), "../../data/seed", `maxpreps-${season}`, "playoffs.csv");
  const [header, ...lines] = (await readFile(file, "utf8").catch(() => "")).trim().split("\n");
  const cols = (header ?? "").split(",");
  const games = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v]))).map((r) => ({
    league: r.league, division: r.division,
    game: { round: r.round, date: r.game_date, home: r.home, away: r.away, confirmed: false } satisfies FillGame,
  }));
  const out: { key: string; utc?: string; site?: string }[] = [];
  for (const [both, list] of Map.groupBy(rows, (r) => `${r.league}|${r.division}`)) {
    const [league, division] = both.split("|");
    const listed = games.filter((g) => g.league === league && g.division === division).map((g) => g.game);
    const slots = bracketSlots(await loadSlotRows(season), listed, { league, division });
    for (const f of fill(slots, listed, ROUND_ORDER)) {
      const r = list.find((x) => x.slot === f.slot.slot);
      if (!r || !f.game) continue;
      out.push({
        key: key(f.game.date, f.game.home, f.game.away),
        ...(r.kickoff_utc && centralDate(r.kickoff_utc) === f.game.date ? { utc: r.kickoff_utc } : {}),
        ...(r.site ? { site: r.site } : {}),
      });
    }
  }
  return out;
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
export const siteOf = (sites: Map<string, string>, date: string, home: string, away: string) => knownSite(sites, date, home, away) ?? NO_SITE;

/** The facts file's games by their two teams, for next-round pairings no listing dates yet (ADR 0067). */
export const loadPairDetails = async (season: number): Promise<Map<string, PairDetail[]>> => (await details(season)).pairs;

/** The first game of the file between two teams after `after` (the later of their last listed games), or undefined. */
export const pairDetailAfter = (pairs: Map<string, PairDetail[]>, a: string, b: string, after: string): PairDetail | undefined =>
  (pairs.get(pairKey(a, b)) ?? []).filter((d) => d.date > after).sort((x, y) => x.date.localeCompare(y.date))[0];

/** The street addresses of a season's sites, by game (ADR 0066). */
export const loadAddresses = async (season: number): Promise<Map<string, Address>> => (await details(season)).addresses;

/** A game's site address when the facts file has one; undefined otherwise. Only with the file's own site, never a bracket's. */
export const knownAddress = (addresses: Map<string, Address>, date: string, home: string, away: string): Address | undefined => addresses.get(key(date, home, away));

/** A game's site when the facts file has one, played or not (ADR 0065); undefined otherwise. */
export const knownSite = (sites: Map<string, string>, date: string, home: string, away: string): string | undefined => sites.get(key(date, home, away));
