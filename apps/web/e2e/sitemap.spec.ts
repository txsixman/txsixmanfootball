import { expect, test } from "@playwright/test";
import { sitemapPaths, sitemapUrls } from "./sitemap-urls";

// The sitemap lists every public page and nothing search engines are told to skip: the invented sample games stay out,
// and one page of each kind it lists answers 200 with no noindex.
test.use({ serviceWorkers: "block" });
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

test("/sitemap.xml is an index of one sitemap per kind, and every lastmod is a game date, never a future one", async ({ request }) => {
  const { children, urls } = await sitemapUrls(request);
  expect(children.map((c) => c.url.replace(/^.*\/sitemaps\//, ""))).toEqual(["sections.xml", "programs.xml", "scores.xml", "series.xml", "results.xml", "weeks.xml"]);
  for (const c of children) expect(urls.some((u) => u.sitemap === c.url), c.url).toBe(true);
  expect(new Set(urls.map((u) => u.url)).size, "no address twice").toBe(urls.length);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  for (const u of urls.filter((x) => x.lastmod)) {
    expect(u.lastmod, u.url).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(u.lastmod! <= tomorrow, u.url).toBe(true);
  }
  // From the data: a program and a played game have one; a page with no game date has none.
  const at = (path: string) => urls.find((u) => u.url === `https://txsixmanfootball.com${path}`);
  expect(at("/programs/jayton")?.lastmod).toMatch(/^20\d\d-/);
  expect(at("/programs/jayton/2025")?.lastmod).toMatch(/^2025-|^2026-01-/);
  expect(urls.some((u) => /\/scores\/\d{4}-\d\d-\d\d-/.test(u.url) && u.lastmod && u.url.includes(u.lastmod)), "a game page dated by its game").toBe(true);
  for (const p of ["/about/ratings", "/rankings/how", "/championships", "/matchup"]) expect(at(p)?.lastmod, p).toBeUndefined();
  // Each sitemap's lastmod in the index is the newest of its pages'.
  for (const c of children) expect(c.lastmod, c.url).toBe(urls.filter((u) => u.sitemap === c.url && u.lastmod).map((u) => u.lastmod!).sort().at(-1));
  expect(new Set(urls.map((u) => u.lastmod).filter(Boolean)).size, "not one date for every page (the build time)").toBeGreaterThan(10);
});

test("the sitemap leaves out the sample games and lists the week, bracket and tonight pages", async ({ request }) => {
  const paths = await sitemapPaths(request);
  expect(paths.filter((p) => /^\/scores\/g\d+$/.test(p)), "sample games").toEqual([]);
  expect(paths.some((p) => /^\/scores\/[^/]+$/.test(p) && p !== "/scores/tonight"), "real game pages").toBe(true);
  for (const p of ["/weeks", "/scores/tonight", "/playoffs/this-round", "/seasons", "/seasons/2021", "/seasons/2025", "/seasons/2026"]) expect(paths, p).toContain(p);
  expect(paths.some((p) => p.startsWith("/weeks/")), "a week page").toBe(true);
  expect(paths.some((p) => p.startsWith("/playoffs/bracket/")), "a bracket page").toBe(true);
  expect(paths, "a program's season page").toContain("/programs/jayton/2025");
  expect(paths.some((p) => /^\/programs\/[a-z0-9-]+\/20\d\d$/.test(p)), "program season pages").toBe(true);
  expect(paths, "no season page for a season with no game read").not.toContain("/programs/dell-city/2024");
  expect(paths.some((p) => /^\/series\/[a-z0-9-]+\/[a-z0-9-]+$/.test(p)), "a series page").toBe(true);
  expect(paths.some((p) => /^\/(embed|account|admin|sign-in|forums|privacy|terms)(\/|$)/.test(p)), "embeds and fan pages stay out").toBe(false);
});

test("one page of each kind in the sitemap answers 200 and is not noindex", async ({ request }) => {
  const paths = await sitemapPaths(request);
  // The first address of each kind: its section, its depth, and whether its second segment is a number (a season).
  const firstOfKind = new Map<string, string>();
  for (const p of paths) {
    const [, section = "", second = ""] = p.split("/");
    const kind = `${section}/${p.split("/").length}/${/^\d+$/.test(second)}`;
    if (!firstOfKind.has(kind)) firstOfKind.set(kind, p);
  }
  // Season addresses are where a redirect could hide (the latest season redirects to the bare address): check them all.
  const seasons = paths.filter((p) => /^\/(results|rankings\/season)\/\d{4}(\/[a-z-]+)?$/.test(p));
  for (const p of new Set([...firstOfKind.values(), ...seasons])) {
    const res = await request.get(p, { headers: { host: "txsixmanfootball.com" }, maxRedirects: 0 });
    expect(res.status(), p).toBe(200);
    expect(res.headers()["x-robots-tag"], p).toBeUndefined();
    expect(await res.text(), p).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
  }
});
