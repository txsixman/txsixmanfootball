import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { slugify } from "../lib/slug";
import { placeTeams } from "../lib/rankings";
import type { Alignment } from "../lib/alignments";
import { ORG_TABS } from "./independent";

// Rankings stand inside one organization at a time (ADR 0012): UIL (the default), TAPPS, TAIAO, TCAF.

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

/** The school names an organization's alignment file lists (the school is the fifth column). */
const schools = (dir: string, league: string) =>
  readFileSync(path.join(__dirname, "../../../data/seed", dir, "alignments.csv"), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .filter((c) => c[0] === league)
    .map((c) => c[4]);

const tapps = schools("tapps-2026-28", "TAPPS");
const taiao = schools("private-2026", "TAIAO");
const tableTeams = async (page: Page) => (await page.getByRole("table").locator("tbody th[scope=row] span.line-clamp-3").allInnerTexts()).map((t) => t.trim());

test("every rankings page has an organization tab row marking the current one; divisions are under UIL only", async ({ page }) => {
  await page.goto("/rankings");
  const orgs = page.getByRole("navigation", { name: "Rankings by organization" });
  await expect(orgs.getByRole("link")).toHaveText(ORG_TABS);
  await expect(orgs.getByRole("link", { name: "UIL" })).toHaveAttribute("aria-current", "page");
  await expect(orgs.getByRole("link", { name: "TAPPS" })).toHaveAttribute("href", "/rankings/tapps");
  await expect(page.getByRole("navigation", { name: "Rankings by division" }).getByRole("link")).toHaveText(["All UIL", "Division I", "Division II"]);
  await page.goto("/rankings/division-2"); // a UIL division keeps UIL marked as the organization
  await expect(orgs.getByRole("link", { name: "UIL" })).toHaveAttribute("aria-current", "page");
  await page.goto("/rankings/taiao");
  await expect(orgs.getByRole("link", { name: "TAIAO" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Rankings by division" })).toHaveCount(0);
  await orgs.getByRole("link", { name: "TCAF" }).click();
  await expect(page).toHaveURL(/\/rankings\/tcaf$/, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "TCAF", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await page.goto("/rankings/tcal"))?.status()).toBe(404);
});

test("TAPPS rankings list only TAPPS teams, ranked from 1; no TAPPS team is on the UIL rankings", async ({ page }, info) => {
  await checkPage(page, "/rankings/tapps", `rankings-tapps-${info.project.name}`);
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toContainText(/^1/);
  await expect(rows.nth(2)).toContainText(/^2/);
  const teams = await tableTeams(page);
  expect(teams.length).toBeGreaterThan(30);
  for (const t of teams) expect(tapps, t).toContain(t);
  await expect(page.getByText(/^\d+ TAPPS teams from/)).toBeVisible();
  for (const url of ["/rankings", "/rankings/division-1", "/rankings/division-2", "/rankings/taiao", "/rankings/tcaf"]) {
    await page.goto(url);
    const here = await tableTeams(page);
    expect(here.filter((t) => tapps.includes(t)), url).toEqual([]);
  }
  await page.goto("/rankings/taiao");
  for (const t of await tableTeams(page)) expect(taiao, t).toContain(t);
});

/** A past season's rankings say how many of the organization's schools have a game that season. */
async function expectCoverage(page: Page) {
  const text = await page.locator("#season-coverage").innerText();
  const m = /^Games from (\d+) of (\d+) schools for this season\.$/.exec(text);
  expect(m, text).not.toBeNull();
  expect(Number(m![1])).toBeGreaterThan(0);
  expect(Number(m![1])).toBeLessThanOrEqual(Number(m![2]));
}

test("a past season is split by organization, keeping the organization when the season changes", async ({ page }, info) => {
  await checkPage(page, "/rankings/season/2025/tapps", `rankings-2025-tapps-${info.project.name}`);
  await expect(page.getByText(/^Final: \d+ teams in TAPPS from .* current alignments\./)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Rankings by division" })).toHaveCount(0);
  await expectCoverage(page);
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toContainText(/^1/);
  for (const t of await tableTeams(page)) expect(tapps, t).toContain(t);
  const seasons = page.getByRole("navigation", { name: "Season" });
  await expect(seasons.getByRole("link", { name: "2026" })).toHaveAttribute("href", "/rankings/tapps");
  await expect(seasons.getByRole("link", { name: "2025" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Rankings by organization" }).getByRole("link", { name: "UIL" }).click();
  await expect(page).toHaveURL(/\/rankings\/season\/2025$/, { timeout: 20_000 });
  expect(await tableTeams(page)).not.toContain(tapps[0]);
  await expectCoverage(page);
  expect((await page.goto("/rankings/season/2025/uil"))?.status()).toBe(404);
  // The season under way has no coverage line.
  await page.goto("/rankings");
  await expect(page.locator("#season-coverage")).toHaveCount(0);
});

test("a week's rankings are split by organization, keeping the organization when the week changes", async ({ page }, info) => {
  await page.goto("/rankings/tapps");
  await page.getByRole("link", { name: "TAPPS rankings at the end of each week" }).click();
  await expect(page).toHaveURL(/\/rankings\/week\/\d+\/tapps$/, { timeout: 20_000 });
  await checkPage(page, page.url(), `rankings-week-tapps-${info.project.name}`);
  const week = page.getByRole("navigation", { name: "Week" });
  const hrefs = await week.getByRole("link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(2);
  expect(hrefs.at(-1)).toBe("/rankings/tapps"); // "Now"
  for (const h of hrefs.slice(0, -1)) expect(h).toMatch(/^\/rankings\/week\/\d+\/tapps$/);
  await expect(page.getByRole("table").getByRole("row").nth(1)).toContainText(/^1/);
  for (const t of await tableTeams(page)) expect(tapps, t).toContain(t);
  const current = page.url();
  await page.getByRole("navigation", { name: "Rankings by organization" }).getByRole("link", { name: "UIL" }).click();
  await expect(page).toHaveURL(/\/rankings\/week\/\d+$/, { timeout: 20_000 });
  await expect(page.getByRole("navigation", { name: "Rankings by organization" }).getByRole("link", { name: "UIL" })).toHaveAttribute("aria-current", "page");
  expect(await tableTeams(page)).not.toContain(tapps[0]);
  expect(current).toContain("/tapps");
  expect((await page.goto(current.replace("/tapps", "/uil")))?.status()).toBe(404);
});

test("a team no alignment knows belongs to no organization: it is left out and counted, never an error", () => {
  const alignment = (school: string, league: string): Alignment => ({ league, division: "I", region: "1", district: "1", school, sourceUrl: "x", span: "2026-28", slug: slugify(school) });
  const alignments = [alignment("Cedar Gap", "UIL"), alignment("Dry Wash", "TAPPS")];
  const teams = ["Cedar Gap", "Out Of State High", "Dry Wash", "Eleven Man Prep"].map((team) => ({ team, rating: 1 }));
  const { placed, outside } = placeTeams(teams, alignments);
  expect(placed.map((t) => [t.team, t.school.league])).toEqual([["Cedar Gap", "UIL"], ["Dry Wash", "TAPPS"]]);
  expect(outside).toBe(2);
});

test("a program page shows its rank within its own organization", async ({ page }) => {
  await page.goto("/programs/harvest-christian-academy-keller");
  await expect(page.getByRole("link", { name: /^#\d+ in TAPPS$/ })).toHaveAttribute("href", "/rankings/tapps");
  await expect(page.locator("main")).not.toContainText(/overall/i);
});
