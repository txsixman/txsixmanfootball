// The service worker build (scripts/build-sw.mjs): the precache list and a bundle that carries it.
//   node --test apps/web/scripts/*.test.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildWorker, precacheList } from "./build-sw.mjs";

function fakeBuild() {
  const dir = mkdtempSync(path.join(tmpdir(), "sw-"));
  mkdirSync(path.join(dir, "chunks"), { recursive: true });
  mkdirSync(path.join(dir, "media"), { recursive: true });
  writeFileSync(path.join(dir, "chunks", "app-abc123.js"), "");
  writeFileSync(path.join(dir, "chunks", "page-def456.css"), "");
  writeFileSync(path.join(dir, "media", "inter-latin.woff2"), "");
  return dir;
}

test("precaches the build's scripts and styles, and the offline page under the commit", () => {
  assert.deepEqual(precacheList(fakeBuild(), "c0ffee"), [
    { url: "/_next/static/chunks/app-abc123.js", revision: null },
    { url: "/_next/static/chunks/page-def456.css", revision: null },
    { url: "/~offline", revision: "c0ffee" },
  ]);
});

test("the bundled worker carries the list and the 30-minute page limit, and refuses an empty build", async () => {
  const dir = fakeBuild();
  const outfile = path.join(dir, "sw.js");
  assert.equal(await buildWorker({ staticDir: dir, outfile, revision: "c0ffee" }), 3);
  const sw = readFileSync(outfile, "utf8");
  assert.match(sw, /\/_next\/static\/chunks\/app-abc123\.js/);
  assert.match(sw, /~offline/);
  assert.match(sw, /1800/);
  assert.doesNotMatch(sw, /__SW_MANIFEST/);
  await assert.rejects(buildWorker({ staticDir: mkdtempSync(path.join(tmpdir(), "sw-")), outfile, revision: "x" }), /run next build first/);
});
