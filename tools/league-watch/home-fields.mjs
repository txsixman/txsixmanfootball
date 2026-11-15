// Home fields (ADR 0064): each program's own field, from where it played its regular-season home games. Run by hand after
// a venues read (davecampbells.mjs --venues <year>, private):
//   node tools/league-watch/home-fields.mjs <year> --private <private data repo> [--out data/seed/schools/home-fields.csv]
// reads <private>/davecampbells-<year>/venues.csv and writes data/seed/schools/home-fields.csv: program (its slug), the field's name
// and city as ADR 0041 keeps a site (plain words), the season it was seen, and the field's street address where the read
// has one (ADR 0066). No source column (ADR 0010).
// A program gets a field only when at least 2 of its regular-season home games, and at least two thirds of those with a
// venue, were played there. A program the read gives no field keeps its row; one it gives a field gets that season's.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteText, VENUE_COLUMNS } from "./davecampbells.mjs";
import { parseCsv } from "./store.mjs";

export const HOME_FIELD_COLUMNS = ["program", "site_name", "site_city", "season", "site_street", "site_state", "site_zip"];
const ADDRESS = ["site_street", "site_state", "site_zip"];
export const MIN_GAMES = 2;
export const MIN_SHARE = 2 / 3;

/** Each program's home field from a season's venue rows: the venue of most of its regular-season home games, when that
 * venue holds at least MIN_GAMES of them and MIN_SHARE of those with a venue, and has both a name and a city. */
export function homeFields(rows, season) {
  const byProgram = Map.groupBy(rows.filter((r) => r.phase === "regular" && r.site_name && r.site_city), (r) => r.home);
  const out = [];
  for (const [program, games] of byProgram) {
    const at = Map.groupBy(games, (r) => `${r.site_name}|${r.site_city}`);
    const [where, list] = [...at].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
    const tied = [...at.values()].filter((l) => l.length === list.length).length > 1;
    if (tied || list.length < MIN_GAMES || list.length < MIN_SHARE * games.length) continue;
    const [name, city] = where.split("|");
    const site_name = siteText(name, 80);
    const site_city = siteText(city, 60);
    // The field's address: the one most of its games there give (ADR 0066), blank when none does.
    const streets = Map.groupBy(list.filter((r) => r.site_street), (r) => `${r.site_street}|${r.site_state ?? ""}|${r.site_zip ?? ""}`);
    const [address = "||"] = [...streets].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0] ?? [];
    const [site_street, site_state, site_zip] = address.split("|");
    if (site_name && site_city && /^[a-z0-9-]+$/.test(program)) out.push({ program, site_name, site_city, season: String(season), site_street, site_state, site_zip });
  }
  return out.sort((a, b) => a.program.localeCompare(b.program));
}

/** The file with each program `fresh` gives a field replaced by it, every other row kept, sorted by program. */
export function mergeHomeFields(text, fresh) {
  const kept = text.trim() ? parseCsv(text, "home-fields.csv") : { header: HOME_FIELD_COLUMNS.join(","), rows: [] };
  // A file from before addresses (ADR 0066) has the first four columns only.
  if (kept.header !== HOME_FIELD_COLUMNS.join(",") && kept.header !== HOME_FIELD_COLUMNS.slice(0, 4).join(",")) throw new Error(`home-fields.csv: expected ${HOME_FIELD_COLUMNS.join(",")}`);
  const out = new Map(kept.rows.map((r) => [r.program, r]));
  // A kept row (a hand fix included) stays for its season; only a newer season's field replaces it. The same field read
  // again fills a blank address, never a kept one.
  for (const r of fresh) {
    const old = out.get(r.program);
    if (!old || Number(r.season) > Number(old.season)) out.set(r.program, r);
    else if (old.season === r.season && old.site_name === r.site_name && old.site_city === r.site_city && !old.site_street) out.set(r.program, { ...old, ...Object.fromEntries(ADDRESS.map((c) => [c, r[c] ?? ""])) });
  }
  const rows = [...out.values()].sort((a, b) => a.program.localeCompare(b.program));
  return [HOME_FIELD_COLUMNS.join(","), ...rows.map((r) => HOME_FIELD_COLUMNS.map((c) => r[c] ?? "").join(","))].join("\n") + "\n";
}

function main() {
  const year = Number(process.argv[2]);
  const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
  const root = arg("--private");
  const out = arg("--out") ?? fileURLToPath(new URL("../../data/seed/schools/home-fields.csv", import.meta.url));
  if (!Number.isInteger(year) || !root) throw new Error("usage: home-fields.mjs <year> --private <private data repo> [--out <file>]");
  const file = path.join(root, `davecampbells-${year}`, "venues.csv");
  const venues = parseCsv(readFileSync(file, "utf8"), "venues.csv");
  // An older file has no kickoff or address columns; every other column must be there.
  const cols = venues.header.split(",");
  if (VENUE_COLUMNS.some((c) => c !== "kickoff_utc" && !ADDRESS.includes(c) && !cols.includes(c))) throw new Error(`${file}: expected ${VENUE_COLUMNS.join(",")}`);
  const fresh = homeFields(venues.rows, year);
  writeFileSync(out, mergeHomeFields(existsSync(out) ? readFileSync(out, "utf8") : "", fresh));
  const programs = new Set(venues.rows.filter((r) => r.phase === "regular").map((r) => r.home)).size;
  console.log(`Home fields ${year}: ${fresh.length} of ${programs} programs with regular-season home games have a clear home field.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
