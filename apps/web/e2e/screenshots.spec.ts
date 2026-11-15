import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// Screenshot tests: each page below must look the same as its baseline in e2e/screenshots.spec.ts-snapshots/, on
// phone and desktop. Baselines are made only in CI's Playwright container (fonts and rendering match there, not on a
// Mac): to approve a change, push the commit to a branch named screenshots/<anything>, or run the "Update screenshots"
// workflow, and it commits new baselines (CLAUDE.md). A missing baseline fails.
//
// The robots change scores, ratings and records every game week, and those commits do not run CI. So pages built from
// that data are checked only where the data cannot reach: the site header and each page's main heading. Whole pages are
// compared only where nothing changes on its own: the invented sample pages, search and the offline page.
test.skip(!process.env.CI, "screenshots are compared only in CI's container");

async function open(page: Page, url: string) {
  expect((await page.goto(url, { waitUntil: "networkidle" }))?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

const whole = ["/scores/sample", "/rankings/sample", "/standings/sample", "/search", "/~offline"];
for (const url of whole) {
  test(`looks the same: ${url}`, async ({ page }) => {
    await open(page, url);
    await expect(page).toHaveScreenshot(`${url.replace(/\W+/g, "-").replace(/^-/, "")}.png`, { fullPage: true, animations: "disabled" });
  });
}

// The site header (the banner landmark) and the page's main heading.
const live = ["/", "/rankings", "/results", "/scores", "/playoffs", "/programs/jayton"];
for (const url of live) {
  test(`header and title look the same: ${url}`, async ({ page }) => {
    await open(page, url);
    const name = url === "/" ? "home" : url.replace(/\W+/g, "-").replace(/^-/, "");
    await expect(page.getByRole("banner")).toHaveScreenshot(`${name}-site-header.png`);
    await expect(page.locator("main h1").first()).toHaveScreenshot(`${name}-title.png`);
  });
}
