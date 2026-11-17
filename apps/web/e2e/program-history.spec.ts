import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { EMBED_HEIGHT } from "../lib/embed-html";
import { CURRENT_SEASON, FIRST_SEASON } from "../lib/season";
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

/** Seasons of games a program has in the robot-read files, and how many games: the little-data tests follow the data (a program that gains games leaves them). */
const SEED = path.join(__dirname, "../../../data/seed");
function gamesOf(school: string) {
  const bySeason = readdirSync(SEED)
    .filter((d) => /^maxpreps-\d{4}$/.test(d))
    .map((d) => [Number(d.slice(-4)), readFileSync(path.join(SEED, d, "games.csv"), "utf8").split("\n").filter((l) => l.includes(`,${school},`)).length] as const)
    .filter(([, n]) => n > 0);
  return { seasons: bySeason.length, games: bySeason.reduce((n, [, g]) => n + g, 0), latest: bySeason.map(([y]) => y).sort().at(-1) };
}
const CHANT = "Christian Homeschool Athletes of North Texas (CHANT)";
const COVENANT = "The Covenant Preparatory School";

const seasons = (page: Page) => page.getByRole("region", { name: "Season by season" });
const season = (page: Page, year: number) => seasons(page).getByRole("listitem").filter({ has: page.getByText(String(year), { exact: true }).first() }).first();

test(`every season ${FIRST_SEASON} to ${CURRENT_SEASON} has a row: record, place, final rating and the last playoff round played`, async ({ page }) => {
  await open(page, "jayton");
  const items = seasons(page).getByRole("listitem");
  await expect(items).toHaveCount(CURRENT_SEASON - FIRST_SEASON + 1);
  for (const year of [2025, 2024, 2023, 2022, 2021]) {
    const row = season(page, year);
    await expect(row).toContainText(/\d+-\d+(-\d+)?/);
    await expect(row).toContainText(/#\d+ of \d+ in UIL/);
    await expect(row).toContainText(/[+−]\d+\.\d\s*rating/);
  }
  // How far it went says which round it played, never whether it won.
  await expect(season(page, 2024)).toContainText("Playoffs: reached the State Championship");
  await expect(season(page, 2022)).toContainText(/Playoffs: reached the area round/);
  await expect(season(page, 2021)).toContainText("Playoffs: reached the regional round");
  await expect(seasons(page).getByText(new RegExp(`^\\d+-\\d+(-\\d+)? from ${FIRST_SEASON} to ${CURRENT_SEASON} · playoffs in \\d of ${CURRENT_SEASON - FIRST_SEASON + 1} seasons$`))).toBeVisible();
  // The season's rankings are one link in each row.
  await expect(season(page, 2023).getByRole("link", { name: "2023 rankings" })).toHaveAttribute("href", "/rankings/season/2023");
});

// ADR 0089: all-time numbers, records, and State Championships on the season rows. Jayton's UIL finals are in UIL's own list (1984 and
// 1985 titles, 1989 and 2006 runner-up, 2024 and 2025 titles); Bracken Christian's are the private leagues' recorded finals (the 2018 title,
// the 2021 and 2022 runner-up finishes).
test("all-time numbers: the record, playoff seasons and games, and State Championship titles from every league's list", async ({ page }) => {
  await open(page, "jayton");
  const all = page.getByRole("region", { name: "All-time" });
  const value = (label: string) => all.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
  await expect(value(`Record since ${FIRST_SEASON}`)).toHaveText(/^\d+-\d+(-\d+)?$/);
  await expect(all.locator("dt", { hasText: `Record since ${FIRST_SEASON}` }).locator("xpath=following-sibling::dd[2]")).toHaveText(/^\d+% of \d+ games won$/);
  await expect(value("Playoff seasons")).toHaveText(/^\d+$/);
  await expect(value("Playoff games")).toHaveText(/^\d+-\d+(-\d+)?$/);
  expect(Number(await value("State titles").textContent())).toBeGreaterThanOrEqual(4);
  await expect(all.locator("dt", { hasText: "State titles" }).locator("xpath=following-sibling::dd[2]")).toHaveText(/^in \d+ State Championship games$/);
  // The one sentence under the figures says what counts; nothing in it names a source.
  await expect(all).toContainText("State Championship games count UIL’s since 1972 and the private leagues’ since 2018");
  expect(await all.innerText()).not.toMatch(SOURCE);
});

test("records: the best season, the biggest win and loss and the longest winning streak, each linked to its page", async ({ page }) => {
  await open(page, "jayton");
  const records = page.getByRole("region", { name: "Records" });
  const best = records.getByRole("link", { name: /^20\d\d season, \d+-\d+(-\d+)?, season page$/ });
  await expect(best).toHaveAttribute("href", /^\/programs\/jayton\/20\d\d$/);
  // A completed season: the one under way is never the best.
  await expect(best).not.toHaveAttribute("href", `/programs/jayton/${CURRENT_SEASON}`);
  for (const label of ["Biggest win", "Biggest loss"]) {
    const row = records.getByRole("listitem").filter({ hasText: label });
    await expect(row).toHaveCount(1);
    const link = row.getByRole("link", { name: /game page$/ });
    await expect(link).toHaveAttribute("href", /^\/scores\//);
    await expect(link).toHaveText(/^\d+-\d+$/);
  }
  // The win is a win and the loss a loss.
  const score = async (label: string) => (await records.getByRole("listitem").filter({ hasText: label }).getByRole("link", { name: /game page$/ }).textContent())!.split("-").map(Number);
  const [wu, wt] = await score("Biggest win");
  const [lu, lt] = await score("Biggest loss");
  expect(wu).toBeGreaterThan(wt);
  expect(lu).toBeLessThan(lt);
  const streak = records.getByRole("listitem").filter({ hasText: "Win streak" });
  await expect(streak).toContainText("Wins in a row");
  expect(Number(await streak.locator("span").last().textContent())).toBeGreaterThanOrEqual(2);
  await expect(records).toContainText("A forfeit counts as a win or a loss in a streak but has no margin");
  expect(await records.innerText()).not.toMatch(BETTING);
});

test("season rows say which State Championships were played and won, the playoff record, and this season's district place", async ({ page }) => {
  await open(page, "jayton");
  for (const year of [2024, 2025]) {
    const link = season(page, year).getByRole("link", { name: "State Champion", exact: true });
    await expect(link).toHaveAttribute("href", `/championships/${year}`);
    expect(await link.evaluate((a) => a.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(season(page, year)).toContainText(/Playoffs: reached the State Championship, won \d+, lost \d+(, tied \d+)? in playoff games/);
  }
  // A season that went no further than the area round has no State Championship line.
  await expect(season(page, 2022).getByRole("link", { name: /^State Champ/ })).toHaveCount(0);
  await expect(season(page, 2022)).toContainText(/Playoffs: reached the area round, won \d+, lost \d+(, tied \d+)? in playoff games/);
  // The season under way shows its district place, linked to the district's page; a past season never does (its districts are not today's).
  const district = season(page, CURRENT_SEASON).getByRole("link", { name: /^\d+(st|nd|rd|th) of \d+ in district, \d+-\d+(-\d+)?$/ });
  await expect(district).toHaveAttribute("href", /^\/standings\/district\//);
  await expect(season(page, 2025).getByRole("link", { name: /in district/ })).toHaveCount(0);
});

test("a private school's State Championships count in its all-time numbers and mark their seasons", async ({ page }) => {
  await open(page, "bracken-christian-school-bulverde");
  const all = page.getByRole("region", { name: "All-time" });
  await expect(all.locator("dt", { hasText: "State titles" }).locator("xpath=following-sibling::dd[1]")).toHaveText("1");
  await expect(all).toContainText("in 3 State Championship games");
  await expect(season(page, 2018).getByRole("link", { name: "State Champion", exact: true })).toHaveAttribute("href", "/championships/2018");
  for (const year of [2021, 2022]) await expect(season(page, year).getByRole("link", { name: "State Championship runner-up" })).toHaveAttribute("href", `/championships/${year}`);
  // The same finals, listed in their own section.
  await expect(page.getByRole("region", { name: "Private league State Championships" })).toContainText("1 private league state title, 2 runner-up finishes");
});

for (const [name, school] of [["CHANT", CHANT], ["Covenant Prep", COVENANT]] as const) {
  test(`${name}: with little on record the page says so, lists only the seasons it has and shows no all-time numbers or records`, async ({ page }, info) => {
    const have = gamesOf(school);
    test.skip(have.games >= 5 || have.games === 0, "follows the data: the page has enough games, or none, for this case");
    const errors = await open(page, school === CHANT ? "christian-homeschool-athletes-of-north-texas-chant" : "the-covenant-preparatory-school");
    await expect(page.getByRole("region", { name: "All-time" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Records" })).toHaveCount(0);
    const section = seasons(page);
    await expect(section).toContainText(new RegExp(`Only ${have.games} games? (is|are) on record so far`));
    // One row a season it has, and one line for the rest: no row of dashes each.
    await expect(section.getByRole("listitem")).toHaveCount(have.seasons);
    await expect(section).toContainText(/No games on record for /);
    await expect(page.locator("main")).not.toContainText(/undefined|NaN/);
    // No game is listed ahead, so the next-game box says so instead of leaving one box alone.
    await expect(page.getByRole("region", { name: "Next and latest game" })).toContainText("No game is listed ahead");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))).toBeLessThanOrEqual(0);
    expect(errors, info.project.name).toEqual([]);
  });
}

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
  const chart = seasons(page).getByRole("img", { name: new RegExp(`^Final rating of each season, from .+ in ${FIRST_SEASON} to .+ in ${CURRENT_SEASON}; highest .+\\. \\d seasons have no rating\\. Zero is an average team\\.$`) });
  await expect(chart).toBeVisible();
  const table = seasons(page).getByRole("table", { name: "Final rating by season" });
  await expect(table.getByRole("row")).toHaveCount(CURRENT_SEASON - FIRST_SEASON + 2); // a header and one row a season
  // Seasons either side of a gap are dots without a line: one dot a rated season, none for a season with no rating.
  const rated = (await table.getByRole("row").filter({ hasNotText: "No rating" }).count()) - 1;
  expect(await chart.locator("circle").count()).toBe(rated);
  await expect(table.getByRole("row", { name: /^2024 No rating$/ })).toHaveCount(1);
});

test("the rating line is an image with words and numbers for a screen reader, drawn without a chart library", async ({ page }) => {
  await open(page, "jayton");
  const chart = seasons(page).getByRole("img", { name: new RegExp(`^Final rating of each season, from [+−]\\d+\\.\\d in ${FIRST_SEASON} to [+−]\\d+\\.\\d in ${CURRENT_SEASON}; highest [+−]\\d+\\.\\d in 20\\d\\d\\. Zero is an average team\\.$`) });
  await expect(chart).toBeVisible();
  await expect(chart.locator("polyline")).toHaveCount(1);
  await expect(chart.locator("circle")).toHaveCount(CURRENT_SEASON - FIRST_SEASON + 1);
  await expect(seasons(page).locator("figure figcaption").first()).toContainText("Zero is an average team.");
  const rows = seasons(page).getByRole("table", { name: "Final rating by season" }).getByRole("row");
  await expect(rows).toHaveCount(CURRENT_SEASON - FIRST_SEASON + 2);
  await expect(rows.nth(1)).toContainText(new RegExp(`^${FIRST_SEASON}[+−]\\d+\\.\\d$`));
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
  await expect(section).not.toContainText("not confirmed");
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
  // 2024: bi-district, area, regional, semifinal and the State Championship.
  const playoff = games.filter({ hasText: /UIL Division II · /i });
  await expect(playoff).toHaveCount(5);
  for (const round of [/Bi-District/i, /Area/i, /Regional/i, /Semifinal/i, /State Championship/i]) await expect(playoff.filter({ hasText: round }).first()).toBeVisible();
  const hrefs = await playoff.evaluateAll((lis) => lis.map((li) => [...li.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("/scores/"))));
  for (const h of hrefs) expect(h.length).toBe(1);
  expect(new Set(hrefs.flat()).size).toBe(5);
  // The page of each is its game page.
  const link = playoff.first().getByRole("link", { name: /game page$/ });
  await expect(link).toHaveAttribute("href", /^\/scores\/2024-11-14-/);
  // Rows write no winner word, and no "not confirmed" note is left (a final is confirmed, ADR 0040).
  await expect(row.locator("details")).not.toContainText(WINNER);
  await expect(row.locator("details")).not.toContainText("not confirmed");
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
  // The site's own address, in the "Put this on your site" snippet, is the one place "sixmanfootball" may appear.
  expect(((await page.locator("main").textContent()) ?? "").replaceAll("txsixmanfootball.com", "")).not.toMatch(SOURCE);
});

for (const slug of ["jayton", "dell-city", "calvert", "bracken-christian-school-bulverde"]) {
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

test("\"Put this on your site\" holds the iframe and a plain link to the program page as text to copy, and no iframe is on the page", async ({ page }) => {
  await open(page, "jayton");
  const block = page.locator("details").filter({ has: page.getByText("Put this on your site", { exact: true }) });
  await expect(block).toHaveCount(1);
  await expect(block.locator("details, summary")).toHaveCount(1); // only its own summary
  await block.getByText("Put this on your site", { exact: true }).click();
  await expect(block.locator("pre code")).toHaveText(
    `<iframe src="https://txsixmanfootball.com/embed/programs/jayton" title="Jayton scores" width="100%" height="${EMBED_HEIGHT}" style="border:0" loading="lazy"></iframe>\n` +
      `<p><a href="https://txsixmanfootball.com/programs/jayton">Jayton football scores and schedule</a></p>`,
  );
  await expect(block).toContainText("?theme=dark");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(block.locator("pre code *")).toHaveCount(0); // text, not elements
});
