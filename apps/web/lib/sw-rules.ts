import { isNeverCached } from "./never-cached.ts";

// What the service worker (sw.ts) keeps, how, and for how long (ADR 0096). Pure, so the node tests run it as it is and the
// worker and the pages that ask it to save a page share one rule.

/** Pages (documents, and the data Next fetches for a followed link) kept at most; the least recently saved or used goes first. */
export const MAX_PAGES = 60;
/** A saved page is shown offline for this long (12 hours: a whole game night and the morning after). Past it the offline page
 * comes instead. Every saved page says when it was saved (app/offline-notice.tsx), so an old score is never shown as current. */
export const PAGE_MAX_AGE_S = 12 * 60 * 60;
/** Pages with nothing that changes during a season: state championships, how the rankings work, search, the offline page. */
export const SETTLED_MAX_AGE_S = 7 * 24 * 60 * 60;
/** How long a page waits for the network before the saved copy is shown. */
export const NETWORK_TIMEOUT_S = 3;

const SETTLED_PAGES = /^\/(championships|rankings\/how|search|~offline)\/?$/;

/** The header the worker stamps on every page it saves (ms since 1970), and the one it adds when it serves a saved copy. */
export const SAVED_AT = "x-saved-at";
export const SAVED_COPY = "x-saved-copy";

type CacheKind = "network-only" | "settled" | "page" | "page-data" | "my-teams" | "logos" | "search" | "static" | null;

/**
 * How the worker handles a request, by where it goes and what it is. `null`: not the worker's business (the browser goes to the
 * network). Never cached: another site, the API, Vercel's scripts, and every page that shows one person's view (never-cached.ts).
 */
export function cacheKind(r: { sameOrigin: boolean; pathname: string; navigate: boolean; rsc: boolean }): CacheKind {
  if (!r.sameOrigin) return "network-only";
  if (isNeverCached(r.pathname) || /^\/(api|_vercel)\//.test(r.pathname)) return "network-only";
  if (r.navigate) return SETTLED_PAGES.test(r.pathname) ? "settled" : "page";
  if (r.rsc) return "page-data";
  if (r.pathname.startsWith("/logos/")) return "logos";
  if (r.pathname.startsWith("/pagefind/")) return "search";
  if (r.pathname.startsWith("/my-teams/")) return "my-teams";
  if (r.pathname.startsWith("/_next/static/") || /\.(woff2?|png|svg|ico)$/.test(r.pathname)) return "static";
  return null;
}

/** The pages a fan may ask the worker to save ahead of time: score, program, playoff and championship pages, with no query. */
export function canSave(path: string): boolean {
  return path.length <= 200 && /^\/(scores|programs|playoffs|championships)(\/[a-z0-9~_-][a-z0-9~._-]*)*$/i.test(path) && !isNeverCached(path);
}

/** The caches the worker writes at run time, for the build `revision`. Static files are per build: a new deploy starts a new one. */
export const cacheNames = (revision: string) => ({
  page: "saved-pages",
  settled: "saved-settled",
  data: "saved-data",
  myTeams: "saved-my-teams",
  logos: "logos",
  search: "search",
  static: `static-${revision}`,
});

/** The caches to delete when a new worker activates: the ones this site made (any earlier name or build) that the new worker no
 * longer writes. The precache is Serwist's, which removes its own old versions. */
export function staleCaches(existing: string[], revision: string): string[] {
  const current = new Set<string>(Object.values(cacheNames(revision)));
  return existing.filter((name) => /^(pages|settled-pages|static|static-.+|saved-.+|logos|search|my-teams)$/.test(name) && !current.has(name));
}

/** A saved copy is usable if it carries its save time and is younger than `maxAgeS`. */
export function isFresh(savedAt: number, now: number, maxAgeS: number): boolean {
  return Number.isFinite(savedAt) && savedAt > 0 && savedAt <= now + 60_000 && now - savedAt <= maxAgeS * 1000;
}
