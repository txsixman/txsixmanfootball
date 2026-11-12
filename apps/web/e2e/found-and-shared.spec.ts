import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonLd } from "../app/json-ld";
import { demoGames } from "../lib/demo-games";
import { gameJsonLd } from "../lib/json-ld";

// Getting found and shared: structured data (JSON-LD), canonical links, breadcrumbs and the per-game share image.
// Fixtures come from the same lib the site is built from.

const SITE = "https://txsixmanfootball.com";

/** The loaders read ../../data from the working directory; the tests run from the repo root. */
async function inWeb<T>(run: () => Promise<T>): Promise<T> {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await run();
  } finally {
    process.chdir(was);
  }
}

/** A current-season game between two programs, played on one of their fields: robot-read, so its score is unconfirmed. */
const fixture = () =>
  inWeb(async () => {
    const { loadSeasonResults } = await import("../lib/games");
    const { loadAlignments, programFor } = await import("../lib/alignments");
    const alignments = await loadAlignments();
    const game = (await loadSeasonResults(2026)).find((r) => r.href === `/scores/${r.id}` && !r.forfeit && programFor(alignments, r.home) && programFor(alignments, r.away))!;
    return { game, homeSlug: programFor(alignments, game.home)!.slug, awaySlug: programFor(alignments, game.away)!.slug };
  });

test.setTimeout(120_000);

const jsonLd = (page: Page) =>
  page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((el) => JSON.parse(el.textContent ?? "")));
const ofType = async (page: Page, type: string) => (await jsonLd(page)).find((d) => d["@type"] === type);

test("a game page has SportsEvent markup with both programs and no score or winner (the score is unconfirmed)", async ({ page }) => {
  const { game, homeSlug, awaySlug } = await fixture();
  await page.goto(game.href);
  const event = await ofType(page, "SportsEvent");
  expect(event).toMatchObject({ name: `${game.away} at ${game.home}`, startDate: game.date, sport: "Six-man football", url: `${SITE}${game.href}` });
  expect(event.homeTeam).toMatchObject({ "@type": "SportsTeam", name: game.home, url: `${SITE}/programs/${homeSlug}` });
  expect(event.awayTeam).toMatchObject({ "@type": "SportsTeam", name: game.away, url: `${SITE}/programs/${awaySlug}` });
  expect(event.location).toMatchObject({ "@type": "Place" });
  // No result of any kind: no description, no winner, no score in any form.
  expect(Object.keys(event).filter((k) => /desc|result|winner|score/i.test(k))).toEqual([]);
  expect(JSON.stringify(event)).not.toMatch(/\bFinal\b/);
});

test("a confirmed final carries its score in the markup; an unconfirmed score, a forfeit and an unplayed game carry none", async () => {
  const g = (id: string) => demoGames.find((x) => x.id === id)!;
  const confirmed = gameJsonLd(g("g2"), { url: `${SITE}/scores/g2` }) as Record<string, unknown>;
  expect(confirmed.description).toBe(`Final: ${g("g2").away.name} 0, ${g("g2").home.name} 52.`);
  const unconfirmed = gameJsonLd(g("g3"), { url: `${SITE}/scores/g3` }) as Record<string, unknown>;
  expect(unconfirmed).not.toHaveProperty("description");
  const forfeited = gameJsonLd({ ...g("g2"), endReason: "Forfeit", homeScore: null, awayScore: null }, { url: `${SITE}/scores/x` }) as Record<string, unknown>;
  expect(forfeited).not.toHaveProperty("description");
  const unplayed = gameJsonLd({ ...g("g2"), state: "scheduled", homeScore: null, awayScore: null, verification: "none" }, { url: `${SITE}/scores/x` }) as Record<string, unknown>;
  expect(unplayed).not.toHaveProperty("description");
  expect(unplayed.eventStatus).toBe("https://schema.org/EventScheduled");
  // A site that is not listed is left out, and a neutral site names no home team.
  const unlisted = gameJsonLd({ ...g("g2"), venue: "Site not listed" }, { url: `${SITE}/scores/x` }) as Record<string, unknown>;
  expect(unlisted).not.toHaveProperty("location");
  expect(unlisted).not.toHaveProperty("homeTeam");
  expect(unlisted.competitor).toHaveLength(2);
});

test("text in the data cannot close the script tag", () => {
  const html = renderToStaticMarkup(createElement(JsonLd, { data: { name: "</script><b>x" } }));
  expect(html).not.toContain("</script><b>");
  expect(html).toContain("\\u003c/script>");
});

test("an invented sample game is out of search and has no SportsEvent markup", async ({ page }) => {
  await page.goto("/scores/g2");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await ofType(page, "SportsEvent")).toBeUndefined();
  expect(await ofType(page, "BreadcrumbList")).toBeDefined();
});

test("a program page has SportsTeam markup that names a logo only when the page shows one", async ({ page }) => {
  const { homeSlug } = await fixture();
  await page.goto(`/programs/${homeSlug}`);
  const team = await ofType(page, "SportsTeam");
  expect(team).toMatchObject({ sport: "Six-man football", url: `${SITE}/programs/${homeSlug}` });
  expect(team.name).toBeTruthy();
  const shown = await page.locator("header img[alt$=' logo']").count();
  expect(Boolean(team.logo)).toBe(shown > 0);
  if (team.logo) expect(team.logo).toMatch(new RegExp(`^${SITE}/logos/`));
});

test("the rankings page lists the ranked teams as an ItemList, in order, with page links and no numbers", async ({ page }) => {
  await page.goto("/rankings");
  const list = await ofType(page, "ItemList");
  expect(list.itemListElement.length).toBeGreaterThan(10);
  list.itemListElement.forEach((item: { position: number; url: string; name: string }, i: number) => {
    expect(item.position).toBe(i + 1);
    expect(item.url).toMatch(new RegExp(`^${SITE}/programs/`));
    expect(Object.keys(item).sort()).toEqual(["@type", "name", "position", "url"]);
  });
  // The first link in the table is the list's first team.
  const first = await page.locator("main table tbody tr a[href^='/programs/']").first().getAttribute("href");
  expect(list.itemListElement[0].url).toBe(`${SITE}${first}`);
});

test("section and detail pages carry a canonical link at the public address", async ({ page }) => {
  const { game, homeSlug } = await fixture();
  for (const url of [game.href, `/programs/${homeSlug}`, "/rankings", "/rankings/division-1", "/rankings/tapps", "/results", "/results/tapps", "/standings", "/standings/division-2", "/playoffs", "/playoffs/tapps"]) {
    await page.goto(url);
    await expect(page.locator('link[rel="canonical"]'), url).toHaveAttribute("href", `${SITE}${url}`);
  }
});

for (const [name, open] of [
  ["a game page", async () => (await fixture()).game.href],
  ["a program page", async () => `/programs/${(await fixture()).homeSlug}`],
] as const) {
  test(`${name} has a breadcrumb trail on screen and in the markup`, async ({ page }) => {
    await page.goto(await open());
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs).toHaveCount(1);
    await expect(crumbs.getByRole("link").first()).toHaveText("Home");
    await expect(crumbs.locator("[aria-current=page]")).toHaveCount(1);
    await expect(crumbs.locator("li").last().locator("[aria-current=page]")).toBeVisible();
    // Links are tap targets of at least 44px.
    for (const link of await crumbs.getByRole("link").all()) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const list = await ofType(page, "BreadcrumbList");
    const names = await crumbs.locator("li").allInnerTexts();
    expect(list.itemListElement.map((i: { name: string }) => i.name)).toEqual(names.map((n) => n.trim()));
    expect(list.itemListElement.map((i: { position: number }) => i.position)).toEqual(names.map((_, i) => i + 1));
    expect(list.itemListElement[0].item).toBe(`${SITE}/`);
    // The trail wraps rather than overflowing a phone.
    expect(await crumbs.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  });
}

test("a game's share image is a PNG", async ({ page, request }) => {
  const { game } = await fixture();
  await page.goto(game.href);
  const card = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(card).toBeTruthy();
  const response = await request.get(new URL(card!).pathname);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  expect((await response.body()).subarray(1, 4).toString()).toBe("PNG");
  // The invented sample game has one too.
  const sample = await request.get("/scores/g2/opengraph-image/card");
  expect(sample.headers()["content-type"]).toContain("image/png");
});

test("a past season's game page draws no card of its own", async ({ page }) => {
  const past = await inWeb(async () => (await (await import("../lib/games")).loadSeasonResults(2025)).find((r) => r.href === `/scores/${r.id}`)!);
  await page.goto(past.href);
  expect(await page.locator('meta[property="og:image"]').evaluateAll((els) => els.map((el) => el.getAttribute("content")))).not.toContainEqual(expect.stringContaining("/scores/"));
});
