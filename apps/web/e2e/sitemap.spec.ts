import { expect, test } from "@playwright/test";

// The sitemap lists every public page and nothing search engines are told to skip: the invented sample games stay out,
// and one page of each kind it lists answers 200 with no noindex.
test.use({ serviceWorkers: "block" });
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

const PUBLIC = "https://txsixmanfootball.com";

async function sitemapPaths(request: import("@playwright/test").APIRequestContext) {
  const xml = await (await request.get("/sitemap.xml")).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].slice(PUBLIC.length) || "/");
}

test("the sitemap leaves out the sample games and lists the week, bracket and tonight pages", async ({ request }) => {
  const paths = await sitemapPaths(request);
  expect(paths.filter((p) => /^\/scores\/g\d+$/.test(p)), "sample games").toEqual([]);
  expect(paths.some((p) => /^\/scores\/[^/]+$/.test(p) && p !== "/scores/tonight"), "real game pages").toBe(true);
  for (const p of ["/weeks", "/scores/tonight", "/seasons", "/seasons/2021", "/seasons/2025", "/seasons/2026"]) expect(paths, p).toContain(p);
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
