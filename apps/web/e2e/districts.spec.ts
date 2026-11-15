import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { sitemapPaths } from "./sitemap-urls";

// One page per district, /standings/district/<league-division>-district-<n>: its table, every district game with its score
// and game page, its bi-district partner and the other districts of its division. Then the reach check: every kind of page
// is at most two clicks from the home page, so a crawler that starts at / finds each kind early.
test.use({ serviceWorkers: "block" });
noLiveScores(test);
test.setTimeout(300_000);

const WINNER = /\b(won|beat|defeated|winner|victory)\b/i;
const SOURCE = /maxpreps|hudl|calpreps|sixmanfootball|dave campbell|uiltexas|source/i;

test("a UIL district page: its table, its games, its partner and the other districts", async ({ page }) => {
  await page.goto("/standings", { waitUntil: "networkidle" });
  const first = page.locator('[data-level="district"] h4 a').first();
  const href = (await first.getAttribute("href"))!;
  expect(href).toMatch(/^\/standings\/district\/uil-division-i-district-1$/);
  await first.click();
  await expect(page).toHaveURL(/\/standings\/district\/uil-division-i-district-1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("District 1");
  await expect(page).toHaveTitle(/^2026 UIL Division I District 1 six-man/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/standings\/district\/uil-division-i-district-1$/);
  await expect(page.getByRole("table")).toHaveCount(1);

  // Every district game links to its game page, away team first; no winner is named.
  const games = page.getByRole("region", { name: "District games" });
  const links = await games.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(links.length).toBeGreaterThan(0);
  for (const g of links.slice(0, 3)) expect((await page.request.get(g)).status(), g).toBe(200);
  await expect(page.getByRole("main")).not.toContainText(WINNER);
  await expect(page.getByRole("main")).not.toContainText(SOURCE);

  // District 1's bi-district partner is District 2; all 16 districts of the division are linked, this one marked.
  const more = page.getByRole("navigation", { name: "More standings" });
  await expect(more.getByRole("link", { name: "District 2, its bi-district partner" })).toHaveAttribute("href", "/standings/district/uil-division-i-district-2");
  await expect(more.getByRole("link", { name: "All UIL Division I standings" })).toHaveAttribute("href", /^\/standings#d-/);
  const others = page.getByRole("navigation", { name: "UIL Division I districts" }).getByRole("link");
  await expect(others).toHaveCount(16);
  await expect(others.first()).toHaveAttribute("aria-current", "page");
});

test("a TAPPS district page has no area, and links back to TAPPS standings", async ({ page }) => {
  const map = await sitemapPaths(page.request);
  const tapps = map.find((p) => /^\/standings\/district\/tapps-/.test(p));
  expect(tapps, "a TAPPS district page").toBeTruthy();
  await page.goto(tapps!);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^District \d+$/);
  const more = page.getByRole("navigation", { name: "More standings" });
  await expect(more.getByRole("link", { name: /bi-district partner/ })).toHaveCount(0);
  await expect(more.getByRole("link", { name: /^All TAPPS/ })).toHaveAttribute("href", /^\/standings\/tapps#d-/);
});

test("every district is in the sitemap, and an unknown district is a 404", async ({ page }) => {
  const map = await sitemapPaths(page.request);
  const districts = map.filter((p) => p.startsWith("/standings/district/"));
  expect(districts.filter((p) => /^\/standings\/district\/uil-division-i-district-\d+$/.test(p))).toHaveLength(16);
  expect(districts.filter((p) => /^\/standings\/district\/uil-division-ii-district-\d+$/.test(p))).toHaveLength(16);
  expect(districts.some((p) => p.includes("taiao")), "TAIAO has no districts").toBe(false);
  expect((await page.goto("/standings/district/uil-division-i-district-99"))?.status()).toBe(404);
});

test("a district page passes axe and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/standings/district/uil-division-ii-district-8", { waitUntil: "networkidle" });
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a")].filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent),
  }));
  expect(m).toEqual({ overflow: 0, short: [] });
});

/** The site's own page addresses a page's HTML links to, without query or hash. */
async function linksOn(request: APIRequestContext, path: string): Promise<string[]> {
  const res = await request.get(path);
  if (!res.ok() || !(res.headers()["content-type"] ?? "").includes("text/html")) return [];
  const html = await res.text();
  return [...new Set([...html.matchAll(/<a\b[^>]*\bhref="(\/[^"#?]*)/g)].map((m) => m[1].replace(/(.)\/$/, "$1")))];
}

// What a crawler sees: the links in each page's HTML. One page of every kind, every district page and every State
// Championship year must be at most two clicks from /.
const KINDS: [string, RegExp][] = [
  ["program", /^\/programs\/[^/]+$/],
  ["program season", /^\/programs\/[^/]+\/\d{4}$/],
  ["game", /^\/scores\/(?!tonight$|sample$)[^/]+$/],
  ["series", /^\/series\/[^/]+\/[^/]+$/],
  ["results week", /^\/results\/\d{4}\/\d+(\/[a-z]+)?$/],
  ["week in review", /^\/weeks\/\d{4}\/\d+(\/[a-z]+)?$/],
  ["rankings week", /^\/rankings\/week\/\d+(\/[a-z]+)?$/],
  ["rankings season", /^\/rankings\/season\/\d{4}(\/[a-z]+)?$/],
  ["standings group", /^\/standings\/(division-2|tapps|taiao|tcaf)$/],
  ["district", /^\/standings\/district\/[^/]+$/],
  ["bracket", /^\/playoffs\/bracket\/[^/]+$/],
  ["playoff season", /^\/playoffs\/season\/\d{4}(\/[a-z]+)?$/],
  ["records organization", /^\/records\/[a-z]+$/],
  ["State Championship year", /^\/championships\/\d{4}$/],
  ["season", /^\/seasons\/\d{4}$/],
];

test("every kind of page is at most two clicks from the home page", async ({ request }, info) => {
  test.skip(info.project.name === "phone", "the links do not depend on the viewport");
  const one = (await linksOn(request, "/")).filter((p) => p !== "/" && !p.startsWith("/api/"));
  const reached = new Set(one);
  for (let i = 0; i < one.length; i += 8) {
    for (const links of await Promise.all(one.slice(i, i + 8).map((p) => linksOn(request, p)))) for (const l of links) reached.add(l);
  }
  const map = await sitemapPaths(request);
  for (const [kind, re] of KINDS) {
    expect(map.some((p) => re.test(p)), `the sitemap has a ${kind} page`).toBe(true);
    expect([...reached].some((p) => re.test(p)), `a ${kind} page within two clicks of /`).toBe(true);
  }
  const far = map.filter((p) => /^\/(standings\/district|championships)\//.test(p) && !reached.has(p));
  expect(far, "district and State Championship year pages more than two clicks from /").toEqual([]);
});
