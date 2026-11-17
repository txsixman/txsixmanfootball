// What the service worker keeps and how (lib/sw-rules.ts, ADR 0096): which addresses are cached, which never are, the cap on
// saved pages, how long a copy lasts, and which old caches a new worker deletes.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "sw-rules-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const { MAX_PAGES, PAGE_MAX_AGE_S, SETTLED_MAX_AGE_S, cacheKind, cacheNames, canSave, isFresh, staleCaches } = await load("sw-rules");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const doc = (pathname) => cacheKind({ sameOrigin: true, pathname, navigate: true, rsc: false });
const rsc = (pathname) => cacheKind({ sameOrigin: true, pathname, navigate: false, rsc: true });
const file = (pathname) => cacheKind({ sameOrigin: true, pathname, navigate: false, rsc: false });

test("the pages a fan opens are saved network first: the scoreboard, a program, a game, a bracket", () => {
  for (const p of ["/", "/scores", "/scores/tonight", "/scores/2026-11-13-jayton-oakwood", "/programs/jayton", "/playoffs/this-round", "/playoffs/bracket/uil-division-i", "/rankings"]) {
    assert.equal(doc(p), "page", p);
    assert.equal(rsc(p), "page-data", p);
  }
});

test("pages that never change in a season are kept a week, apart", () => {
  for (const p of ["/championships", "/rankings/how", "/search", "/~offline"]) assert.equal(doc(p), "settled", p);
  assert.ok(SETTLED_MAX_AGE_S > PAGE_MAX_AGE_S);
});

test("admin, account, sign-in, forums and the API are never cached, as a page, as data or as a file", () => {
  for (const p of ["/admin", "/admin/corrections", "/account", "/account/teams", "/sign-in", "/auth/callback", "/forums", "/api/me", "/api/push/subscribe", "/api/account/this-device", "/_vercel/insights/script.js"]) {
    assert.equal(doc(p), "network-only", `${p} as a page`);
    assert.equal(rsc(p), "network-only", `${p} as data`);
    assert.equal(file(p), "network-only", `${p} as a file`);
  }
  // Another site (the live-score function) is never the worker's to keep.
  assert.equal(cacheKind({ sameOrigin: false, pathname: "/rest/v1/rpc/live_scores", navigate: false, rsc: false }), "network-only");
});

test("static files are cache first; logos, search and the followed teams' files have their own caches", () => {
  assert.equal(file("/_next/static/chunks/app-abc123.js"), "static");
  assert.equal(file("/_next/static/media/inter-latin.woff2"), "static");
  assert.equal(file("/logos/abbott.png"), "logos");
  assert.equal(file("/pagefind/pagefind.js"), "search");
  assert.equal(file("/my-teams/jayton"), "my-teams");
  assert.equal(file("/manifest.webmanifest"), null, "the connection check is left to the network");
});

test("a saved page lasts 12 hours and at most 60 are kept", () => {
  assert.equal(PAGE_MAX_AGE_S, 12 * 3600);
  assert.equal(MAX_PAGES, 60);
  const at = Date.parse("2026-11-20T19:42:00-06:00");
  assert.equal(isFresh(at, at + 11 * 3600_000, PAGE_MAX_AGE_S), true);
  assert.equal(isFresh(at, at + 13 * 3600_000, PAGE_MAX_AGE_S), false);
  assert.equal(isFresh(Number.NaN, at, PAGE_MAX_AGE_S), false, "a copy with no stamp is no copy");
  assert.equal(isFresh(0, at, PAGE_MAX_AGE_S), false);
  assert.equal(isFresh(at + 3600_000, at, PAGE_MAX_AGE_S), false, "a stamp from the future is not trusted");
});

test("only score, program, playoff and championship pages can be saved ahead, with no query", () => {
  for (const p of ["/scores", "/scores/tonight", "/playoffs/this-round", "/scores/2026-11-13-jayton-oakwood", "/programs/jayton", "/championships/2026/uil-division-i"]) assert.equal(canSave(p), true, p);
  for (const p of ["/admin", "/account/teams", "/api/me", "/sign-in", "/forums", "//evil.example/scores", "https://evil.example/scores", "/scores?x=1", "/scores/../admin", "/", "/scores/" + "a".repeat(200)]) assert.equal(canSave(p), false, p);
});

test("a new worker deletes the old page caches and every earlier build's static files, and keeps the current ones", () => {
  const now = cacheNames("c0ffee");
  const existing = ["pages", "settled-pages", "static", "static-0ld5ha", now.static, now.page, now.data, now.settled, now.myTeams, "logos", "search", "serwist-precache-v2-https://x.test/", "something-else"];
  assert.deepEqual(staleCaches(existing, "c0ffee"), ["pages", "settled-pages", "static", "static-0ld5ha"]);
  assert.deepEqual(staleCaches(Object.values(now), "c0ffee"), []);
});
