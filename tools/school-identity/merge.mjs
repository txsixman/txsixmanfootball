// Merges the collected batches (JSON arrays, one object per school) into data/seed/schools/identity.json.
// Usage: node merge.mjs <dir-of-batch-json>. Unknown schools and unknown color names stop the merge.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDENTITY } from "./fetch-logos.mjs";

const SEED = new URL("../../data/seed/", import.meta.url);
const slugify = (name) => name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ALIAS = {
  grey: "gray", "navy blue": "navy", "dark blue": "navy", royal: "royal blue", vegas: "vegas gold", "laurel purple": "purple",
};

export function knownSchools() {
  const slugs = new Map();
  for (const dir of ["uil-2026-28", "tapps-2026-28", "private-2026"]) {
    const [, ...lines] = readFileSync(new URL(`${dir}/alignments.csv`, SEED), "utf8").trim().split("\n");
    for (const line of lines) {
      const school = line.split(",")[4];
      slugs.set(slugify(school), school);
    }
  }
  return slugs;
}

export function normaliseColor(name, table) {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  const known = ALIAS[key] ?? key;
  return table[known] ? known : null;
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node merge.mjs <dir-of-batch-json>");
  const table = JSON.parse(readFileSync(new URL("schools/colors.json", SEED), "utf8"));
  const schools = knownSchools();
  const current = existsSync(IDENTITY) ? JSON.parse(readFileSync(IDENTITY, "utf8")) : { removed: [], schools: {} };
  const problems = [];
  let merged = 0;

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    for (const row of JSON.parse(readFileSync(path.join(dir, file), "utf8"))) {
      const slug = slugify(row.school ?? "");
      if (!schools.has(slug)) {
        problems.push(`${file}: unknown school ${row.school}`);
        continue;
      }
      const colors = (row.colors ?? []).map((c) => normaliseColor(c, table) ?? (problems.push(`${row.school}: unknown color "${c}"`), c));
      // Fill gaps only: a fact already recorded is kept. Correct a wrong fact by editing identity.json by hand.
      const before = current.schools[slug] ?? { colors: [], logo: null };
      const hasColors = colors.length > 0 && Boolean(row.colorsSource);
      current.schools[slug] = {
        school: schools.get(slug),
        site: before.site ?? row.site ?? null,
        mascot: before.mascot ?? (row.mascotSource ? row.mascot : null) ?? null,
        mascotSource: before.mascot ? before.mascotSource : row.mascot ? (row.mascotSource ?? null) : null,
        colors: before.colors?.length ? before.colors : hasColors ? colors : [],
        colorsSource: before.colors?.length ? before.colorsSource : hasColors ? row.colorsSource : null,
        logo: before.logo ?? (row.logo?.image && row.logo?.page ? { image: row.logo.image, page: row.logo.page } : null),
        ...((before.notes ?? row.notes) ? { notes: before.notes ?? row.notes } : {}),
      };
      merged += 1;
    }
  }

  current.schools = Object.fromEntries(Object.entries(current.schools).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(IDENTITY, `${JSON.stringify(current, null, 2)}\n`);
  const all = Object.values(current.schools);
  const count = (f) => all.filter(f).length;
  console.log(
    `${merged} merged; of ${schools.size} schools: ${all.length} present, ${count((s) => s.logo)} logos, ` +
      `${count((s) => s.colors.length)} colors, ${count((s) => s.mascot)} mascots`,
  );
  for (const p of problems) console.log(`  problem: ${p}`);
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
