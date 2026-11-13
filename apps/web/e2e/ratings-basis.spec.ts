import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { noLiveScores } from "./live-route";
import { CURRENT_SEASON } from "../lib/season";
import { slugify } from "../lib/slug";
import { playedCounts } from "../lib/season-results";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// "How much each rating rests on": the rankings and program pages show the games a team has played and the games rated, and
// /about/ratings says in plain words what a rating means. `rated` is only ever the ratings table's own field
// (services/ratings/run.py); `played` is counted from the season's games the site lists (lib/season-results.ts playedCounts).

const DATA = path.join(__dirname, "../../../data");
const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b/i;
const SOURCE = /maxpreps|hudl|calpreps|sixmanfootball|dave campbell|\bsources?\b/i;
const CODENAME = /80x40|brady|dcs2|\/Users\//i;

type Team = { team: string; rated: number; rated_outside?: number };
const table: { teams: Team[] } = JSON.parse(readFileSync(path.join(DATA, `ratings/${CURRENT_SEASON}.json`), "utf8"));
// The season's games, one per row (division,round,game_date,home,away,...): the games the site lists.
const games = readFileSync(path.join(DATA, `seed/maxpreps-${CURRENT_SEASON}/games.csv`), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const played = (team: string) => games.filter((g) => g[3] === team || g[4] === team).length;
const text = (n: number, rated: number) => `${n} played, ${rated} rated`;

/** The first team whose played and rated counts differ (a forfeit, say) and that has a program page here; Jayton otherwise. */
const withGap = table.teams.find((t) => played(t.team) !== t.rated && !t.team.includes(","));
const jayton = table.teams.find((t) => t.team === "Jayton")!;

test("played counts every game a team is in, forfeits too, through a date when one is given", () => {
  const results = [
    { home: "A", away: "B", date: "2026-09-04" },
    { home: "C", away: "A", date: "2026-09-11" }, // a forfeit counts as played
    { home: "A", away: "D", date: "2026-09-18" },
  ];
  expect(Object.fromEntries(playedCounts(results))).toEqual({ A: 3, B: 1, C: 1, D: 1 });
  expect(Object.fromEntries(playedCounts(results, "2026-09-12"))).toEqual({ A: 2, B: 1, C: 1 });
  expect(playedCounts([]).size).toBe(0);
});

test("the rankings show games played and games rated under each team, rated from the ratings table", async ({ page }) => {
  await page.goto("/rankings", { waitUntil: "networkidle" });
  const rows = page.getByRole("table").getByRole("row");
  expect(await rows.count()).toBeGreaterThan(50);
  for (const t of [jayton, withGap].filter((t): t is Team => !!t)) {
    const row = rows.filter({ has: page.getByRole("rowheader", { name: new RegExp(`(^|\\s)${t.team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`) }) }).first();
    await expect(row.getByText(text(played(t.team), t.rated), { exact: true }), t.team).toBeVisible();
  }
  // Every row says it, and no team has more rated games than played ones.
  const shown = await page.getByText(/^\d+ played, \d+ rated$/).allInnerTexts();
  expect(shown.length).toBe((await rows.count()) - 1);
  for (const s of shown) {
    const [p, r] = s.match(/\d+/g)!.map(Number);
    expect(r, s).toBeLessThanOrEqual(p);
  }
  // The table's own explanation links to the page that says what rated means.
  await expect(page.getByRole("link", { name: "What a rating rests on" })).toHaveAttribute("href", "/about/ratings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("a past season and a week's rankings show them too, and the week counts through its Sunday", async ({ page }) => {
  await page.goto("/rankings/season/2025", { waitUntil: "networkidle" });
  const season = await page.getByText(/^\d+ played, \d+ rated$/).allInnerTexts();
  expect(season.length).toBeGreaterThan(50);
  const total = async () => {
    const shown = await page.getByText(/^\d+ played, \d+ rated$/).allInnerTexts();
    expect(shown.length).toBeGreaterThan(50);
    let sum = 0;
    for (const s of shown) {
      const [p, r] = s.match(/\d+/g)!.map(Number);
      expect(r, s).toBeLessThanOrEqual(p);
      sum += p;
    }
    return sum;
  };
  await page.goto("/rankings", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /rankings at the end of each week/ }).click(); // the latest week
  await expect(page).toHaveURL(/\/rankings\/week\/\d+$/);
  const latest = await total();
  const weeks = page.getByRole("navigation", { name: "Week" }).getByRole("link", { name: /^After week/ });
  const earliest = (await weeks.first().getAttribute("href"))!;
  expect(earliest).not.toBe(new URL(page.url()).pathname);
  await weeks.first().click(); // the earliest week with ratings: fewer games played by its Sunday
  await expect(page).toHaveURL(new RegExp(`${earliest}$`));
  expect(await total()).toBeLessThan(latest);
  await expect(page.getByRole("link", { name: "What a rating rests on" })).toHaveAttribute("href", "/about/ratings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("a program page says how many games the team played and how many are rated", async ({ page }) => {
  test.setTimeout(180_000); // the first program page compiles in the dev server
  for (const t of [jayton, withGap].filter((t): t is Team => !!t)) {
    await page.goto(`/programs/${slugify(t.team)}`);
    const header = page.locator("article header");
    await expect(header.getByRole("link", { name: text(played(t.team), t.rated) }), t.team).toHaveAttribute("href", "/about/ratings");
    if (t.rated_outside) await expect(header).toContainText(`+ ${t.rated_outside} rated`);
    else await expect(header).not.toContainText("not listed here");
    expect(await page.locator("main").innerText()).not.toMatch(/undefined|NaN|null/);
  }
});

test("/about/ratings says what a rating means, in plain words, and links both ways", async ({ page }) => {
  await page.goto("/about/ratings");
  await expect(page.getByRole("heading", { level: 1, name: "About the ratings" })).toBeVisible();
  const body = await page.locator("main").innerText();
  for (const phrase of [/points better or worse/, /Zero is average/, /neutral field/, /rank range/i, /45 or more/, /at least 45/, /forfeit/i, /left out of the rating/, /unconfirmed/, /never name|no team is named the winner/]) {
    expect(body, String(phrase)).toMatch(phrase);
  }
  for (const heading of ["What the number means", "The ± and the rank range", "Games played and games rated", "The 45-point rule", "Forfeits", "Scores that are not confirmed"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  expect(body).not.toMatch(BETTING);
  expect(body).not.toMatch(SOURCE);
  expect(body).not.toMatch(CODENAME);
  expect(body).not.toMatch(/undefined|NaN|null/);
  await expect(page.getByRole("link", { name: /^How the rankings work/ })).toHaveAttribute("href", "/rankings/how");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.goto("/rankings/how");
  await expect(page.getByRole("link", { name: /^About the ratings/ })).toHaveAttribute("href", "/about/ratings");
});

test("the sitemap lists the page and its description is its own", async ({ page }: { page: Page }) => {
  const xml = await (await page.request.get("/sitemap.xml")).text();
  expect(xml).toContain("/about/ratings</loc>");
  await page.goto("/about/ratings");
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description?.length).toBeLessThanOrEqual(160);
  expect(description).not.toMatch(BETTING);
});
