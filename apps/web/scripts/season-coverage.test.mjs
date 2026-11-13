// Schools with a game in a past season (lib/season-coverage.ts). Invented schools only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "season-coverage-"));
const outfile = path.join(tmp, "season-coverage.mjs");
await build({ entryPoints: [path.join(WEB, "lib/season-coverage.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { seasonCoverage, coverageLine } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const school = (slug) => ({ slug });
const game = (home, away) => ({ home, away });

test("counts the schools with a game, home or away, matching names by slug", () => {
  const field = [school("alpha-high"), school("bravo-christian"), school("charlie-academy"), school("delta-school")];
  const games = [game("Alpha High", "Out Of State"), game("Echo Prep", "Bravo Christian"), game("Alpha High", "Bravo Christian")];
  assert.deepEqual(seasonCoverage(field, games), { played: 2, total: 4 });
});

test("a school listed twice counts once, and a season with no games reaches none", () => {
  const field = [school("alpha-high"), school("alpha-high"), school("bravo-christian")];
  assert.deepEqual(seasonCoverage(field, [game("Alpha High", "Zulu")]), { played: 1, total: 2 });
  assert.deepEqual(seasonCoverage(field, []), { played: 0, total: 2 });
  assert.deepEqual(seasonCoverage([], [game("A", "B")]), { played: 0, total: 0 });
});

test("the line", () => {
  assert.equal(coverageLine({ played: 237, total: 279 }), "Games from 237 of 279 schools for this season.");
});
