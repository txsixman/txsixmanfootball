// The scoreboard's midweek order is decided before first paint by an inline script (lib/upcoming-first.ts, ADR 0103).
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "upcoming-first-"));
const outfile = path.join(tmp, "upcoming-first.mjs");
await build({ entryPoints: [path.join(WEB, "lib/upcoming-first.ts")], bundle: true, platform: "node", format: "esm", minify: true, outfile, logLevel: "error" });
const { upcomingFirstAt, upcomingFirstScript } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const at = (iso) => Date.parse(iso);

test("finals first until the next game day is nearer than the last one, then this week's games", () => {
  // Last game day Sat Nov 14, next Thu Nov 19, each counted from noon Central: the halfway point is Nov 17, 6:00 AM UTC.
  assert.equal(upcomingFirstAt(at("2026-11-15T14:00:00Z"), "2026-11-14", ["2026-11-19"]), false); // Sunday
  assert.equal(upcomingFirstAt(at("2026-11-17T05:00:00Z"), "2026-11-14", ["2026-11-19"]), false); // just before halfway
  assert.equal(upcomingFirstAt(at("2026-11-17T07:00:00Z"), "2026-11-14", ["2026-11-19"]), true); // just after
  assert.equal(upcomingFirstAt(at("2026-11-19T01:00:00Z"), "2026-11-14", ["2026-11-19"]), true); // Wednesday evening
});

test("no final, or nothing still to play, keeps finals first; a past date is not the next game day", () => {
  assert.equal(upcomingFirstAt(at("2026-11-18T18:00:00Z"), "", ["2026-11-19"]), false);
  assert.equal(upcomingFirstAt(at("2026-11-18T18:00:00Z"), "2026-11-14", []), false);
  assert.equal(upcomingFirstAt(at("2026-11-18T18:00:00Z"), "2026-11-14", ["2026-11-13", "2026-11-19"]), true);
  assert.equal(upcomingFirstAt(at("2026-11-18T18:00:00Z"), "2026-11-14", ["2026-11-13"]), false);
});

test("the inline script is the same function, whole, and sets or clears the attribute on <html>", () => {
  const run = (nowIso, lastDay, dates) => {
    const attrs = new Map();
    const document = { documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) } };
    // Only the clock is the page's own; everything else the script needs must be in the script.
    const sandbox = { document, Date: Object.assign(function () {}, { now: () => at(nowIso), parse: Date.parse }), Intl };
    vm.runInNewContext(upcomingFirstScript(lastDay, dates), sandbox);
    return attrs.has("data-upcoming-first");
  };
  assert.equal(run("2026-11-17T07:00:00Z", "2026-11-14", ["2026-11-19"]), true);
  assert.equal(run("2026-11-15T14:00:00Z", "2026-11-14", ["2026-11-19"]), false);
  assert.equal(run("2026-11-17T07:00:00Z", "", ["2026-11-19"]), false);
});
