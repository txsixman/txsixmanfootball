// Friday readiness for the Independent organization (Nov 11, 2026): its tab appears once the results robot writes one
// CenTex Chargers game, and not before. Runs the site's own lib/active-orgs.ts (bundled by esbuild, as the build would)
// against a copy of data/ whose 2026 games file has, or lacks, that game.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.resolve(WEB, "../../data");
const CENTEX = "CenTex Chargers Homeschool Sports Association";
// The row the results robot writes for such a game (tools/league-watch/maxpreps.test.mjs checks it writes exactly this).
const CENTEX_GAME =
  "Six-Man,season,2026-10-30,CenTex Chargers Homeschool Sports Association,Community Christian,false,40,20,unknown,";

/** A tree like the repo's (apps/web beside data/), every file linked to the real one except each season's games file:
 * 2026's is `games`, and every earlier season's is the real one without CenTex's games. */
function fixture(root, games) {
  mkdirSync(path.join(root, "apps/web"), { recursive: true });
  const link = (from, to, skip) => {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) if (!skip(name)) symlinkSync(path.join(from, name), path.join(to, name));
  };
  const season = (name) => /^maxpreps-\d{4}$/.test(name);
  link(DATA, path.join(root, "data"), (name) => name === "seed");
  link(path.join(DATA, "seed"), path.join(root, "data/seed"), season);
  for (const dir of readdirSync(path.join(DATA, "seed")).filter(season)) {
    link(path.join(DATA, "seed", dir), path.join(root, "data/seed", dir), (name) => name === "games.csv");
    const real = readFileSync(path.join(DATA, "seed", dir, "games.csv"), "utf8").trimEnd().split("\n");
    writeFileSync(path.join(root, "data/seed", dir, "games.csv"), dir === "maxpreps-2026" ? games : real.filter((l) => !l.includes(CENTEX)).join("\n") + "\n");
  }
  return path.join(root, "apps/web");
}

/** The organization slugs lib/active-orgs.ts offers as tabs, with the site run from `cwd`. */
async function tabs(bundle, cwd) {
  const was = process.cwd();
  process.chdir(cwd);
  try {
    const { activeOrgs } = await import(`${pathToFileURL(bundle)}?${cwd}`); // a fresh module: its memo starts empty
    return (await activeOrgs()).map((o) => o.slug);
  } finally {
    process.chdir(was);
  }
}

test("the Independent tab appears with the first CenTex game the robot writes, and not before", async (t) => {
  const tmp = mkdtempSync(path.join(tmpdir(), "independent-tab-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const bundle = path.join(tmp, "active-orgs.mjs");
  await build({ entryPoints: [path.join(WEB, "lib/active-orgs.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "error" });

  const lines = readFileSync(path.join(DATA, "seed/maxpreps-2026/games.csv"), "utf8").trimEnd().split("\n");
  const without = lines.filter((l) => !l.includes(CENTEX)).join("\n") + "\n";
  const withGame = [...lines.filter((l) => !l.includes(CENTEX)), CENTEX_GAME].join("\n") + "\n";

  assert.deepEqual(await tabs(bundle, fixture(path.join(tmp, "before"), without)), ["uil", "tapps", "taiao", "tcaf"]);
  assert.deepEqual(await tabs(bundle, fixture(path.join(tmp, "after"), withGame)), ["uil", "tapps", "taiao", "tcaf", "independent"]);
});
