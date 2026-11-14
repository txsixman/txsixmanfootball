import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CENTEX, ORG_TABS } from "./independent";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// ADR 0012: each organization stands alone on Scores, Standings, Programs and the Matchup pickers.

const SHOTS = path.join(__dirname, ".results", "shots");

async function checkPage(page: Page, url: string, stem: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${stem}-fold.png`) });
  await page.screenshot({ path: path.join(SHOTS, `${stem}-full.png`), fullPage: true });

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button, main input")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44 && !el.matches("input");
    }).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0 });
  expect(errors).toEqual([]);
}

test("Scores has one button per organization, no All and no Private, and shows one organization at a time", async ({ page }, info) => {
  await checkPage(page, "/scores", `orgs-scores-${info.project.name}`);
  const filters = page.getByRole("group", { name: "Show games from" });
  await expect(filters.getByRole("button")).toHaveText(["UIL", "TAPPS", "TAIAO", "TCAF"]);
  await expect(filters.getByRole("button", { name: /^(All|Private)/ })).toHaveCount(0);
  await expect(filters.getByRole("button", { name: "UIL", exact: true })).toHaveAttribute("aria-pressed", "true");

  const leagueHeadings = page.getByRole("heading", { level: 3 });
  await expect(leagueHeadings.filter({ hasText: /^UIL DI\b/ }).first()).toBeVisible(); // UIL keeps its two divisions
  await expect(leagueHeadings.filter({ hasText: /^UIL DII\b/ }).first()).toBeVisible();
  await expect(leagueHeadings.filter({ hasText: /^(TAPPS|TAIAO|TCAF)/ })).toHaveCount(0);

  for (const org of ["TAPPS", "TAIAO", "TCAF"]) {
    await filters.getByRole("button", { name: org, exact: true }).click();
    await expect(filters.getByRole("button", { name: org, exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator("[data-game]").count(), org).toBeGreaterThan(0);
    const titles = await leagueHeadings.allTextContents();
    expect(titles.length, org).toBeGreaterThan(0);
    for (const t of titles) expect(t, org).toMatch(new RegExp(`^${org}\\b`));
  }
});

test("the sample scoreboard also shows one organization at a time", async ({ page }) => {
  await page.goto("/scores/sample", { waitUntil: "networkidle" });
  const filters = page.getByRole("group", { name: "Show games from" });
  await expect(filters.getByRole("button")).toHaveText(["UIL", "TAPPS"]);
  await filters.getByRole("button", { name: "TAPPS" }).click();
  await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: /^UIL/ })).toHaveCount(0);
  expect(await page.locator("[data-game]").count()).toBeGreaterThan(0);
});

test("each standings page lists only its own organization's districts", async ({ page }, info) => {
  const pages: [string, string][] = [
    ["/standings", "UIL"],
    ["/standings/division-2", "UIL"],
    ["/standings/tapps", "TAPPS"],
    ["/standings/taiao", "TAIAO"],
    ["/standings/tcaf", "TCAF"],
  ];
  for (const [url, org] of pages) {
    await checkPage(page, url, `orgs-standings-${url.split("/").pop() || "uil"}-${info.project.name}`);
    const captions = await page.locator("table caption").allTextContents();
    expect(captions.length, url).toBeGreaterThan(0);
    for (const c of captions) expect(c, url).toMatch(new RegExp(`^${org}\\b`));
    await expect(page.getByRole("navigation", { name: "Standings by organization" }).getByRole("link")).toHaveText(["UIL", "TAPPS", "TAIAO", "TCAF"]);
  }
  // UIL splits into divisions on its own row; the other organizations have no such row.
  await page.goto("/standings");
  await expect(page.getByRole("navigation", { name: "UIL standings by division" }).getByRole("link")).toHaveText(["Division I", "Division II"]);
  await page.goto("/standings/tapps");
  await expect(page.getByRole("navigation", { name: "UIL standings by division" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Standings by organization" }).getByRole("link", { name: "TAPPS" })).toHaveAttribute("aria-current", "page");
  // Division I and Division II stay apart inside UIL.
  await page.goto("/standings");
  for (const c of await page.locator("table caption").allTextContents()) expect(c).toMatch(/^UIL Division I /);
  await page.goto("/standings/division-2");
  for (const c of await page.locator("table caption").allTextContents()) expect(c).toMatch(/^UIL Division II /);
});

test("/standings/private redirects to TAPPS", async ({ page }) => {
  await page.goto("/standings/private");
  await expect(page).toHaveURL(/\/standings\/tapps$/);
  expect(await page.locator("table caption").count()).toBeGreaterThan(0);
});

test("the programs finder groups schools by organization, never one mixed list", async ({ page }, info) => {
  await checkPage(page, "/programs", `orgs-programs-${info.project.name}`);
  const headings = page.getByRole("heading", { level: 2 });
  await expect(headings).toHaveCount(5);
  expect(await headings.allTextContents()).toEqual([
    expect.stringMatching(/^UIL/), expect.stringMatching(/^TAPPS/), expect.stringMatching(/^TAIAO/), expect.stringMatching(/^TCAF/), expect.stringMatching(/^Independent/),
  ]);
  // A school sits under its own organization only.
  await expect(page.locator("#org-uil").getByRole("link", { name: "Jayton" })).toHaveCount(1);
  await expect(page.locator("#org-tapps").getByRole("link", { name: "Jayton" })).toHaveCount(0);
  await expect(page.locator("#org-tapps").getByRole("link", { name: /^Jayton/ })).toHaveCount(0);
  await expect(page.locator("#org-uil").getByRole("heading", { level: 3 })).toHaveText(["Division I", "Division II"]);
  // A search narrows within each block; a school listed by two organizations shows once under each.
  await page.getByRole("searchbox", { name: "Find a school" }).fill("grayson christian");
  await expect(page.locator("#org-taiao").getByRole("link", { name: /Grayson Christian/ })).toHaveCount(1);
  await expect(page.locator("#org-tcaf").getByRole("link", { name: /Grayson Christian/ })).toHaveCount(1);
  await expect(page.locator("#org-uil")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("2 schools match");
  // Both lead to the one program, which shows its logo and its games (one page, not one per league).
  for (const org of ["taiao", "tcaf"]) {
    await expect(page.locator(`#org-${org}`).getByRole("link", { name: /Grayson Christian/ })).toHaveAttribute("href", "/programs/sherman-grayson-christian-school");
  }
  await page.goto("/programs/sherman-grayson-christian-school");
  await expect(page.locator("main img").first()).toHaveAttribute("src", "/logos/large/sherman-grayson-christian-school.webp");
  await expect(page.locator("main")).toContainText("Savoy");
  expect((await page.goto("/programs/grayson-christian"))?.status()).toBe(404);
});

test("a school two organizations list is ranked in each, counted within each", async ({ page }) => {
  for (const org of ["taiao", "tcaf"]) {
    await page.goto(`/rankings/${org}`);
    await expect(page.locator("main table").getByRole("link", { name: "Sherman Grayson Christian School" }), org).toHaveCount(1);
  }
});

const ratedFromOutsideOnly = (
  JSON.parse(readFileSync(path.join(__dirname, "../../../data/ratings/2026.json"), "utf8")).teams as { team: string }[]
).some((t) => t.team === CENTEX);

test("the matchup pickers list each organization's teams in their own option groups", async ({ page }) => {
  await page.goto("/matchup", { waitUntil: "networkidle" });
  for (const name of ["Team 1", "Team 2"]) {
    const labels = await page.getByRole("combobox", { name }).locator("optgroup").evaluateAll((els) => els.map((e) => (e as HTMLOptGroupElement).label));
    expect(labels.length, name).toBeGreaterThan(3);
    // Every option group belongs to exactly one organization, and an organization's groups sit together, in site order.
    const orgs = labels.map((l) => l.split(" ")[0]);
    // Independent is listed once it has a rated team: a rating can come from games against schools outside the
    // alignments (outside.csv), which are not in games.csv, so the picker may list it before its tabs appear.
    const pickerOrgs = ratedFromOutsideOnly ? [...ORG_TABS.filter((o) => o !== "Independent"), "Independent"] : ORG_TABS;
    expect(new Set(orgs)).toEqual(new Set(pickerOrgs));
    expect([...new Set(orgs)], name).toEqual(pickerOrgs);
    expect(orgs.join(",")).not.toMatch(/UIL.*(TAPPS|TAIAO|TCAF|Independent).*UIL|TAPPS.*(TAIAO|TCAF|Independent).*TAPPS|TAIAO.*(TCAF|Independent).*TAIAO|TCAF.*Independent.*TCAF/);
    // No option sits outside a group.
    expect(await page.getByRole("combobox", { name }).locator(":scope > option").count()).toBe(1); // "Choose a team"
  }
  // Comparing across organizations is still allowed.
  await page.getByRole("combobox", { name: "Team 1" }).selectOption("jayton");
  const tapps = await page.getByRole("combobox", { name: "Team 2" }).locator("optgroup[label^='TAPPS'] option").first().getAttribute("value");
  await page.getByRole("combobox", { name: "Team 2" }).selectOption(tapps!);
  await expect(page.getByRole("region", { name: "Projection" })).toContainText(/chance to win/);
});
