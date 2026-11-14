// Tells IndexNow (Bing, and so DuckDuckGo and Yahoo) which of our public pages changed, from the live sitemap.
// Plain Node 22, no dependencies. Usage: node tools/indexnow/ping.mjs [--since YYYY-MM-DD] [--dry-run]
// The key is public by design: the file apps/web/public/${KEY}.txt proves we own the host.
import { pathToFileURL } from "node:url";

export const HOST = "txsixmanfootball.com";
export const ORIGIN = `https://${HOST}`;
export const KEY = "5fb3670ec22f5d226737997fba7b3833";
export const ALWAYS = [`${ORIGIN}/`, `${ORIGIN}/scores`, `${ORIGIN}/playoffs`];
export const BATCH = 10000;
const ENDPOINT = "https://api.indexnow.org/indexnow";

// <loc>/<lastmod> pairs of a sitemap or a sitemap index (our own, machine-written XML: no entities beyond &amp;).
export function parseSitemap(xml) {
  const isIndex = /<sitemapindex[\s>]/.test(xml);
  const entries = [];
  for (const m of xml.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/g)) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(m[2])?.[1].replaceAll("&amp;", "&");
    const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(m[2])?.[1] ?? null;
    if (loc) entries.push({ loc, lastmod });
  }
  return { isIndex, entries };
}

export const onHost = (url) => url === ORIGIN || url.startsWith(`${ORIGIN}/`);

// URLs on our host whose lastmod (its date part) is on or after `since`; undated ones are left out. Order kept, no repeats; the bare origin is the home page.
export function pickUrls(entries, since) {
  const out = new Set();
  for (const { loc, lastmod } of entries) if (lastmod && lastmod.slice(0, 10) >= since && onHost(loc)) out.add(loc === ORIGIN ? `${ORIGIN}/` : loc);
  return [...out];
}

// The always-sent pages first, then the picked ones, each once, nothing off our host.
export function buildList(picked) {
  return [...new Set([...ALWAYS, ...picked])].filter(onHost);
}

export function batches(list, size = BATCH) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const utcDay = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main(argv) {
  const dry = argv.includes("--dry-run");
  const i = argv.indexOf("--since");
  const since = i >= 0 ? argv[i + 1] : utcDay(1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) throw new Error("--since needs YYYY-MM-DD");

  const index = parseSitemap(await get(`${ORIGIN}/sitemap.xml`));
  const children = index.isIndex ? index.entries.map((e) => e.loc).filter(onHost) : [];
  const entries = index.isIndex ? [] : index.entries;
  for (const child of children) entries.push(...parseSitemap(await get(child)).entries);

  const list = buildList(pickUrls(entries, since));
  console.log(`${list.length} URLs changed since ${since} (${children.length} sitemaps read)`);
  if (dry) {
    for (const u of list.slice(0, 20)) console.log(`  ${u}`);
    if (list.length > 20) console.log(`  ... and ${list.length - 20} more`);
    return 0;
  }
  let code = 0;
  for (const urlList of batches(list)) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList }),
      signal: AbortSignal.timeout(30000),
    });
    console.log(`batch of ${urlList.length}: HTTP ${res.status}`);
    if (res.status === 429) console.log("rate limited; will try again after the next deploy");
    else if (res.status !== 200 && res.status !== 202) code = 1;
  }
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
