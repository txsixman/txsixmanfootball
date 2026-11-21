// Number-and-noun grammar (lib/plural.ts): "1 point" not "1 points", "an 11%" not "a 11%".   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "plural-"));
const outfile = path.join(tmp, "plural.mjs");
await build({ entryPoints: [path.join(WEB, "lib", "plural.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { aOrAn, plural, unitFor } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("plural: one is singular, every other count (0 too) is plural", () => {
  assert.equal(plural(0, "point"), "0 points");
  assert.equal(plural(1, "point"), "1 point");
  assert.equal(plural(2, "point"), "2 points");
  assert.equal(plural(1, "place"), "1 place");
  assert.equal(plural(11, "game"), "11 games");
  assert.equal(plural(1, "loss", "losses"), "1 loss");
  assert.equal(plural(2, "loss", "losses"), "2 losses");
  assert.equal(plural(1234, "game"), "1,234 games");
});

test("aOrAn: an before a number said with a vowel sound (8, 11, 18, 80s, 800s, 8,000, 11,000, 18,000), a otherwise", () => {
  for (const n of [8, 11, 18, 80, 85, 89, 800, 899, 8000, 11000, 18000, 11999, 8_000_000]) assert.equal(aOrAn(n), "an", String(n));
  for (const n of [0, 1, 2, 7, 9, 10, 12, 17, 19, 79, 90, 100, 110, 180, 799, 900, 1000, 1100, 7000, 12000]) assert.equal(aOrAn(n), "a", String(n));
});

test("aOrAn: reads chance text and decimals as they are said", () => {
  assert.equal(aOrAn("11%"), "an");
  assert.equal(aOrAn("8%"), "an");
  assert.equal(aOrAn("18%"), "an");
  assert.equal(aOrAn("80%"), "an");
  assert.equal(aOrAn("1%"), "a");
  assert.equal(aOrAn("10%"), "a");
  assert.equal(aOrAn("12%"), "a");
  assert.equal(aOrAn("100%"), "a");
  assert.equal(aOrAn("1,800"), "a", "read one thousand eight hundred");
  assert.equal(aOrAn("18,000"), "an");
  assert.equal(aOrAn("8.5"), "an");
  assert.equal(aOrAn("<1%"), "a");
  assert.equal(aOrAn(">99%"), "a");
  assert.equal(aOrAn(""), "a");
});

test("unitFor: a board's unit loses its plural beside a 1, and only beside a 1", () => {
  assert.equal(unitFor(1, "points apart"), "point apart");
  assert.equal(unitFor("1", "points apart"), "point apart");
  assert.equal(unitFor(2, "points apart"), "points apart");
  assert.equal(unitFor(0, "points apart"), "points apart");
  assert.equal(unitFor(1, "games in a row"), "game in a row");
  assert.equal(unitFor(1, "wins in a row"), "win in a row");
  assert.equal(unitFor(1, "shutouts"), "shutout");
  assert.equal(unitFor(1, "games of 60 points or more"), "game of 60 points or more");
  assert.equal(unitFor(1, "points from the projection"), "point from the projection");
  assert.equal(unitFor("1.0", "points per game"), "points per game", "a decimal figure keeps its plural");
  assert.equal(unitFor("11%", "chance to win before the game"), "chance to win before the game");
  assert.equal(unitFor(1, "record"), "record");
});
