import { expect, test } from "@playwright/test";

// The phone-first pass on Programs, Playoffs and Matchup: the new pieces each page relies on.

test("playoffs: a bracket with several rounds has a jump bar, and each link lands on a round of that bracket", async ({ page }) => {
  await page.goto("/playoffs/tapps");
  const bar = page.getByRole("navigation", { name: "TAPPS Division I rounds" });
  const hrefs = await bar.getByRole("link").evaluateAll((els) => els.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThan(1);
  for (const href of hrefs) await expect(page.locator(href), href).toHaveCount(1);
  // Same order as the rounds themselves, and the same names.
  const names = await bar.getByRole("link").allTextContents();
  const headings = await page.getByRole("region", { name: "TAPPS Division I", exact: true }).locator("section[id] > h3").allTextContents();
  expect(headings.map((h) => h.split("·")[0].trim())).toEqual(names);
  await bar.getByRole("link").last().click();
  await expect(page).toHaveURL(new RegExp(`${hrefs.at(-1)}$`));
});

test("playoffs: state title chances are linked, ranked rows with the percent read out, in the bracket they belong to", async ({ page }) => {
  await page.goto("/playoffs/tapps");
  const chances = page.getByRole("region", { name: "TAPPS Division I", exact: true }).getByRole("region", { name: "State title chances" });
  const rows = chances.getByRole("listitem");
  expect(await rows.count()).toBeGreaterThan(1);
  await expect(rows.first().getByRole("link")).toHaveAttribute("href", /^\/programs\/.+/);
  await expect(rows.first()).toContainText(/\d+%|<1%|>99%/);
});

test("playoffs: a projection reads on its own line, the words rating, projected margin and chance to win only", async ({ page }) => {
  await page.goto("/playoffs");
  const first = page.getByText(/^Projected: .+ by (\d+|45\+) · (>99|\d+)% chance to win$/).first();
  await expect(first).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\b(spread|odds|lines?|bets?|betting)\b/i);
});

test("programs: the organization bar shows each organization's count, and the counts add up to the total", async ({ page }) => {
  await page.goto("/programs", { waitUntil: "networkidle" });
  const links = page.getByRole("navigation", { name: "Jump to an organization" }).getByRole("link");
  const counts = (await links.allTextContents()).map((t) => Number(/(\d+)$/.exec(t.trim())![1]));
  expect(counts).toHaveLength(5); // UIL, TAPPS, TAIAO, TCAF and Independent (one program for now)
  await expect(page.getByRole("status")).toHaveText(`${counts.reduce((a, b) => a + b, 0)} programs`);
  // Each count is the one on that organization's own bar.
  for (const [i, slug] of ["uil", "tapps", "taiao", "tcaf", "independent"].entries()) {
    await expect(page.locator(`#org-${slug}`)).toContainText(new RegExp(`${counts[i]} programs?`));
  }
  // Searching keeps the bar in step with what is left.
  await page.getByRole("searchbox", { name: "Find a school" }).fill("grayson christian");
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveText(/TAIAO\s*1/);
});

test("programs: school names line up in a district whatever the logo's shape", async ({ page }) => {
  await page.goto("/programs", { waitUntil: "networkidle" });
  const lefts = await page.locator("#org-uil article").first().getByRole("link").evaluateAll((els) => els.map((a) => Math.round(a.querySelector("span.min-w-0")!.getBoundingClientRect().left)));
  expect(lefts.length).toBeGreaterThan(1);
  expect(new Set(lefts).size).toBe(1);
});

test("matchup: the site is a whole-segment tap target, and the result names both teams with their crests", async ({ page }) => {
  await page.goto("/matchup?a=gordon&b=rankin", { waitUntil: "networkidle" });
  const result = page.getByRole("region", { name: "Projection" });
  await expect(result.getByRole("link", { name: "Gordon" })).toHaveAttribute("href", "/programs/gordon");
  await expect(result.getByRole("link", { name: "Rankin" })).toHaveAttribute("href", "/programs/rankin");
  // Tapping the words (not the hidden radio) picks the site.
  const segment = page.locator("label", { hasText: "At Rankin" });
  expect((await segment.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await segment.click();
  await expect(page.getByRole("radio", { name: "At Rankin" })).toBeChecked();
  await expect(page).toHaveURL(/at=b$/);
  // The bar under the projection is for the eye only: it adds nothing to read out.
  await expect(result.locator("[aria-hidden=true]").first()).toBeVisible();
});

test("matchup: the same team twice, or none chosen, says what to do", async ({ page }) => {
  await page.goto("/matchup", { waitUntil: "networkidle" });
  const result = page.getByRole("region", { name: "Projection" });
  await expect(result).toHaveText("Choose two teams to see a projection.");
  await page.goto("/matchup?a=gordon&b=gordon", { waitUntil: "networkidle" });
  await expect(result).toHaveText("Choose two different teams.");
});
