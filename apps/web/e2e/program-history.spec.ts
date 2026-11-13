import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { noLiveScores } from "./live-route";

// A program's history, 2021 on: every season in one table (dashes where the data has nothing), a rating line, the record
// against every opponent, and each past game with its round, linked to its game page. Records come from unconfirmed
// scores (ADR 0013), so no game row names a winner (ADR 0004), a forfeit shows the word, and no page names a source.
test.use({ serviceWorkers: "block" });
noLiveScores(test);

const SHOTS = process.env.SHOTS_DIR;
const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b/i;
const SOURCE = /maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;
const HISTORY = "section[aria-labelledby=seasons], section[aria-labelledby=rivals]";
const WINNER = /\b(won|beat|defeated|winner)\b/i;

async function open(page: Page, slug: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(`/programs/${slug}`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

const seasons = (page: Page) => page.getByRole("region", { name: "Season by season" });
const season = (page: Page, year: number) => seasons(page).getByRole("listitem").filter({ has: page.getByText(String(year), { exact: true }).first() }).first();

test("every season 2021 to 2026 has a row: record, place, final rating and the last playoff round played", async ({ page }) => {
  await open(page, "jayton");
  const items = seasons(page).getByRole("listitem");
  await expect(items).toHaveCount(6);
  for (const year of [2025, 2024, 2023, 2022, 2021]) {
    const row = season(page, year);
    await expect(row).toContainText(/\d+-\d+(-\d+)?/);
    await expect(row).toContainText(/#\d+ of \d+ in UIL/);
    await expect(row).toContainText(/[+−]\d+\.\d\s*rating/);
  }
  // How far it went says which round it played, never whether it won.
  await expect(season(page, 2024)).toContainText("Playoffs: reached the state final");
  await expect(season(page, 2022)).toContainText(/Playoffs: reached the area round/);
  await expect(season(page, 2021)).toContainText("Playoffs: reached the regional round");
  await expect(seasons(page).getByText(/^\d+-\d+(-\d+)? from 2021 to 2026 · playoffs in \d of 6 seasons$/)).toBeVisible();
  // The season's rankings are one link in each row.
  await expect(season(page, 2023).getByRole("link", { name: "2023 rankings" })).toHaveAttribute("href", "/rankings/season/2023");
});

test("a season with no games and no rating shows a dash, not a guess, and the rating line breaks there", async ({ page }) => {
  await open(page, "dell-city"); // no 2023, 2024 or 2025 games read
  const gone = season(page, 2024);
  await expect(gone).toContainText("No games on record");
  await expect(gone.getByText("—")).toHaveCount(2); // record and rating
  await expect(gone).not.toContainText(/#\d+ of/);
  await expect(gone).not.toContainText(/Playoffs/);
  await expect(gone.getByRole("link")).toHaveCount(1); // only its rankings link; no games to open
  await expect(gone.locator("details")).toHaveCount(0);
  await expect(season(page, 2022)).toContainText(/#\d+ of \d+ in UIL|Not ranked/);
  const chart = seasons(page).getByRole("img", { name: /^Final rating of each season, from .+ in 2021 to .+ in 2026; highest .+\. \d seasons have no rating\. Zero is an average team\.$/ });
  await expect(chart).toBeVisible();
  // Two seasons either side of the gap are dots without a line; no season is drawn as a rating it never had.
  expect(await chart.locator("circle").count()).toBe(3);
  const table = seasons(page).getByRole("table", { name: "Final rating by season" });
  await expect(table.getByRole("row")).toHaveCount(7);
  await expect(table.getByRole("row", { name: /^2024 No rating$/ })).toHaveCount(1);
});

test("the rating line is an image with words and numbers for a screen reader, drawn without a chart library", async ({ page }) => {
  await open(page, "jayton");
  const chart = seasons(page).getByRole("img", { name: /^Final rating of each season, from [+−]\d+\.\d in 2021 to [+−]\d+\.\d in 2026; highest [+−]\d+\.\d in 20\d\d\. Zero is an average team\.$/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator("polyline")).toHaveCount(1);
  await expect(chart.locator("circle")).toHaveCount(6);
  await expect(seasons(page).locator("figure figcaption").first()).toContainText("Zero is an average team.");
  const rows = seasons(page).getByRole("table", { name: "Final rating by season" }).getByRole("row");
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(1)).toContainText(/^2021[+−]\d+\.\d$/);
  // Labels are readable at the size the drawing is shown.
  const sizes = await chart.evaluate((svg: SVGSVGElement) => {
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    return [...svg.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize) * scale);
  });
  expect(sizes.length).toBeGreaterThanOrEqual(8);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(13);
  // The line is drawn in the site's navy through the page's own style, not left to the browser's default black.
  expect(await chart.locator("polyline").evaluate((el) => getComputedStyle(el).stroke)).toBe("rgb(10, 42, 94)");
});

test("every opponent since 2021 is listed with its record; the most played lead and the rest sit in a details list", async ({ page }) => {
  await open(page, "jayton");
  const section = page.getByRole("region", { name: "Most played" });
  const top = section.locator(":scope > ul > li");
  expect(await top.count()).toBeGreaterThan(0);
  expect(await top.count()).toBeLessThanOrEqual(6);
  await expect(top.first()).toContainText(/\d+ games · last 20\d\d, \d+-\d+/);
  await expect(section).toContainText("A forfeit counts as a win or a loss");
  await expect(section).toContainText("scores not confirmed here");
  const summary = section.locator("details > summary");
  await expect(summary).toHaveText(/^All opponents \(\d+\)$/);
  const total = Number((await summary.textContent())!.match(/\((\d+)\)/)![1]);
  const all = section.locator("details li");
  await expect(all.first()).toBeHidden(); // closed until opened: no script involved
  await summary.click();
  await expect(all).toHaveCount(total);
  expect(total).toBeGreaterThan(await top.count());
  // Name, games and record in each row; a program we list is a link, and the record adds up to the games.
  const first = all.first();
  await expect(first).toContainText(/\d+ games? · last 20\d\d\d+-\d+/);
  const sums = await all.evaluateAll((lis) =>
    lis.map((li) => {
      const games = Number(li.querySelector("small")!.textContent!.match(/^(\d+) game/)![1]);
      const parts = li.querySelector("b")!.textContent!.split("-").map(Number);
      return games - parts.reduce((a, b) => a + b, 0);
    }),
  );
  expect(sums.every((d) => d === 0)).toBe(true);
  const links = all.getByRole("link");
  expect(await links.count()).toBeGreaterThan(total / 2);
  await expect(links.first()).toHaveAttribute("href", /^\/programs\/[a-z0-9-]+$/);
  // The 36 games of a six-season history match the table: games against Roby, for one, sum the same way on both lists.
  await expect(all.filter({ hasText: /^Roby/ })).toHaveCount(1);
});

test("a forfeit shows the word and counts in the record; no score is shown for it", async ({ page }) => {
  await open(page, "calvert"); // forfeits in 2021: 0-2 and 2-0 records
  const row = season(page, 2021);
  await row.locator("summary").click();
  const forfeits = row.getByRole("listitem").filter({ hasText: "Forfeit" });
  expect(await forfeits.count()).toBeGreaterThan(0);
  await expect(row.locator("details")).not.toContainText(/\b(0-2|2-0|1-0|0-1)\b/);
  // Opponent records count a forfeit as a result, and the latest meeting shows the word.
  await page.getByRole("region", { name: /Most played|Opponents/ }).locator("summary").click();
  await expect(page.getByRole("region", { name: /Most played|Opponents/ })).not.toContainText(/\b(0-2|2-0)\b/);
});

test("every past playoff game names its round and links to its game page; no game row names a winner or a source", async ({ page }) => {
  await open(page, "jayton");
  const row = season(page, 2024);
  await row.locator("summary").click();
  const games = row.locator("details li");
  expect(await games.count()).toBeGreaterThanOrEqual(15);
  // 2024: bi-district, area, regional, semifinal and the state final.
  const playoff = games.filter({ hasText: /UIL Division II · /i });
  await expect(playoff).toHaveCount(5);
  for (const round of [/Bi-District/i, /Area/i, /Regional/i, /Semifinal/i, /State Final|Final/i]) await expect(playoff.filter({ hasText: round }).first()).toBeVisible();
  const hrefs = await playoff.evaluateAll((lis) => lis.map((li) => [...li.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("/scores/"))));
  for (const h of hrefs) expect(h.length).toBe(1);
  expect(new Set(hrefs.flat()).size).toBe(5);
  // The page of each is its game page.
  const link = playoff.first().getByRole("link", { name: /game page$/ });
  await expect(link).toHaveAttribute("href", /^\/scores\/2024-11-14-/);
  // Rows name no winner, and "Season scores, not confirmed here" is said.
  await expect(row.locator("details")).not.toContainText(WINNER);
  await expect(row.locator("details")).toContainText("Season scores, not confirmed here.");
  await page.goto((await link.getAttribute("href"))!); // opened by address: a click before a cold dev page hydrates goes nowhere
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("no betting or source words in the history", async ({ page }) => {
  await open(page, "jayton");
  const history = page.locator(HISTORY);
  await expect(history).toHaveCount(2);
  for (const section of await history.all()) {
    const text = (await section.textContent())!;
    expect(text).not.toMatch(BETTING);
    expect(text).not.toMatch(SOURCE);
  }
  await expect(page.locator("main")).not.toContainText(SOURCE);
});

for (const slug of ["jayton", "dell-city", "calvert"]) {
  test(`${slug}: axe clean, no sideways scroll, 44px targets in the history`, async ({ page }, info) => {
    const errors = await open(page, slug);
    // Open every details so what is inside is checked too.
    for (const d of await page.locator("main details").all()) await d.locator("summary").first().click();
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.locator("section[aria-labelledby=seasons]").screenshot({ path: path.join(SHOTS, `history-${slug}-seasons-${info.project.name}.png`) });
      await page.locator("section[aria-labelledby=rivals]").screenshot({ path: path.join(SHOTS, `history-${slug}-opponents-${info.project.name}.png`) });
    }
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    const m = await page.evaluate(() => {
      const section = [...document.querySelectorAll('section[aria-labelledby=seasons], section[aria-labelledby=rivals]')];
      const small = section.flatMap((s) =>
        [...s.querySelectorAll<HTMLElement>("a, summary")]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => ({ what: `${el.tagName} ${el.textContent!.trim().slice(0, 30)}`, h: Math.round(el.getBoundingClientRect().height) }))
          .filter((x) => x.h < 44),
      );
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
    });
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.small).toEqual([]);
    expect(errors).toEqual([]);
  });
}
