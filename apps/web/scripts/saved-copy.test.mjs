// The words on a saved copy and the pages saved for a game night (lib/saved-copy.ts, ADR 0096).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "saved-copy-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const { savedCopyNotice, sizeText, tonightPages, gameToday } = await load("saved-copy");
const { canSave } = await load("sw-rules");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const at = Date.parse("2026-11-20T19:42:00-06:00"); // 7:42 PM Friday, Central

test("a saved copy says when it was saved, in Central time, and that scores may have changed", () => {
  assert.equal(savedCopyNotice({ savedAt: at, now: at + 3600_000, online: false }), "Saved copy from 7:42 PM. You're offline; scores may have changed.");
});

test("on a weak signal it does not say offline; from another day it names the day", () => {
  assert.equal(savedCopyNotice({ savedAt: at, now: at + 60_000, online: true }), "Saved copy from 7:42 PM. Weak signal; scores may have changed.");
  assert.equal(savedCopyNotice({ savedAt: at, now: at + 14 * 3600_000, online: false }), "Saved copy from Fri 7:42 PM. You're offline; scores may have changed.");
  assert.match(savedCopyNotice({ savedAt: at, now: at + 4 * 3600_000, online: false }), /^Saved copy from 7:42 PM\./, "11:42 PM is still Friday");
});

test("sizes read in KB, and MB from a megabyte", () => {
  assert.equal(sizeText(100), "1 KB");
  assert.equal(sizeText(640 * 1024), "640 KB");
  assert.equal(sizeText(1.5 * 1024 * 1024), "1.5 MB");
});

test("a game night saves the board, tonight, this round's bracket and the followed teams' games on tonight, once each", () => {
  const now = new Date("2026-11-20T23:00:00Z"); // 5 PM Friday Central
  const next = [
    { date: "2026-11-20", href: "/scores/2026-11-20-jayton-oakwood" },
    { date: "2026-11-20", href: "/scores/2026-11-20-jayton-oakwood" },
    { date: "2026-11-27", href: "/scores/2026-11-27-jayton-roby" },
    { date: "2026-11-20" },
    null,
    { date: "2026-11-20", href: "/admin/secret" },
  ];
  assert.deepEqual(tonightPages(next, now, canSave), ["/scores", "/scores/tonight", "/playoffs/this-round", "/scores/2026-11-20-jayton-oakwood"]);
  assert.equal(gameToday(next, now), true);
  assert.equal(gameToday([{ date: "2026-11-27" }, null], now), false);
});

test("a long list of followed teams saves at most 12 pages", () => {
  const now = new Date("2026-11-20T23:00:00Z");
  const next = Array.from({ length: 30 }, (_, i) => ({ date: "2026-11-20", href: `/scores/2026-11-20-a${i}-b${i}` }));
  assert.equal(tonightPages(next, now, canSave).length, 12);
});
