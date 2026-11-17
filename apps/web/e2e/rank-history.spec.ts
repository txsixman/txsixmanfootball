import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { noLiveScores } from "./live-route";
import { placeRows } from "../lib/rank-range";
import { rankMatrix } from "../lib/rank-history";
import { FEW_GAMES, type RatingsTable } from "../lib/ratings";

// The rankings tell the season's story (ADR 0091): every ranked team says how it moved, the biggest movers are listed, and a
// program's rank and rating by week are drawn with a text alternative. No live-score request reaches the network.
noLiveScores(test);

const table = (season: number): RatingsTable => JSON.parse(readFileSync(path.join(process.cwd(), "../../data/ratings", `${season}.json`), "utf8"));
const BETTING = /\b(odds|spread|lock|bets?|picks?)\b/i;

test("the last week's rank in the history is the rankings table's own rank, for every team of two real seasons", () => {
  for (const season of [2026, 2025]) {
    const real = table(season);
    const weeks = rankMatrix(real, () => true, FEW_GAMES);
    const placed = placeRows(real.teams);
    let compared = 0;
    for (const t of real.teams) {
      expect(weeks.get(t.team)!.at(-1)!.rank ?? undefined, `${season} ${t.team}`).toBe(placed.get(t.team)!.rank);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(200);
  }
});

test("every ranked team says how it moved, in words, and the biggest movers are listed with a word and an icon", async ({ page }) => {
  await page.goto("/rankings");
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll("main table tbody tr")].map((tr) => {
      const cell = tr.querySelector("td")!;
      return { ranked: !/Not ranked/.test(cell.textContent ?? ""), text: (cell.textContent ?? "").trim() };
    }),
  );
  const ranked = marks.filter((m) => m.ranked);
  expect(ranked.length).toBeGreaterThan(20);
  // The rank, then one of: ▲n up n, ▼n down n, a dash (steady), NEW. Never a colour alone: each has its icon or word.
  for (const m of ranked) expect(m.text, m.text).toMatch(/^\d+(▲\d+up \d+ since last week|▼\d+down \d+ since last week|–steady since last week|New in the rankings this week)$/i);
  const moving = ranked.filter((m) => /[▲▼]/.test(m.text)).length;
  const movers = page.getByRole("region", { name: "Biggest movers this week" });
  // The list is there exactly when some ranked team moved.
  expect(await movers.count()).toBe(moving > 0 ? 1 : 0);
  if (moving === 0) return;
  const items = movers.getByRole("listitem");
  expect(await items.count()).toBeLessThanOrEqual(6);
  for (const text of await items.allInnerTexts()) expect(text.replace(/\s+/g, " ")).toMatch(/^(▲ Up|▼ Down) \d+ .+ #\d+, from #\d+ · rating [+−]\d+\.\d$/);
  await expect(movers.getByRole("link").first()).toHaveAttribute("href", /^\/programs\//);
  await expect(movers.getByText(BETTING)).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include("#movers").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("a past season's rankings show no movement marks and no movers list", async ({ page }) => {
  await page.goto("/rankings/season/2025");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText(/since last week/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Biggest movers/ })).toHaveCount(0);
});

test("a program page and a season page chart rank and rating by week, with a text alternative", async ({ page }) => {
  for (const [url, name] of [["/programs/gordon", /^\d{4} rank and rating by week$/], ["/programs/gordon/2025", "2025 rank and rating by week"]] as const) {
    await page.goto(url);
    const section = page.getByRole("region", { name });
    const chart = section.getByRole("img", { name: /^Rank in .+ from #\d+ in the week ending .+ to #\d+ in the week ending .+; best #\d+\. Rating from [+−]?\d+\.\d in the week ending .+ highest [+−]?\d+\.\d\. Zero is an average team\.$/ });
    await expect(chart, url).toBeVisible();
    const rows = section.locator("table tbody tr");
    expect(await rows.count(), url).toBeGreaterThanOrEqual(3);
    for (const text of await rows.allInnerTexts()) expect(text.replace(/\s+/g, " "), url).toMatch(/^[A-Z][a-z]{2} \d+ (#\d+ of \d+|Not ranked) [+−]?\d+\.\d$/);
    await expect(section.getByText(BETTING)).toHaveCount(0);
    // A static drawing: no script and nothing embedded, so nothing can move the page after it loads.
    expect(await chart.locator("script, foreignObject").count()).toBe(0);
  }
});

test("a program's chart ends at the rank its own page shows for the season", async ({ page }) => {
  await page.goto("/programs/gordon");
  const last = (await page.getByRole("region", { name: /^\d{4} rank and rating by week$/ }).locator("table tbody tr").last().innerText()).replace(/\s+/g, " ");
  const rank = /#(\d+) of/.exec(last)?.[1];
  test.skip(!rank, "not ranked in the latest week");
  expect(await page.locator("main").getByText(new RegExp(`#${rank} in `)).count()).toBeGreaterThan(0);
});
