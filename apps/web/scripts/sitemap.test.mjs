// The sitemap's lastmods (lib/sitemap-xml.ts): each page's date comes from its own data, a page with no game date has
// none, and the XML is well formed.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "sitemap-"));
const outfile = path.join(tmp, "sitemap.mjs");
await build({ entryPoints: [path.join(WEB, "lib/sitemap-xml.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const s = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const d = {
  current: 2026,
  latest: "2026-11-14",
  bracket: "2026-11-13",
  games: new Map([["2026-10-02-alpha-at-bravo", "2026-10-02"]]),
  programs: new Map([["alpha", "2026-11-13"]]),
  teams: new Map([["2025|alpha", "2025-11-20"]]),
  pairs: new Map([["alpha|bravo", "2026-10-02"]]),
  seasons: new Map([[2025, "2025-12-12"]]),
  weeks: new Map([["2026|6|uil", "2026-10-02"], ["2026|6|tapps", "2026-10-03"], ["2026|6|*", "2026-10-03"]]),
};

test("each kind of page takes the date of the latest game it shows", () => {
  assert.equal(s.lastmodFor("", d), "2026-11-14");
  assert.equal(s.lastmodFor("scores/2026-10-02-alpha-at-bravo", d), "2026-10-02");
  assert.equal(s.lastmodFor("scores", d), "2026-11-13");
  assert.equal(s.lastmodFor("playoffs/bracket/uil-division-i", d), "2026-11-13");
  assert.equal(s.lastmodFor("playoffs/season/2025", d), "2025-12-12");
  assert.equal(s.lastmodFor("programs/alpha", d), "2026-11-13");
  assert.equal(s.lastmodFor("programs/alpha/2025", d), "2025-11-20");
  assert.equal(s.lastmodFor("series/bravo/alpha", d), "2026-10-02", "either order");
  assert.equal(s.lastmodFor("results/2026/6", d), "2026-10-02", "UIL has no organization segment");
  assert.equal(s.lastmodFor("results/2026/6/tapps", d), "2026-10-03");
  assert.equal(s.lastmodFor("weeks/2026/6/tapps", d), "2026-10-03");
  assert.equal(s.lastmodFor("results/2025/tapps", d), "2025-12-12");
  assert.equal(s.lastmodFor("rankings/week/6", d), "2026-10-03", "every organization's week");
  assert.equal(s.lastmodFor("rankings/season/2025/tapps", d), "2025-12-12");
  assert.equal(s.lastmodFor("standings/tapps", d), "2026-11-14");
});

test("a page with no game date has no lastmod, never the build time", () => {
  for (const p of ["about/ratings", "rankings/how", "championships", "matchup", "programs/charlie", "scores/2026-11-20-alpha-at-charlie", "results/2026/7/tcaf"]) {
    assert.equal(s.lastmodFor(p, d), undefined, p);
  }
});

test("the index and each sitemap are well formed", () => {
  const set = s.urlsetXml([{ url: "https://example.test/a?x=1&y=2", lastmod: "2026-10-02" }, { url: "https://example.test/b" }]);
  assert.match(set, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.ok(set.includes("<url><loc>https://example.test/a?x=1&amp;y=2</loc><lastmod>2026-10-02</lastmod></url>"));
  assert.ok(set.includes("<url><loc>https://example.test/b</loc></url>"));
  assert.match(s.indexXml([{ url: "https://example.test/sitemaps/scores.xml", lastmod: "2026-11-14" }]), /<sitemapindex [^>]+>\n<sitemap><loc>[^<]+<\/loc><lastmod>2026-11-14<\/lastmod><\/sitemap>\n<\/sitemapindex>/);
  assert.equal(s.newest(["2026-10-02", undefined, "2026-11-14", "2025-12-12"]), "2026-11-14");
  assert.equal(s.newest([undefined]), undefined);
});
