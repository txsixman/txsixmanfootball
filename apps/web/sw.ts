/// <reference lib="esnext" />
/// <reference lib="webworker" />
// The service worker (Serwist, MIT), bundled into public/sw.js after `next build` by scripts/build-sw.mjs.
// - The app's own scripts and styles are precached at install; a new deploy brings a new list.
// - Pages are network first: online, a page always comes from the server unless it takes over 3 seconds. Offline, a
//   page you have visited comes from the cache, for 30 minutes at most, so a stale score is never shown for long. Only
//   pages that show no current scores (state championships, how the rankings work, search) are kept a week. A page
//   not cached, or too old, gets /~offline instead.
// - /admin, /auth, /sign-in and /account pages are never cached (lib/never-cached.ts).
// - School logos are cached on first view (30 days); the search index is network first.
import { isNeverCached } from "./lib/never-cached";
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type RuntimeCaching, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

/** A cached page older than this is never served: nearly every page shows a score, a rating or a record. */
const PAGE_MAX_AGE = 30 * 60;
/** Pages with nothing that changes during a season. */
const SETTLED_PAGES = /^\/(championships|rankings\/how|search|~offline)\/?$/;
const WEEK = 7 * 24 * 60 * 60;

const page = (cacheName: string, maxAgeSeconds: number) =>
  new NetworkFirst({
    cacheName,
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds, purgeOnQuotaError: true })],
  });

// The page (document) and the data Next fetches when a link is followed (RSC) are cached apart, each by kind of page.
const isPage = (request: Request) => request.mode === "navigate" || request.headers.get("RSC") === "1";

const runtimeCaching: RuntimeCaching[] = [
  // Sign-in, the admin console and (later) account pages show one person's view, and an auth address can carry a one-time
  // code: always the network, never the cache (lib/never-cached.ts lists them). First, so nothing below can claim them.
  { matcher: ({ sameOrigin, url }) => sameOrigin && isNeverCached(url.pathname), handler: new NetworkOnly() },
  // Other sites, the API and Vercel's analytics scripts are never cached.
  { matcher: ({ sameOrigin, url }) => !sameOrigin || /^\/(api|_vercel)\//.test(url.pathname), handler: new NetworkOnly() },
  { matcher: ({ request, url }) => isPage(request) && SETTLED_PAGES.test(url.pathname), handler: page("settled-pages", WEEK) },
  { matcher: ({ request }) => isPage(request), handler: page("pages", PAGE_MAX_AGE) },
  {
    matcher: ({ url }) => url.pathname.startsWith("/logos/"),
    handler: new CacheFirst({ cacheName: "logos", plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 })] }),
  },
  { matcher: ({ url }) => url.pathname.startsWith("/pagefind/"), handler: new NetworkFirst({ cacheName: "search", networkTimeoutSeconds: 3 }) },
  {
    matcher: ({ url }) => url.pathname.startsWith("/_next/static/") || /\.(woff2?|png|svg|ico)$/.test(url.pathname),
    handler: new CacheFirst({ cacheName: "static", plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })] }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: { entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }] },
});

serwist.addEventListeners();

// Score alerts (tools/push/send-finals.mjs): show the final, and open its page when tapped. Only paths on this site.
self.addEventListener("push", (event) => {
  const data = (() => {
    try {
      return event.data?.json() as { title?: string; body?: string; url?: string };
    } catch {
      return undefined;
    }
  })();
  if (!data?.title) return;
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon", badge: "/icon", data: { url } }));
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
