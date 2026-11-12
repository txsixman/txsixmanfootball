// Builds the service worker (sw.ts, Serwist) into public/sw.js after `next build` (package.json "build"), the same
// way the search index is written: a static file, no server code. esbuild (MIT) bundles it; the precache list is the
// build's own scripts and styles (hashed names, so no revisions) plus the offline page, versioned by the commit.
// On Vercel it is copied into .next/output/static as well (scripts/vercel-static.mjs says why).
//   node scripts/build-sw.mjs   (from apps/web, after next build)
import { build } from "esbuild";
import { copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { staticDirs } from "./vercel-static.mjs";

const web = path.resolve(import.meta.dirname, "..");

/** Every .js and .css file under .next/static, as the URL the site serves it at. */
export function precacheList(dir, revision) {
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /\.(js|css)$/.test(f))
    .sort();
  return [
    ...files.map((f) => ({ url: `/_next/static/${f.split(path.sep).join("/")}`, revision: null })),
    { url: "/~offline", revision },
  ];
}

/** Bundles sw.ts with the precache list into `outfile`; returns how many files it precaches. */
export async function buildWorker({ staticDir, outfile, revision }) {
  const manifest = precacheList(staticDir, revision);
  if (manifest.length < 2) throw new Error(`no scripts or styles in ${staticDir}: run next build first`);
  await build({
    entryPoints: [path.join(web, "sw.ts")],
    outfile,
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2020",
    define: { "self.__SW_MANIFEST": JSON.stringify(manifest) },
    logLevel: "warning",
  });
  return manifest.length;
}

if (process.argv[1] === import.meta.filename) {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? String(Date.now());
  const [publicDir, ...more] = staticDirs(web);
  const outfile = path.join(publicDir, "sw.js");
  const count = await buildWorker({ staticDir: path.join(web, ".next/static"), outfile, revision });
  for (const dir of more) copyFileSync(outfile, path.join(dir, "sw.js"));
  console.log(`sw.js: ${count} files precached, into ${[publicDir, ...more].map((d) => path.relative(web, d)).join(" and ")}`);
}
