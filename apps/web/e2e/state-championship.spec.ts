import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import path from "node:path";
import { stateChampionships, type StateChampionship } from "../lib/state-championships";
import { noLiveScores } from "./live-route";
import { sitemapPaths } from "./sitemap-urls";

// One page for each league's State Championship this season, /championships/<season>/<bracket> (ADR 0083): the matchup, kickoff,
// site and projection before the game, the champion, score and runner-up after it, and each team's path and history.
noLiveScores(test);
test.use({ serviceWorkers: "block" });
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

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

const entry = async (slug: string): Promise<StateChampionship> => {
  const found = (await inWeb(() => stateChampionships(2026))).find((c) => c.slug === slug);
  expect(found, `a ${slug} State Championship in the 2026 brackets`).toBeDefined();
  return found!;
};

const axe = (page: import("@playwright/test").Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();

test("after the game: the champion, score, runner-up and the full bracket", async ({ page }) => {
  const c = await entry("tcaf");
  const res = await page.goto("/championships/2026/tcaf");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/^2026 TCAF State Championship \| /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/2026 TCAF State Championship/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/championships\/2026\/tcaf$/);
  const main = page.getByRole("main");
  expect(c.final, "TCAF's State Championship is recorded").toBeDefined();
  await expect(main.locator("[data-champion]")).toHaveText("Faustina Academy, 2026 TCAF State Champion");
  await expect(main).toContainText("60-16");
  await expect(main).toContainText("Runner-up");
  await expect(main).toContainText("Harvest Lantana");
  await expect(main.getByRole("link", { name: "Full bracket" })).toHaveAttribute("href", "/playoffs/bracket/tcaf");
  // Each team's path and history sit below the result.
  await expect(main.getByRole("heading", { level: 2, name: /playoff path/i })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: /State Championship history/i })).toBeVisible();
  await expect(main).not.toContainText(/final round|title game|championship game/i);
  await expect(page.locator("body")).not.toContainText(/maxpreps|odds|underdog|spread|upset/i);
});

test("before the game: both teams, the kickoff, the site with Directions and a projection", async ({ page }) => {
  const c = await entry("tapps-division-i");
  const res = await page.goto("/championships/2026/tapps-division-i");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/^2026 TAPPS Division I State Championship \| /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/2026 TAPPS Division I State Championship/i);
  const main = page.getByRole("main");
  for (const side of c.sides) await expect(main).toContainText(side.text);

  if (c.final) {
    // The game has been played since this test was written: the page names the champion instead.
    await expect(main.locator("[data-champion]")).toHaveText(`${c.final.champion}, 2026 TAPPS Division I State Champion`);
    await expect(main).toContainText(c.final.runnerUp);
    await expect(main.getByRole("link", { name: "Full bracket" })).toBeVisible();
    return;
  }
  await expect(main.locator("[data-champion]")).toHaveCount(0);
  await expect(main).not.toContainText(/State Champion(?!ship)/);
  if (c.kickoff) {
    await expect(main.getByText("Kickoff", { exact: true })).toBeVisible();
    await expect(main).toContainText(/\d{1,2}:\d{2} (AM|PM) CT/);
  }
  if (c.site) {
    await expect(main).toContainText(c.site);
    await expect(main.getByRole("link", { name: /^Directions/ })).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\//);
  }
  if (c.projection) {
    await expect(main).toContainText(/Projected margin/i);
    await expect(main).toContainText(/chance to win/i);
  }
  await expect(main.getByRole("link", { name: "Full bracket" })).toHaveAttribute("href", "/playoffs/bracket/tapps-division-i");
});

test("a bracket with no State Championship is a 404, and the sitemap lists the pages", async ({ page }) => {
  expect((await page.goto("/championships/2026/not-a-bracket"))?.status()).toBe(404);
  const map = await sitemapPaths(page.request);
  for (const p of ["/championships/2026/tcaf", "/championships/2026/tapps-division-i"]) expect(map, p).toContain(p);
});

for (const slug of ["tcaf", "tapps-division-i"]) {
  test(`${slug}: passes axe and fits a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/championships/2026/${slug}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      short: [...document.querySelectorAll("main a")].filter((el) => el.getBoundingClientRect().height < 44).length,
    }));
    expect(m).toEqual({ overflow: 0, short: 0 });
  });
}
