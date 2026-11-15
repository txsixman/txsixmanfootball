// The previous and next State Championship years a year page links to (lib/champions.ts).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "championship-years-"));
const outfile = path.join(tmp, "champions.mjs");
await build({ entryPoints: [path.join(WEB, "lib/champions.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const c = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("a year's neighbours skip years with no game, and a year with two divisions counts once", () => {
  const years = [2006, 2006, 2007, 2007, 2010, 1972];
  assert.deepEqual(c.adjacentYears(years, 2007), { prev: 2006, next: 2010 });
  assert.deepEqual(c.adjacentYears(years, 1972), { prev: undefined, next: 2006 });
  assert.deepEqual(c.adjacentYears(years, 2010), { prev: 2007, next: undefined });
  assert.deepEqual(c.adjacentYears(years, 1999), { prev: undefined, next: undefined }, "not a championship year");
});
