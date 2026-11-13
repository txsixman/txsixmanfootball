// One-off capture of SixManFootball.com score pages, to build the score parser from (ADR 0020). Run only by
// .github/workflows/smf-capture.yml. It requests exactly the paths listed in smf-capture-paths.txt (score and schedule
// pages only), through the polite fetcher, and writes each page into the private data repo (never a public artifact):
//   node tools/league-watch/smf-capture.mjs <paths file> <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFetcher } from "./smf-fetch.mjs";

/** The paths to capture: one per line, `#` comments and blanks skipped, at most 6 (a sample, not a crawl). */
export function capturePaths(text) {
  const paths = text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  if (paths.length > 6) throw new Error(`${paths.length} paths: a capture is a sample of at most 6 pages`);
  for (const p of paths) if (!/^\/[A-Za-z0-9/_.\-?=&]*$/.test(p)) throw new Error(`not a plain site path: ${p}`);
  return paths;
}

const fileName = (p) => `${p.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home"}.html`;

async function main() {
  const [pathsFile, outDir] = process.argv.slice(2);
  const paths = capturePaths(readFileSync(pathsFile, "utf8"));
  const listed = new Set(paths);
  const fetcher = createFetcher({ allowed: (p) => listed.has(p) });
  await fetcher.start();
  mkdirSync(outDir, { recursive: true });
  for (const p of paths) {
    const html = await fetcher.get(p);
    console.log(`${p}: ${html === null ? "not saved (404, redirect or gave up)" : `${html.length} characters`}`);
    if (html !== null) writeFileSync(path.join(outDir, fileName(p)), html);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
