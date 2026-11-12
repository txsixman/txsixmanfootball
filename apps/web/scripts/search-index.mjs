// Builds the Pagefind (MIT) search index after `next build` (package.json "build").
// Next writes the prerendered pages to one of two places, and Pagefind's own CLI can only read the first:
//   .next/server/app/programs/jayton.html                                   (next build on its own, as in CI)
//   .next/server/route-cache/APP_PAGE/<hash>/$/programs/jayton.html         (on Vercel, which builds through an adapter)
// So this finds the pages in either, gives each its real address and hands it to Pagefind's Node API. Only pages
// marked data-pagefind-body (the program pages and the results weeks) are indexed; a build with none fails loudly.
// The index goes to public/pagefind and, on Vercel, also to .next/output/static/pagefind: Vercel's adapter copies
// public/ into its output during `next build`, before this runs (scripts/vercel-static.mjs).
//   node scripts/search-index.mjs   (from apps/web, after next build)
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as pagefind from "pagefind";
import { staticDirs } from "./vercel-static.mjs";

const web = path.resolve(import.meta.dirname, "..");
const ROUTE_CACHE_PAGE = /^route-cache\/app[-_]page\/[^/]+\/\$(?=\/)/i;

/** The address a built page is served at, from its path under .next/server; null for anything that is not a page. */
export function pageUrl(rel) {
  const parts = rel.split(path.sep).join("/");
  let page;
  if (parts.startsWith("app/")) page = parts.slice("app".length);
  else if (ROUTE_CACHE_PAGE.test(parts)) page = parts.replace(ROUTE_CACHE_PAGE, "");
  else return null;
  if (!page.endsWith(".html") || /\/_(not-found|global-error)\.html$/.test(page)) return null;
  page = page.slice(0, -".html".length);
  return page === "/index" ? "/" : page;
}

/** Every built page under `serverDir` as { url, file }, one per address, sorted. */
export function pagesIn(serverDir) {
  const seen = new Map();
  for (const rel of readdirSync(serverDir, { recursive: true }).map(String).sort()) {
    const url = pageUrl(rel);
    if (url && !seen.has(url)) seen.set(url, path.join(serverDir, rel));
  }
  return [...seen].map(([url, file]) => ({ url, file }));
}

/** Indexes the marked pages under `serverDir` into each of `outputPaths`; returns { found, indexed }. Throws on any error. */
export async function buildIndex({ serverDir, outputPaths }) {
  const pages = pagesIn(serverDir);
  const marked = pages.filter((p) => readFileSync(p.file, "utf8").includes("data-pagefind-body"));
  if (marked.length === 0) throw new Error(`no searchable pages under ${serverDir} (${pages.length} pages found): run next build first`);
  const { index, errors } = await pagefind.createIndex();
  try {
    if (errors.length) throw new Error(errors.join("; "));
    for (const p of marked) {
      const added = await index.addHTMLFile({ url: p.url, content: readFileSync(p.file, "utf8") });
      if (added.errors.length) throw new Error(`${p.url}: ${added.errors.join("; ")}`);
    }
    for (const outputPath of outputPaths) {
      const written = await index.writeFiles({ outputPath });
      if (written.errors.length) throw new Error(written.errors.join("; "));
    }
  } finally {
    await pagefind.close();
  }
  return { found: pages.length, indexed: marked.length };
}

if (process.argv[1] === import.meta.filename) {
  const outputPaths = staticDirs(web).map((dir) => path.join(dir, "pagefind"));
  const { found, indexed } = await buildIndex({ serverDir: path.join(web, ".next/server"), outputPaths });
  console.log(`${indexed} pages indexed (${found - indexed} built pages not marked for search), into ${outputPaths.map((p) => path.relative(web, p)).join(" and ")}`);
}
