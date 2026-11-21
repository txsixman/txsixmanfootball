/** The site's one public address (ADR 0014): canonical links, the sitemap and robots.txt point here. */
export const SITE_URL = "https://txsixmanfootball.com";

/** What visitors see the site called (the owner, Nov 11, 2026). "Project 80x40" stays the codename in the repo and docs. */
export const SITE_NAME = "TX Six-Man Football";

/**
 * The Open Graph fields every page shares (a link preview's type, site name, language and address). A page that sets its own
 * `openGraph` (for its card) replaces the layout's whole object, so it spreads this in; the address "./" is the page's own,
 * under `metadataBase`, the public host whichever served it.
 */
export const OPEN_GRAPH = { type: "website" as const, siteName: SITE_NAME, locale: "en_US", url: "./" };
