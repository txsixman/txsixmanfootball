/**
 * Pages the service worker (sw.ts) never keeps: they show a signed-in person's own view, and an auth page's address can
 * carry a one-time code; the forums show a signed-in person's forms and are noindex for now. Add the next account page here, and to the matcher in proxy.ts. A path matches by prefix.
 */
export const NEVER_CACHED = ["/admin", "/auth", "/sign-in", "/account", "/forums"];

export const isNeverCached = (pathname: string) => NEVER_CACHED.some((p) => pathname.startsWith(p));
