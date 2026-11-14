import { expect, test, type Page } from "@playwright/test";

// Structured data (JSON-LD) on the pages search engines read: every block parses, has the type the page should carry, and
// holds no empty value, no "undefined" and no address that is not on the site.

const SITE = "https://txsixmanfootball.com";

test.setTimeout(120_000);

const blocks = (page: Page) =>
  page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((el) => JSON.parse(el.textContent ?? "") as Record<string, unknown>));

/** Every value in a block is present; a string is never empty or "undefined", and an address is absolute on the site. */
function expectClean(node: unknown, key = ""): void {
  if (Array.isArray(node)) return node.forEach((n) => expectClean(n, key));
  if (node && typeof node === "object") return Object.entries(node).forEach(([k, v]) => expectClean(v, k));
  expect(node, key).not.toBeNull();
  expect(node, key).not.toBeUndefined();
  if (typeof node !== "string") return;
  expect(node.trim(), key).not.toBe("");
  expect(node, key).not.toContain("undefined");
  if (["url", "item", "logo"].includes(key)) expect(node, key).toMatch(new RegExp(`^${SITE}/`));
}

/** The types a page carries, after checking that every block is clean. */
async function typesOf(page: Page, path: string) {
  await page.goto(path);
  const all = await blocks(page);
  expect(all.length, path).toBeGreaterThan(0);
  for (const b of all) {
    expect(b["@context"], path).toBe("https://schema.org");
    expectClean(b);
  }
  return Object.fromEntries(all.map((b) => [b["@type"] as string, b]));
}

test("a bracket page lists its games as SportsEvent, each at its own page; /playoffs lists the brackets", async ({ page }) => {
  await page.goto("/playoffs");
  const href = (await page.locator('a[href^="/playoffs/bracket/"]').first().getAttribute("href"))!;
  const league = await typesOf(page, "/playoffs");
  expect(league.ItemList).toMatchObject({ "@type": "ItemList" });
  const brackets = league.ItemList.itemListElement as { position: number; url: string }[];
  expect(brackets.map((b) => b.url)).toContain(`${SITE}${href}`);

  const bracket = await typesOf(page, href);
  expect(bracket.BreadcrumbList).toBeDefined();
  const games = (bracket.ItemList.itemListElement as { position: number; item: Record<string, unknown> }[]).map((i) => i.item);
  expect(games.length).toBeGreaterThan(0);
  for (const g of games) {
    expect(g["@type"]).toBe("SportsEvent");
    expect(g.url).toMatch(new RegExp(`^${SITE}/scores/`));
    expect(g.startDate).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/);
    expect((g.competitor as { "@type": string }[]).map((t) => t["@type"])).toEqual(["SportsTeam", "SportsTeam"]);
    // No result in the list: no score, no description.
    expect(g).not.toHaveProperty("description");
  }

  // A game in that list has its page and its own SportsEvent.
  const gamePath = new URL(games[0].url as string).pathname;
  const game = await typesOf(page, gamePath);
  expect(game.SportsEvent).toMatchObject({ "@type": "SportsEvent", url: games[0].url, sport: "Six-man football" });
  expect(game.BreadcrumbList).toBeDefined();
});

test("a program page has a SportsTeam and a trail", async ({ page }) => {
  const found = await typesOf(page, "/programs/jayton");
  expect(found.SportsTeam).toMatchObject({ name: "Jayton", url: `${SITE}/programs/jayton` });
  expect(found.BreadcrumbList).toBeDefined();
});

test("the home page names the site", async ({ page }) => {
  const found = await typesOf(page, "/");
  expect(found.WebSite).toMatchObject({ name: "TX Six-Man Football", url: `${SITE}/` });
});
