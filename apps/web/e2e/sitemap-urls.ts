import type { APIRequestContext } from "@playwright/test";

const PUBLIC = "https://txsixmanfootball.com";

/** /sitemap.xml is an index: every sitemap it lists, then every address in them, each with its lastmod if it has one. */
export async function sitemapUrls(request: APIRequestContext) {
  const index = await (await request.get("/sitemap.xml")).text();
  const children = [...index.matchAll(/<sitemap><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/sitemap>/g)].map((m) => ({ url: m[1], lastmod: m[2] }));
  const urls = [];
  for (const child of children) {
    const xml = await (await request.get(child.url.slice(PUBLIC.length))).text();
    for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)) urls.push({ url: m[1], lastmod: m[2], sitemap: child.url });
  }
  return { children, urls };
}

/** Each address as a path on this site ("/" for the home page). */
export const sitemapPaths = async (request: APIRequestContext) => (await sitemapUrls(request)).urls.map((u) => u.url.slice(PUBLIC.length) || "/");
