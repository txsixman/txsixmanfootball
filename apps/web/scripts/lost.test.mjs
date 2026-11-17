// What the 404 page guesses a lost fan wanted (lib/lost.ts): the words of a school's, game's or series' address, else the last piece.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "lost-"));
const outfile = path.join(tmp, "lost.mjs");
await build({ entryPoints: [path.join(WEB, "lib/lost.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { lostWords } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("a school's address gives the school's words, whatever follows it", () => {
  assert.equal(lostWords("/programs/white-face"), "white face");
  assert.equal(lostWords("/programs/white-face/2025"), "white face 2025");
  assert.equal(lostWords("/programs/Whiteface/"), "whiteface");
});

test("a game's address gives its two teams, without the date, the round or the word between them", () => {
  assert.equal(lostWords("/scores/2025-08-28-throckmorton-at-bluff-dale"), "throckmorton bluff dale");
  assert.equal(lostWords("/scores/2026-quarterfinal-jayton-vs-whiteface"), "jayton whiteface");
  assert.equal(lostWords("/scores/2026-round-1-valor-north-austin-at-fort-bend-chargers"), "valor north austin fort bend chargers");
});

test("a series gives both schools", () => {
  assert.equal(lostWords("/series/bluff-dale/throckmorton"), "bluff dale throckmorton");
});

test("another address gives its last piece when that is a word, and nothing when it is not", () => {
  assert.equal(lostWords("/jayton"), "jayton");
  assert.equal(lostWords("/results/2025/99"), null);
  assert.equal(lostWords("/"), null);
  assert.equal(lostWords("/programs"), null);
  assert.equal(lostWords("/%E0%A4%A"), null); // not valid percent-encoding
});

test("the words are capped", () => {
  assert.ok(lostWords(`/programs/${"a-".repeat(100)}b`).length <= 60);
});
