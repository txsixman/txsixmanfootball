// Finals the sources give different winners (lib/disputed.ts, ADR 0040): read from data/seed/disputed/<season>.csv, matched
// by date and both teams in either order; a missing file means none; a bad header or row fails loudly. Invented teams only.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The loader reads ../../data/seed/disputed from the web app's folder, so run it from a scratch tree of the same shape.
const root = mkdtempSync(path.join(tmpdir(), "disputed-"));
mkdirSync(path.join(root, "apps/web"), { recursive: true });
mkdirSync(path.join(root, "data/seed/disputed"), { recursive: true });
writeFileSync(path.join(root, "data/seed/disputed/2031.csv"), "game_date,home,away\n2031-11-14,Salt Fork,Cedar Gap\n");
writeFileSync(path.join(root, "data/seed/disputed/2032.csv"), "date,home,away\n2032-11-14,Salt Fork,Cedar Gap\n");
writeFileSync(path.join(root, "data/seed/disputed/2033.csv"), "game_date,home,away\n2033-11-14,Salt Fork\n");
process.chdir(path.join(root, "apps/web"));
const { isDisputed, loadDisputed } = await import("../lib/disputed.ts");

test("a listed final is disputed, whichever team is home; others are not", async () => {
  const set = await loadDisputed(2031);
  assert.equal(isDisputed(set, "2031-11-14", "Salt Fork", "Cedar Gap"), true);
  assert.equal(isDisputed(set, "2031-11-14", "Cedar Gap", "Salt Fork"), true);
  assert.equal(isDisputed(set, "2031-11-21", "Salt Fork", "Cedar Gap"), false);
  assert.equal(isDisputed(set, "2031-11-14", "Salt Fork", "Dry Wash"), false);
});

test("no file: nothing is disputed", async () => {
  assert.equal((await loadDisputed(2030)).size, 0);
});

test("a wrong header or a short row fails the build", async () => {
  await assert.rejects(loadDisputed(2032), /unexpected header/);
  await assert.rejects(loadDisputed(2033), /bad row/);
});
