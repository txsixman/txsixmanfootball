import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { sitemapPaths } from "./sitemap-urls";

// One page for each year with a State Championship game, /championships/<year>: both divisions' games from 2006 on, one game
// before, each school linked to its program page, and the years either side.
test.use({ serviceWorkers: "block" });
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

test("a year shows both divisions' games, linked schools that answer 200, and a title with the year", async ({ page }) => {
  const res = await page.goto("/championships/2019");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/^2019 UIL six-man State Championship: Division I and II \| /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/2019 State Championship/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/championships\/2019$/);
  for (const name of ["Division I", "Division II"]) {
    const section = page.getByRole("region", { name, exact: true });
    await expect(section.getByRole("row"), name).toHaveCount(2); // the header and the one game
    await expect(section).toContainText(/\d+-\d+/);
  }
  await expect(page.getByRole("main")).toContainText("Blum");
  await expect(page.getByRole("main")).toContainText("Richland Springs");
  const hrefs = await page.getByRole("main").locator('table a[href^="/programs/"]').evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThanOrEqual(2);
  for (const href of hrefs) expect((await page.request.get(href)).status(), href).toBe(200);
});

test("a year before 2006 shows one game", async ({ page }) => {
  await page.goto("/championships/1987");
  await expect(page).toHaveTitle(/^1987 UIL six-man State Championship game \| /);
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("main")).toContainText("Lohn");
});

test("previous and next years link, stop at the ends, and /championships links back and forth", async ({ page }) => {
  await page.goto("/championships/2019");
  const other = page.getByRole("navigation", { name: "Other years" });
  await expect(other.getByRole("link", { name: /2018/ })).toHaveAttribute("href", "/championships/2018");
  await other.getByRole("link", { name: /2020/ }).click();
  await expect(page).toHaveURL(/\/championships\/2020$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/2020 State Championship/i);
  await page.getByRole("navigation", { name: "Other years" }).getByRole("link", { name: "All State Championships" }).click();
  await expect(page).toHaveURL(/\/championships$/);
  await page.getByRole("link", { name: "2019" }).first().click();
  await expect(page).toHaveURL(/\/championships\/2019$/);
  await page.goto("/championships/1972");
  await expect(page.getByRole("navigation", { name: "Other years" }).getByRole("link", { name: /^← / })).toHaveCount(0);
});

test("the sitemap lists every year page, and a year with no game is a 404", async ({ page }) => {
  const map = await sitemapPaths(page.request);
  for (const year of [1972, 2019, 2025]) expect(map, String(year)).toContain(`/championships/${year}`);
  for (const bad of ["1965", "2099", "abcd"]) expect((await page.goto(`/championships/${bad}`))?.status(), bad).toBe(404);
});

test("a year's page says State Championship, never final, passes axe and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/championships/2019", { waitUntil: "networkidle" });
  await expect(page.getByRole("main")).not.toContainText(/\bfinals?\b/i);
  await expect(page.locator("body")).not.toContainText(/uiltexas|maxpreps|source/i);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a")].filter((el) => el.getBoundingClientRect().height < 44).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0 });
});
