import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// Light and dark (ADR 0035): the page follows the system setting, the footer's choice overrides it and is kept, and every
// kind of page passes WCAG AA contrast in both themes.

const PAGE_DARK = "rgb(13, 21, 38)"; // globals.css --color-page, dark
const PAGE_LIGHT = "rgb(255, 255, 255)";
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const choice = (page: Page, name: string) => page.getByRole("group", { name: "Color theme" }).getByRole("button", { name });

test("the page follows the system setting until a choice is made", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  expect(await background(page)).toBe(PAGE_DARK);
  await expect(choice(page, "System")).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "light" });
  expect(await background(page)).toBe(PAGE_LIGHT);
});

test("the footer's choice overrides the system, is kept across pages, and System hands back to it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/rankings");
  // Mounted: the toggle marks its choice only once it runs in the page.
  await expect(choice(page, "System")).toHaveAttribute("aria-pressed", "true");
  await choice(page, "Dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(PAGE_DARK);
  await expect(choice(page, "Dark")).toHaveAttribute("aria-pressed", "true");

  // Kept: the next page is dark from its first paint, and says so in the footer.
  await page.goto("/standings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(PAGE_DARK);
  await expect(choice(page, "Dark")).toHaveAttribute("aria-pressed", "true");

  // Light wins over a dark system.
  await page.emulateMedia({ colorScheme: "dark" });
  await choice(page, "Light").click();
  expect(await background(page)).toBe(PAGE_LIGHT);

  await choice(page, "System").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull();
  expect(await background(page)).toBe(PAGE_DARK);
  for (const name of ["System", "Light", "Dark"]) expect((await choice(page, name).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

// One page of each kind. Each is checked in both themes: axe's color-contrast rule (WCAG 2 AA).
const PAGES = [
  "/",
  "/scores",
  "/scores/sample",
  "/scores/g1",
  "/scores/tonight",
  "/playoffs",
  "/playoffs/tapps",
  "/playoffs/this-round",
  "/weeks",
  "/playoffs/bracket/tapps-division-i",
  "/results/2025/9",
  "/rankings",
  "/rankings/sample",
  "/rankings/how",
  "/standings",
  "/programs",
  "/programs/jayton",
  "/programs/ira/2025",
  "/championships",
  "/records",
  "/search?q=jayton",
  "/matchup?a=gordon&b=rankin",
  "/sign-in",
  "/no-such-page",
  "/~offline",
];

for (const url of PAGES) {
  test(`contrast passes AA in light and dark: ${url}`, async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const response = await page.goto(url, { waitUntil: "networkidle" });
      expect(response?.status(), url).toBe(url === "/no-such-page" ? 404 : 200);
      const axe = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      const found = axe.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message ?? v.id}`));
      expect(found, `${url} (${scheme})`).toEqual([]);
    }
  });
}
