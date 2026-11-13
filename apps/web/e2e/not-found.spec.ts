import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// An address with no page answers 404 with the site's own page: noindex, a search that needs no script, the main sections.
test.use({ serviceWorkers: "block" });
test.setTimeout(120_000); // the dev server compiles each route the first time it is asked

for (const url of ["/no-such-page", "/programs/no-such-school", "/scores/no-such-game"]) {
  test(`${url} answers 404 with a way back`, async ({ page }) => {
    const res = await page.goto(url);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Not here" })).toBeVisible();
    await expect(page).toHaveTitle(/^Page not found \| TX Six-Man Football$/);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    for (const name of ["Scores", "Playoffs", "Rankings", "Programs", "Results", "Home"]) {
      await expect(page.getByRole("main").getByRole("link", { name, exact: true })).toBeVisible();
    }
  });
}

test("the search on the 404 page is a plain form that lands on /search with the words", async ({ page }) => {
  await page.goto("/no-such-page");
  await page.getByRole("searchbox", { name: "Search programs and weeks" }).fill("jayton");
  await page.getByRole("main").getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search\?q=jayton$/);
});

test("the 404 page passes axe, fits a phone and its targets are 44px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/no-such-page");
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const target of await page.getByRole("main").locator("a, button, input").all()) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
