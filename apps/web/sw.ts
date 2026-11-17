/// <reference lib="esnext" />
/// <reference lib="webworker" />
// The service worker (Serwist, MIT), bundled into public/sw.js after `next build` by scripts/build-sw.mjs. The rules for what it
// keeps are in lib/sw-rules.ts (ADR 0096).
// - The app's own scripts and styles are precached at install; a new deploy brings a new list. Other static files (fonts, icons)
//   are cache first in a cache named for the build, and every older cache is deleted when a new worker activates.
// - Pages are network first: online, a page comes from the server unless it takes over 3 seconds. Offline or on a weak signal,
//   a page you opened comes from the cache for 12 hours at most, at most 60 pages, the least recent out. Every saved page is
//   stamped with when it was saved, and the page it opens says so (app/offline-notice.tsx). Only pages that show no current
//   scores (state championships, how the rankings work, search) are kept a week. A page not saved, or too old, gets /~offline.
// - A page can ask the worker to save pages ahead of time (message "save", lib/save-tonight.ts), and to say whether it is a saved
//   copy and from when (message "saved-copy?").
// - /admin, /auth, /sign-in, /account and /forums pages and every /api address are never cached (lib/never-cached.ts).
// - School logos are cached on first view (30 days); the search index is network first.
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type RuntimeCaching, type SerwistGlobalConfig, type SerwistPlugin } from "serwist";
import { MAX_PAGES, NETWORK_TIMEOUT_S, PAGE_MAX_AGE_S, SAVED_AT, SAVED_COPY, SETTLED_MAX_AGE_S, cacheKind, cacheNames, canSave, isFresh, staleCaches } from "./lib/sw-rules";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    /** The build's commit, set by scripts/build-sw.mjs. */
    __SW_REVISION: string;
  }
}
declare const self: ServiceWorkerGlobalScope;

const CACHES = cacheNames(self.__SW_REVISION);
const DAY = 24 * 60 * 60;

// A page's cache entry carries the time it was saved. When one is used it is handed on with a second header (SAVED_COPY), and the
// worker remembers, for the page that asked, that it showed a saved copy and from when.
const servedSaved = new Map<string, number>();
const remember = (key: string, at: number | null) => {
  if (at === null) servedSaved.delete(key);
  else {
    servedSaved.set(key, at);
    if (servedSaved.size > 100) servedSaved.delete(servedSaved.keys().next().value as string);
  }
};

const savedPlugin = (maxAgeS: number): SerwistPlugin => ({
  // Only a plain, public 200 is kept (this replaces Serwist's default, which would also keep opaque answers), stamped with now.
  cacheWillUpdate: async ({ response }) => {
    if (response.status !== 200 || response.type === "opaque" || /no-store|private/i.test(response.headers.get("cache-control") ?? "")) return null;
    const headers = new Headers(response.headers);
    headers.set(SAVED_AT, String(Date.now()));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
  // Used only when the network failed or was slow: too old, or never stamped, is no copy at all.
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return null;
    const at = Number(cachedResponse.headers.get(SAVED_AT));
    if (!isFresh(at, Date.now(), maxAgeS)) return null;
    const headers = new Headers(cachedResponse.headers);
    headers.set(SAVED_COPY, String(at));
    return new Response(cachedResponse.body, { status: cachedResponse.status, statusText: cachedResponse.statusText, headers });
  },
  handlerWillRespond: async ({ request, response, event }) => {
    const e = event as Partial<FetchEvent>;
    const client = e.resultingClientId || e.clientId;
    if (client) {
      const at = Number(response.headers.get(SAVED_COPY));
      remember(`${client} ${new URL(request.url).pathname}`, at > 0 ? at : null);
    }
    return response;
  },
});

const pagePlugins = (maxAgeS: number, cacheName: string): SerwistPlugin[] => [savedPlugin(maxAgeS), new ExpirationPlugin({ maxEntries: cacheName === CACHES.settled ? 30 : MAX_PAGES, purgeOnQuotaError: true })];
const page = (cacheName: string, plugins: SerwistPlugin[]) => new NetworkFirst({ cacheName, networkTimeoutSeconds: NETWORK_TIMEOUT_S, plugins });

const documents = pagePlugins(PAGE_MAX_AGE_S, CACHES.page);
const pageHandler = page(CACHES.page, documents);
// Saving a page ahead of time waits for the network as long as it takes, and writes to the same cache with the same plugins.
const saveHandler = new NetworkFirst({ cacheName: CACHES.page, plugins: documents });

const handlers = {
  // Never cached comes first, so nothing else can claim a sign-in, admin or API address.
  "network-only": new NetworkOnly(),
  settled: page(CACHES.settled, pagePlugins(SETTLED_MAX_AGE_S, CACHES.settled)),
  page: pageHandler,
  // The data Next fetches when a link is followed (RSC), apart from the documents so each keeps its own count of 60.
  "page-data": page(CACHES.data, pagePlugins(PAGE_MAX_AGE_S, CACHES.data)),
  // "My teams" (app/my-teams/block.tsx) asks for one small file per followed program.
  "my-teams": page(CACHES.myTeams, pagePlugins(PAGE_MAX_AGE_S, CACHES.myTeams)),
  logos: new CacheFirst({ cacheName: CACHES.logos, plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * DAY })] }),
  search: new NetworkFirst({ cacheName: CACHES.search, networkTimeoutSeconds: NETWORK_TIMEOUT_S }),
  static: new CacheFirst({ cacheName: CACHES.static, plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * DAY })] }),
};

const runtimeCaching: RuntimeCaching[] = Object.entries(handlers).map(([kind, handler]) => ({
  matcher: ({ request, sameOrigin, url }) => cacheKind({ sameOrigin, pathname: url.pathname, navigate: request.mode === "navigate", rsc: request.headers.get("RSC") === "1" }) === kind,
  handler,
}));

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: { entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }] },
});

serwist.addEventListeners();

// A new worker deletes the caches it no longer writes: the pages' old names and every earlier build's static files.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(staleCaches(names, self.__SW_REVISION).map((name) => caches.delete(name)))));
});

// Messages from a page (lib/saved-copy.ts, lib/save-tonight.ts), each answered on the port it sends.
// - "saved-copy?" { path, offline }: the time the copy of `path` the page showed was saved, or null when it came from the network.
//   If the worker was stopped and started since (it forgets), an offline page is a saved one: the stamp on the cached copy is the answer.
// - "save" { urls }: fetches each page now and keeps it (only canSave paths, at most 12); answers { pages, bytes } (bytes as stored).
async function savedAtFromCache(path: string): Promise<number | null> {
  const at = Number((await (await caches.open(CACHES.page)).match(path))?.headers.get(SAVED_AT));
  return isFresh(at, Date.now(), PAGE_MAX_AGE_S) ? at : null;
}

async function saveAhead(event: ExtendableMessageEvent, urls: unknown[]) {
  let pages = 0;
  let bytes = 0;
  for (const path of urls.slice(0, 12)) {
    if (typeof path !== "string" || !canSave(path)) continue;
    try {
      const response = await saveHandler.handle({ request: new Request(new URL(path, self.location.origin), { credentials: "same-origin" }), event });
      // A copy served from the cache (the network failed) is not a page saved just now.
      if (response.headers.has(SAVED_COPY)) continue;
      bytes += (await response.clone().arrayBuffer()).byteLength;
      pages += 1;
    } catch {
      // This page could not be fetched; the others still are.
    }
  }
  return { pages, bytes };
}

self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; path?: unknown; offline?: unknown; urls?: unknown } | null;
  const port = event.ports[0];
  if (!port) return;
  if (data?.type === "saved-copy?" && typeof data.path === "string") {
    const client = (event.source as Client | null)?.id;
    const at = servedSaved.get(`${client} ${data.path}`) ?? null;
    event.waitUntil((at !== null || data.offline !== true ? Promise.resolve(at) : savedAtFromCache(data.path)).then((answer) => port.postMessage({ savedAt: answer })));
  } else if (data?.type === "save" && Array.isArray(data.urls)) {
    event.waitUntil(saveAhead(event, data.urls).then((result) => port.postMessage(result)));
  }
});

// Game alerts (tools/push/send-finals.mjs): a kickoff, a final and the next playoff pairing, each with its game page's path as the
// url and a tag. Show it, and open the page when tapped. Only paths on this site. The tag is kept only when it is plain
// (lowercase letters, digits and : | . _ -, up to 120), so a game's final replaces its kickoff on the device and nothing else is touched.
const TAG = /^[a-z0-9:|._-]{1,120}$/;

self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data?.json() as { title?: string; body?: string; url?: string; tag?: string };
    } catch {
      return undefined;
    }
  })();
  if (!data?.title) return;
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  const tag = typeof data.tag === "string" && TAG.test(data.tag) ? { tag: data.tag, renotify: false } : {};
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon", badge: "/icon", data: { url }, ...tag }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string })?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
