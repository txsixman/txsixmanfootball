// Where files written after `next build` must go to be served. On Vercel, Next's build adapter copies public/ into
// .next/output/static during `next build` itself, so a file written to public/ afterwards (the search index, the
// service worker) would never be deployed; it goes to both. Elsewhere (CI's `next start`) public/ alone.
import { existsSync } from "node:fs";
import path from "node:path";

/** public/, plus .next/output/static when a build adapter wrote one. */
export function staticDirs(web) {
  const adapter = path.join(web, ".next/output/static");
  return [path.join(web, "public"), ...(existsSync(adapter) ? [adapter] : [])];
}
