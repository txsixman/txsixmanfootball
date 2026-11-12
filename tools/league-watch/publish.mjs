// Publishes a season's robot-read results into this repo: games.csv and playoffs.csv from the reader's own folder (in
// the private data repo, with each game's source page) to data/seed/maxpreps-<season>/, without the source_url and
// notes columns. The facts the site shows (date, teams, score, site, round, end) are all that this repo holds.
//   node tools/league-watch/publish.mjs <from: private/maxpreps-2026> <to: data/seed/maxpreps-2026>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRIVATE_COLUMNS = ["source_url", "notes"];

/** The CSV without the private columns. The reader writes plain comma-joined cells; a quote would mean a cell that
 * holds a comma, which this does not parse, so it fails loudly instead of shifting columns. */
export function publicCsv(text, file = "csv") {
  if (text.includes('"')) throw new Error(`${file}: a quoted cell; publish.mjs reads plain cells only`);
  const [header, ...rows] = text.trimEnd().split("\n");
  const names = header.split(",");
  for (const name of PRIVATE_COLUMNS) if (!names.includes(name)) throw new Error(`${file}: no ${name} column in ${header}`);
  const keep = names.map((name, i) => (PRIVATE_COLUMNS.includes(name) ? -1 : i)).filter((i) => i >= 0);
  return [header, ...rows]
    .map((line, n) => {
      const cells = line.split(",");
      if (cells.length !== names.length) throw new Error(`${file}: line ${n + 1} has ${cells.length} cells, expected ${names.length}`);
      return keep.map((i) => cells[i]).join(",");
    })
    .join("\n")
    .concat("\n");
}

export function publish(from, to) {
  mkdirSync(to, { recursive: true });
  const written = [];
  for (const name of ["games.csv", "playoffs.csv"]) {
    const src = path.join(from, name);
    if (!existsSync(src)) continue;
    writeFileSync(path.join(to, name), publicCsv(readFileSync(src, "utf8"), src));
    written.push(name);
  }
  if (!written.length) throw new Error(`${from}: no games.csv or playoffs.csv to publish`);
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) throw new Error("usage: publish.mjs <from dir> <to dir>");
  console.log(`${to}: ${publish(from, to).join(", ")}`);
}
