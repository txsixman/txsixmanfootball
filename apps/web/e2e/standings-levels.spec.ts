import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// Standings by level (ADR 0048): District, Area (the bi-district pair) and Region, the level kept in the URL, tables that
// fit a phone, and only the levels a league's alignment holds.
const level = (page: Page) => page.getByRole("navigation", { name: "Standings level" });
const noSidewaysScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const overall = (t: string) => {
  const [w, l, tie = 0] = t.trim().split("-").map(Number);
  return (w + tie / 2) / (w + l + tie || 1);
};

test("UIL standings: District, Area and Region, each level in the URL", async ({ page }) => {
  await page.goto("/standings", { waitUntil: "networkidle" });
  await expect(level(page).getByRole("link")).toHaveText(["District", "Area", "Region"]);
  await expect(level(page).getByRole("link", { name: "District" })).toHaveAttribute("aria-current", "true");
  // District: 16 tables, each named in full under its region and area.
  await expect(page.getByRole("table")).toHaveCount(16);
  await expect(page.getByRole("heading", { level: 4, name: "Region 1 · Area 1 (Districts 1–2) · District 1" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Region 4" })).toBeAttached();
  await noSidewaysScroll(page);

  // Area: 8 tables, every team of the two districts, by overall win %.
  await level(page).getByRole("link", { name: "Area" }).click();
  await expect(page).toHaveURL(/\/standings\?view=area$/);
  await expect(page.getByRole("table")).toHaveCount(8);
  const area = page.getByRole("table", { name: "UIL Division I · Region 1 · Area 1 (Districts 1–2) standings" });
  const districts = (await area.locator("tbody tr td:nth-child(3)").allTextContents()).map((t) => t.trim());
  expect(new Set(districts)).toEqual(new Set(["1", "2"]));
  const records = await area.locator("tbody tr td:nth-child(4)").allTextContents();
  for (let i = 1; i < records.length; i++) expect(overall(records[i - 1])).toBeGreaterThanOrEqual(overall(records[i]));
  await expect(page.getByText("ranked by overall win percentage, then point difference").first()).toBeVisible();
  await noSidewaysScroll(page);

  // Region, opened from its URL: 4 tables, and jump links to each region.
  await page.goto("/standings?view=region", { waitUntil: "networkidle" });
  await expect(level(page).getByRole("link", { name: "Region" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("table")).toHaveCount(4);
  const jump = page.getByRole("navigation", { name: "Jump to a region (region)" });
  await expect(jump.getByRole("link")).toHaveText(["Region 1", "Region 2", "Region 3", "Region 4"]);
  await jump.getByRole("link", { name: "Region 3" }).click();
  await expect(page).toHaveURL(/#s-region-r3$/);
  await expect(page.getByRole("heading", { name: "Region 3", exact: true })).toBeInViewport();
  await noSidewaysScroll(page);

  // Back goes to the level before.
  await page.goto("/standings", { waitUntil: "networkidle" });
  await level(page).getByRole("link", { name: "Area" }).click();
  await page.goBack();
  await expect(level(page).getByRole("link", { name: "District" })).toHaveAttribute("aria-current", "true");
});

test("a link to a district's table opens the District level", async ({ page }) => {
  await page.goto("/standings?view=region", { waitUntil: "networkidle" });
  const id = await page.locator('[data-level="district"] h4').first().getAttribute("id");
  await page.goto(`/standings?view=region#${id}`, { waitUntil: "networkidle" });
  await expect(page.locator(`#${id}`)).toBeVisible();
});

test("only the levels a league's alignment holds: TAPPS and TCAF districts, TAIAO regions", async ({ page }) => {
  for (const url of ["/standings/tapps", "/standings/tcaf", "/standings/taiao"]) {
    await page.goto(url, { waitUntil: "networkidle" });
    await expect(level(page)).toHaveCount(0);
    await expect(page.getByText(/· Area \d/)).toHaveCount(0);
    expect(await page.getByRole("table").count()).toBeGreaterThan(0);
    await noSidewaysScroll(page);
  }
  await page.goto("/standings/taiao", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /District \d/ })).toHaveCount(0);
});

test("the sample standings show every level with invented schools", async ({ page }) => {
  await page.goto("/standings/sample?view=area", { waitUntil: "networkidle" });
  await expect(page.getByRole("table")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Region 2 · Area 2 (Districts 7–8)" })).toBeVisible();
  await noSidewaysScroll(page);
});
