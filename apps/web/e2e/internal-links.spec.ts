import { expect, test, type Page } from "@playwright/test";
import { CURRENT_SEASON } from "../lib/season";
import { noLiveScores } from "./live-route";

// Neighbour links (lib/neighbours.ts): from a sample page of each kind, a crawler can step to the pages next to it. Every link
// found answers 200 and is a tap target at least 44px tall; link text names a place or a game, never a winner or a source.
test.use({ serviceWorkers: "block" });
noLiveScores(test);
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

const BAD_WORDS = /\bfinals?\b|\b(won|beat|defeated|winner|victory|spreads?|odds|lines?|bets?|favou?rites?|underdogs?|locks?)\b|maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;

/** Opens `path` and returns the links named (a link's href, by its text). Each must answer 200 and be 44px tall. */
async function neighbours(page: Page, path: string, names: RegExp[]) {
  expect((await page.goto(path))?.status(), path).toBe(200);
  const found: Record<string, string> = {};
  for (const name of names) {
    const link = page.getByRole("link", { name }).first();
    await expect(link, `${path}: ${name}`).toBeVisible();
    const text = (await link.textContent())!;
    expect(text, `${path}: ${name}`).not.toMatch(BAD_WORDS);
    expect((await link.boundingBox())!.height, `${path}: ${name} is a 44px tap target`).toBeGreaterThanOrEqual(43.5);
    const href = (await link.getAttribute("href"))!;
    expect((await page.request.get(href)).status(), `${path} -> ${href}`).toBe(200);
    found[name.source] = href;
  }
  return found;
}

test("a regular-season game links to its results week and each team's season", async ({ page }) => {
  const found = await neighbours(page, "/scores/2025-08-28-throckmorton-at-bluff-dale", [/^UIL 2025 week \d+ results$/, /^Throckmorton 2025 season$/, /^Bluff Dale 2025 season$/]);
  expect(Object.values(found)).toEqual(expect.arrayContaining(["/programs/throckmorton/2025", "/programs/bluff-dale/2025"]));
  expect(found["^UIL 2025 week \\d+ results$"]).toMatch(/^\/results\/2025\/\d+$/);
});

test("a past playoff game links to that season's league playoffs and its next playoff game", async ({ page }) => {
  // Valor South Austin at Fort Bend Chargers, TAIAO round 1, 2025.
  const found = await neighbours(page, "/scores/2025-11-07-valor-south-austin-at-fort-bend-chargers", [/^2025 TAIAO playoffs$/, /^Next playoff game: Semifinal, /, /^TAIAO 2025 week \d+ results$/]);
  expect(found["^2025 TAIAO playoffs$"]).toBe("/playoffs/season/2025/taiao");
  expect(found["^Next playoff game: Semifinal, "]).toMatch(/^\/scores\/2025-11-22-fort-bend-chargers-at-texas-wind$/);
  expect(found["^TAIAO 2025 week \\d+ results$"]).toMatch(/^\/results\/2025\/\d+\/taiao$/);
});

test("a semifinal links to the State Championship by that name in every league, never as a final", async ({ page }) => {
  // TAIAO 2025: Fort Bend Chargers at Texas Wind in the semifinal; the last round's game is BVCHEA vs Texas Wind.
  const found = await neighbours(page, "/scores/2025-11-22-fort-bend-chargers-at-texas-wind", [/^Next playoff game: State Championship, /]);
  expect(found["^Next playoff game: State Championship, "]).toMatch(/^\/scores\/2025-11-29-/);
});

test("a playoff game of the season under way links to its bracket and next playoff game", async ({ page }) => {
  expect(CURRENT_SEASON).toBe(2026);
  const found = await neighbours(page, "/scores/2026-round-1-valor-north-austin-at-fort-bend-chargers", [/ bracket$/, /^Next playoff game: /]);
  expect(found[" bracket$"]).toMatch(/^\/playoffs\/bracket\/taiao/);
  expect(found["^Next playoff game: "]).toMatch(/^\/scores\/2026-quarterfinal-/);
});

test("a results week links to its review and, in the season under way, its rankings, in its own organization", async ({ page }) => {
  const past = await neighbours(page, "/results/2025/5", [/^UIL week 5 in review$/]);
  expect(past["^UIL week 5 in review$"]).toBe("/weeks/2025/5");
  await expect(page.getByRole("link", { name: /rankings after week/ })).toHaveCount(0); // only the season under way has week rankings
  const now = await neighbours(page, "/results/2026/12", [/^UIL week 12 in review$/, /^UIL rankings after week 12$/]);
  expect(now).toMatchObject({ "^UIL week 12 in review$": "/weeks/2026/12", "^UIL rankings after week 12$": "/rankings/week/12" });
  const tapps = await neighbours(page, "/results/2026/12/tapps", [/^TAPPS week 12 in review$/, /^TAPPS rankings after week 12$/]);
  expect(tapps).toMatchObject({ "^TAPPS week 12 in review$": "/weeks/2026/12/tapps", "^TAPPS rankings after week 12$": "/rankings/week/12/tapps" });
});

test("a week in review links to the week's rankings", async ({ page }) => {
  const found = await neighbours(page, "/weeks/2026/12/tapps", [/^TAPPS rankings after week 12$/, /^Week 12 results$/, /^Week 11 in review$/, /^Week 13 in review$/]);
  expect(found["^TAPPS rankings after week 12$"]).toBe("/rankings/week/12/tapps");
  expect(found["^Week 12 results$"]).toBe("/results/2026/12/tapps");
});

test("a rankings week links to the week's results and review, in its own organization", async ({ page }) => {
  const found = await neighbours(page, "/rankings/week/12/tapps", [/^TAPPS week 12 results$/, /^TAPPS week 12 in review$/, /^After week 11, /, /^After week 13, /]);
  expect(found).toMatchObject({ "^TAPPS week 12 results$": "/results/2026/12/tapps", "^TAPPS week 12 in review$": "/weeks/2026/12/tapps" });
  const uil = await neighbours(page, "/rankings/week/12", [/^UIL week 12 results$/, /^UIL week 12 in review$/]);
  expect(uil).toMatchObject({ "^UIL week 12 results$": "/results/2026/12", "^UIL week 12 in review$": "/weeks/2026/12" });
});

test("a program's season links to the other seasons and to the season's results", async ({ page }) => {
  const past = await neighbours(page, "/programs/jayton/2025", [/^2024$/, /^2026$/, /^2025 UIL results by week/]);
  expect(past).toMatchObject({ "^2024$": "/programs/jayton/2024", "^2026$": "/programs/jayton/2026", "^2025 UIL results by week": "/results/2025" });
  const now = await neighbours(page, "/programs/jayton/2026", [/^2026 UIL results by week/]);
  expect(Object.values(now)).toEqual(["/results"]); // the organization's latest season is its bare address
});

test("a series links to both programs and every game of it", async ({ page }) => {
  expect((await page.goto("/series/bluff-dale/throckmorton"))?.status()).toBe(200);
  expect(await page.locator("a[href^='/scores/']").count()).toBeGreaterThan(1);
  expect(await page.locator("a[href^='/programs/bluff-dale'], a[href^='/programs/throckmorton']").count()).toBeGreaterThan(0);
});
