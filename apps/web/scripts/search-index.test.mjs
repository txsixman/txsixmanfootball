// node --test apps/web/scripts/*.test.mjs (CI, after npm ci in apps/web)
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildIndex, pageUrl, pagesIn } from "./search-index.mjs";
import { staticDirs } from "./vercel-static.mjs";

const page = (body) => `<html lang="en"><body><nav>menu</nav>${body}</body></html>`;

function site(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "search-index-"));
  for (const [rel, html] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), html);
  }
  return dir;
}

test("a page's address comes from either build layout", () => {
  assert.equal(pageUrl("app/programs/jayton.html"), "/programs/jayton");
  assert.equal(pageUrl("app/index.html"), "/");
  // Vercel's build (Next 16 adapter) names the folder APP_PAGE.
  assert.equal(pageUrl("route-cache/APP_PAGE/ab12/$/programs/jayton.html"), "/programs/jayton");
  assert.equal(pageUrl("route-cache/APP_PAGE/ab12/$/index.html"), "/");
  assert.equal(pageUrl("route-cache/app-page/ab12/$/programs/jayton.html"), "/programs/jayton");
  assert.equal(pageUrl("app/_not-found.html"), null);
  assert.equal(pageUrl("app/programs/jayton.rsc"), null);
  assert.equal(pageUrl("route-cache/PAGES/ab12/$/404.html"), null);
  assert.equal(pageUrl("route-cache/APP_ROUTE/ab12/$/programs/jayton/opengraph-image.body"), null);
  assert.equal(pageUrl("pages/404.html"), null);
});

test("each address is listed once", () => {
  const dir = site({
    "app/programs/jayton.html": page("a"),
    "route-cache/APP_PAGE/ab12/$/programs/jayton.html": page("b"),
    "route-cache/APP_PAGE/cd34/$/scores/2026/week/1.html": page("c"),
  });
  assert.deepEqual(pagesIn(dir).map((p) => p.url), ["/programs/jayton", "/scores/2026/week/1"]);
});

test("only marked pages are indexed, and the index is written to every output", async () => {
  const dir = site({
    "route-cache/APP_PAGE/ab12/$/programs/jayton.html": page(`<article data-pagefind-body><h1>Jayton Jaybirds</h1></article>`),
    "route-cache/APP_PAGE/cd34/$/index.html": page("<h1>Home</h1>"),
  });
  const outs = [path.join(dir, "public/pagefind"), path.join(dir, "vercel/pagefind")];
  assert.deepEqual(await buildIndex({ serverDir: dir, outputPaths: outs }), { found: 2, indexed: 1 });
  for (const out of outs) assert.ok(existsSync(path.join(out, "pagefind.js")), out);
});

test("files written after the build go to Vercel's output too, when its adapter made one", () => {
  const plain = site({ "public/x.txt": "" });
  assert.deepEqual(staticDirs(plain), [path.join(plain, "public")]);
  const vercel = site({ "public/x.txt": "", ".next/output/static/x.txt": "" });
  assert.deepEqual(staticDirs(vercel), [path.join(vercel, "public"), path.join(vercel, ".next/output/static")]);
});

test("a build with no searchable pages fails loudly", async () => {
  const dir = site({ "app/index.html": page("<h1>Home</h1>") });
  await assert.rejects(buildIndex({ serverDir: dir, outputPaths: [path.join(dir, "out")] }), /no searchable pages/);
});
