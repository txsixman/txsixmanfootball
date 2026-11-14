import { test } from "node:test";
import assert from "node:assert/strict";
import { ALWAYS, ORIGIN, batches, buildList, onHost, parseSitemap, pickUrls } from "./ping.mjs";

const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>${ORIGIN}/sitemaps/scores.xml</loc><lastmod>2026-11-14</lastmod></sitemap></sitemapindex>`;
const urlset = `<urlset>
<url><loc>${ORIGIN}/scores/a</loc><lastmod>2026-11-06</lastmod></url>
<url><loc>${ORIGIN}/scores/b</loc><lastmod>2026-11-13T05:00:00Z</lastmod></url>
<url><loc>${ORIGIN}/about</loc></url>
<url><loc>https://example.com/x</loc><lastmod>2026-11-14</lastmod></url>
<url><loc>${ORIGIN}.evil.com/y</loc><lastmod>2026-11-14</lastmod></url>
<url><loc>${ORIGIN}/q?a=1&amp;b=2</loc><lastmod>2026-11-14</lastmod></url>
</urlset>`;

test("parses an index and a urlset", () => {
  const i = parseSitemap(index);
  assert.equal(i.isIndex, true);
  assert.deepEqual(i.entries, [{ loc: `${ORIGIN}/sitemaps/scores.xml`, lastmod: "2026-11-14" }]);
  const u = parseSitemap(urlset);
  assert.equal(u.isIndex, false);
  assert.equal(u.entries.length, 6);
  assert.equal(u.entries[2].lastmod, null);
  assert.equal(u.entries[5].loc, `${ORIGIN}/q?a=1&b=2`);
});

test("the since filter is inclusive, reads the date part, and skips undated pages", () => {
  const { entries } = parseSitemap(urlset);
  assert.deepEqual(pickUrls(entries, "2026-11-13"), [`${ORIGIN}/scores/b`, `${ORIGIN}/q?a=1&b=2`]);
  assert.deepEqual(pickUrls(entries, "2026-11-06").slice(0, 2), [`${ORIGIN}/scores/a`, `${ORIGIN}/scores/b`]);
});

test("the bare origin is the home page", () => {
  assert.deepEqual(pickUrls([{ loc: ORIGIN, lastmod: "2026-11-14" }], "2026-11-14"), [`${ORIGIN}/`]);
});

test("the host guard drops other hosts and look-alikes", () => {
  assert.equal(onHost(ORIGIN), true);
  assert.equal(onHost(`${ORIGIN}/a`), true);
  assert.equal(onHost("https://example.com/a"), false);
  assert.equal(onHost(`${ORIGIN}.evil.com/a`), false);
  assert.equal(onHost(`http://txsixmanfootball.com/a`), false);
  const { entries } = parseSitemap(urlset);
  assert.ok(buildList(pickUrls(entries, "2026-01-01")).every(onHost));
});

test("the always-sent pages come first, once", () => {
  const list = buildList([`${ORIGIN}/scores`, `${ORIGIN}/scores/a`]);
  assert.deepEqual(list, [...ALWAYS, `${ORIGIN}/scores/a`]);
});

test("batches hold at most the size", () => {
  const list = Array.from({ length: 10001 }, (_, n) => `${ORIGIN}/p/${n}`);
  assert.deepEqual(batches(list, 10000).map((b) => b.length), [10000, 1]);
  assert.deepEqual(batches([], 10000), []);
});
