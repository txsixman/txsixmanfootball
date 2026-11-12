import { expect, test } from "@playwright/test";
import { slugify } from "../lib/slug";
import { CENTEX, COMMUNITY_CHRISTIAN, independentHasGames, STANDINGS_TABS } from "./independent";

// The Independent organization (ADR 0012) and Community Christian (Mineral Wells) in TCAF, both from the schools' own
// sites (the owner, Nov 11, 2026). Independent has no districts, so no standings tab; it shows on Rankings, Results and
// Records once the results robot has read a game of its (see ./independent).

test("Standings never lists Independent, and has no page for it", async ({ page }) => {
  for (const url of ["/standings", "/standings/tcaf"]) {
    await page.goto(url);
    await expect(page.getByRole("navigation", { name: "Standings by organization" }).getByRole("link")).toHaveText(STANDINGS_TABS);
  }
  expect((await page.goto("/standings/independent"))?.status()).toBe(404);
});

test("the Programs finder lists CenTex Chargers under Independent and Community Christian under TCAF", async ({ page }) => {
  await page.goto("/programs", { waitUntil: "networkidle" });
  const independent = page.locator("#org-independent");
  await expect(independent).toContainText("1 program");
  await expect(independent.getByRole("link", { name: CENTEX })).toHaveAttribute("href", `/programs/${slugify(CENTEX)}`);
  await expect(page.locator("#org-tcaf").getByRole("link", { name: COMMUNITY_CHRISTIAN, exact: true })).toHaveAttribute("href", "/programs/community-christian");
  // A school sits under its own organization only.
  await expect(page.locator("#org-tcaf").getByRole("link", { name: CENTEX })).toHaveCount(0);
  await expect(independent.getByRole("link", { name: COMMUNITY_CHRISTIAN })).toHaveCount(0);
});

test("CenTex Chargers and Community Christian have program pages", async ({ page }) => {
  for (const [name, slug, eyebrow] of [
    [CENTEX, slugify(CENTEX), /^Independent$/],
    [COMMUNITY_CHRISTIAN, "community-christian", /^TCAF · District not listed$/],
  ] as const) {
    const response = await page.goto(`/programs/${slug}`, { waitUntil: "networkidle" });
    expect(response?.status(), slug).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByText(eyebrow).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/undefined|NaN/);
    // No link to a page that does not exist (Independent has no rankings pages until it has a game): a production
    // build prefetches every link, and a dead one keeps the page from settling.
    const hrefs = await page.locator("main a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
    for (const href of hrefs) expect((await page.request.get(href)).status(), `${slug} links ${href}`).toBe(200);
  }
});

test("Independent has rankings, results and records tabs only once it has a game", async ({ page }) => {
  for (const [section, tabs] of [["rankings", "Rankings by organization"], ["results", "Organization"], ["records", "Organization"]] as const) {
    const response = await page.goto(`/${section}/independent`);
    if (independentHasGames) {
      expect(response?.status(), section).toBe(200);
      await expect(page.getByRole("navigation", { name: tabs }).locator("[aria-current=page]")).toHaveText("Independent");
    } else {
      expect(response?.status(), section).toBe(404);
      await page.goto(`/${section}`);
      await expect(page.getByRole("navigation", { name: tabs }).getByRole("link", { name: "Independent" })).toHaveCount(0);
    }
  }
  if (independentHasGames) {
    await page.goto("/rankings/independent");
    await expect(page.getByRole("link", { name: CENTEX })).toBeVisible();
  }
});
