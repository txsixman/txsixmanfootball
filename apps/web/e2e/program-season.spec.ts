import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CURRENT_SEASON, FIRST_SEASON } from "../lib/season";
import { noLiveScores } from "./live-route";

// A program's season (/programs/<slug>/<season>, 2021 on): the record, rank and last playoff round the program page's season
// row shows, and every game of the season oldest first, each linked to its game page. Records come from unconfirmed scores
// (ADR 0013), so no row names a winner (ADR 0004), a forfeit shows the word, and no page names a source.
test.use({ serviceWorkers: "block" });
noLiveScores(test);
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b/i;
const SOURCE = /maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;
const WINNER = /\b(won|beat|defeated|winner|victory)\b/i;
const GAMES = "section[aria-labelledby=games] > ul > li";

async function open(page: Page, path: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(path, { waitUntil: "networkidle" });
  expect(response?.status(), path).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

/** The program page's row for a year of "Season by season". */
const programRow = (page: Page, year: number) =>
  page.getByRole("region", { name: "Season by season" }).getByRole("listitem").filter({ has: page.getByText(String(year), { exact: true }).first() }).first();

for (const year of [2025, CURRENT_SEASON]) {
  test(`jayton ${year}: the heading, record and rank are the program page's own season row, and the row links here`, async ({ page }) => {
    await open(page, "/programs/jayton");
    const row = programRow(page, year);
    const record = (await row.locator("b").first().textContent())!;
    const rank = /#\d+ of \d+ in UIL/.exec((await row.textContent())!)![0];
    const rating = /[+−]\d+\.\d/.exec((await row.textContent())!)![0];
    const playoff = /Playoffs: reached [a-z ]+/.exec((await row.textContent())!)?.[0];
    const games = Number(/games \((\d+)\)/.exec((await row.textContent())!)?.[1] ?? 0);
    await expect(row.getByRole("link", { name: `${year} season page` })).toHaveAttribute("href", `/programs/jayton/${year}`);
    await expect(row.getByRole("link", { name: `${year} rankings` })).toHaveCount(1);

    await open(page, `/programs/jayton/${year}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Jayton ${year}`);
    await expect(page).toHaveTitle(new RegExp(`^Jayton ${year} season \\|`));
    const summary = page.getByRole("region", { name: "Season summary" });
    await expect(summary).toContainText(record);
    await expect(summary).toContainText(rank);
    await expect(summary).toContainText(rating);
    if (playoff) await expect(summary).toContainText(playoff);
    await expect(summary).toContainText("Season scores, not confirmed here.");
    await expect(page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) })).toContainText(/UIL Division (I|II) · Region \d+ · District \d+/);
    // The program page lists the past seasons' games in a details list: the same games, the same count (the current season lists them above).
    const rows = page.locator(GAMES);
    if (games) await expect(rows).toHaveCount(games);
    else expect(await rows.count()).toBeGreaterThan(0);
    // Oldest first.
    const dates = await rows.evaluateAll((lis) => lis.map((li) => li.querySelector<HTMLAnchorElement>("a[href^='/scores/']")!.getAttribute("href")!.match(/\d{4}-\d\d-\d\d/)?.[0] ?? ""));
    expect(dates.filter(Boolean)).toEqual([...dates.filter(Boolean)].sort());
    // Breadcrumbs: Home, Programs, the school, the season.
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link")).toHaveText(["Home", "Programs", "Jayton"]);
    await expect(crumbs.getByRole("link").last()).toHaveAttribute("href", "/programs/jayton");
    await expect(crumbs.locator("[aria-current=page]")).toHaveText(`${year} season`);
  });
}

test("every game row links to its game page, names its round when a playoff game, and names the opponent as a link", async ({ page }) => {
  await open(page, "/programs/jayton/2025");
  const rows = page.locator(GAMES);
  expect(await rows.count()).toBeGreaterThanOrEqual(15);
  const hrefs = await rows.evaluateAll((lis) => lis.map((li) => [...li.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("/scores/"))));
  for (const h of hrefs) expect(h.length).toBe(1);
  expect(new Set(hrefs.flat()).size).toBe(await rows.count());
  // 2025: bi-district, area, regional, semifinal and the state final.
  const playoff = rows.filter({ hasText: /UIL Division II · / });
  await expect(playoff).toHaveCount(5);
  for (const round of [/Bi-District/i, /Area/i, /Regional/i, /Semifinal/i, /State Final|Final/i]) await expect(playoff.filter({ hasText: round }).first()).toBeVisible();
  // vs or at, then the opponent, and a score: the school's own first, never a W or an L.
  await expect(rows.first()).toContainText(/^[A-Z][a-z]{2} \d+\/\d+.*?(vs|at) /);
  await expect(rows.first().getByRole("link", { name: /, game page$/ })).toHaveAttribute("href", /^\/scores\/2025-08-28-/);
  const aria = await rows.first().getByRole("link", { name: /, game page$/ }).getAttribute("aria-label");
  expect(aria).toMatch(/^Thu 8\/28 vs Ira, \d+-\d+, game page$/);
  await expect(page.locator("main")).toContainText("Season scores, not confirmed here.");
  // The game page opens by address: a click before a cold dev page hydrates goes nowhere.
  await page.goto(hrefs[0][0]!);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("an opponent links to its own season page, else its program page; a pair with a series page links to it", async ({ page }) => {
  await open(page, "/programs/jayton/2025");
  const links = page.locator(`${GAMES} a.name-link`);
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThanOrEqual(15);
  for (const h of hrefs) expect(h).toMatch(/^\/programs\/[a-z0-9-]+(\/2025)?$/);
  expect(hrefs.filter((h) => h.endsWith("/2025")).length).toBeGreaterThan(hrefs.length / 2);
  // Ira played Jayton in 2025, so its season page is the opponent link.
  await expect(links.filter({ hasText: /^Ira$/ })).toHaveAttribute("href", "/programs/ira/2025");
  const series = page.locator(`${GAMES} a`).filter({ hasText: /^Series$/ });
  expect(await series.count()).toBeGreaterThan(0);
  await expect(series.first()).toHaveAttribute("href", /^\/series\/[a-z0-9-]+\/[a-z0-9-]+$/);
  const [a, b] = (await series.first().getAttribute("href"))!.split("/").slice(2);
  expect([a, b].sort()).toEqual([a, b]);
  expect([a, b]).toContain("jayton");
  // The opponent's season page opens, with its own heading.
  await page.goto("/programs/ira/2025");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ira 2025");
});

test("every opponent link is a program or season address, whether or not the opponent has a page that year", async ({ page }) => {
  // Calvert's 2021 schedule includes teams that are no program here: they are plain text, so fewer links than rows.
  await open(page, "/programs/calvert/2021");
  const rows = page.locator(GAMES);
  const total = await rows.count();
  const named = await page.locator(`${GAMES} a.name-link`).count();
  expect(named).toBeGreaterThan(0);
  expect(named).toBeLessThanOrEqual(total);
  for (const h of await page.locator(`${GAMES} a.name-link`).evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) expect(h).toMatch(/^\/programs\/[a-z0-9-]+(\/2021)?$/);
});

test("a forfeit shows the word, never 1-0 or 2-0, and counts in the record", async ({ page }) => {
  await open(page, "/programs/calvert/2021"); // two forfeit wins and a forfeit loss on file
  const rows = page.locator(GAMES);
  const forfeits = rows.filter({ hasText: "Forfeit" });
  expect(await forfeits.count()).toBeGreaterThan(0);
  await expect(page.locator("section[aria-labelledby=games]")).not.toContainText(/\b(0-2|2-0|1-0|0-1)\b/);
  for (const label of await forfeits.getByRole("link", { name: /, game page$/ }).evaluateAll((as) => as.map((a) => a.getAttribute("aria-label")!))) expect(label).toMatch(/, Forfeit, game page$/);
  // The record the program page's row shows, forfeits included.
  const record = /\d+-\d+(-\d+)?/.exec((await page.getByRole("region", { name: "Season summary" }).textContent())!)![0];
  await open(page, "/programs/calvert");
  await expect(programRow(page, 2021)).toContainText(record);
});

test("a season with no game on record, a year out of range and a malformed year are all 404", async ({ request }) => {
  for (const path of ["/programs/dell-city/2024", `/programs/jayton/${FIRST_SEASON - 1}`, "/programs/jayton/2099", "/programs/jayton/02025", "/programs/jayton/abc", "/programs/no-such-school/2025"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("the share card is the program's own: no image route of its own, the same card in the preview tags", async ({ page, request }) => {
  await open(page, "/programs/jayton");
  const card = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(card).toMatch(/\/programs\/jayton\/opengraph-image/);
  await open(page, "/programs/jayton/2025");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe(card);
  expect((await request.get("/programs/jayton/2025/opengraph-image")).status()).toBe(404);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://txsixmanfootball.com/programs/jayton/2025");
  const description = (await page.locator('meta[name="description"]').getAttribute("content"))!;
  expect(description.length).toBeLessThanOrEqual(160);
  expect(description).toMatch(/^Jayton 2025 six-man football: \d+-\d+(-\d+)?, \d+(st|nd|rd|th) in UIL\./);
});

test("season navigation: the program's other seasons, the program page and the season's rankings", async ({ page }) => {
  await open(page, "/programs/jayton/2025");
  const nav = page.getByRole("navigation", { name: "Jayton seasons" });
  await expect(nav.getByRole("link").filter({ hasText: /^\d{4}$/ })).toHaveText(Array.from({ length: CURRENT_SEASON - FIRST_SEASON + 1 }, (_, i) => String(CURRENT_SEASON - i)).filter((y) => y !== "2025"));
  await expect(nav.getByRole("link", { name: "2024" })).toHaveAttribute("href", "/programs/jayton/2024");
  await expect(nav.getByRole("link", { name: /^Jayton program page/ })).toHaveAttribute("href", "/programs/jayton");
  await expect(nav.getByRole("link", { name: "2025 UIL rankings" })).toHaveAttribute("href", "/rankings/season/2025");
  // The season under way: its rankings are the bare address.
  await open(page, `/programs/jayton/${CURRENT_SEASON}`);
  await expect(page.getByRole("navigation", { name: "Jayton seasons" }).getByRole("link", { name: `${CURRENT_SEASON} UIL rankings` })).toHaveAttribute("href", "/rankings");
});

test("a TAPPS program's rank is counted among TAPPS teams and says no other organization", async ({ page }) => {
  await open(page, "/programs/abilene-christian-school");
  const row = programRow(page, 2025);
  const rank = /#\d+ of \d+ in TAPPS/.exec((await row.textContent())!)![0];
  await open(page, "/programs/abilene-christian-school/2025");
  const summary = page.getByRole("region", { name: "Season summary" });
  await expect(summary).toContainText(rank);
  await expect(summary).not.toContainText(/UIL|TAIAO|TCAF/);
  await expect(page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) })).toContainText("TAPPS Division I");
  await expect(page.getByRole("navigation", { name: /seasons$/ }).getByRole("link", { name: "2025 TAPPS rankings" })).toHaveAttribute("href", "/rankings/season/2025/tapps");
});

test("no winner, betting or source words on a season page", async ({ page }) => {
  for (const path of ["/programs/jayton/2025", "/programs/calvert/2021", `/programs/jayton/${CURRENT_SEASON}`]) {
    await open(page, path);
    // A school's own name may hold such a word (Victory Christian Academy-Decatur): leave the team names out, longest first.
    const names = [...new Set(await page.locator(`main a.name-link, main h1`).allTextContents())].map((n) => n.trim().replace(/ \d{4}$/, "")).sort((a, b) => b.length - a.length);
    const text = names.reduce((t, n) => t.split(n).join(" "), (await page.locator("main").textContent()) ?? "");
    expect(text, path).not.toMatch(WINNER);
    expect(text, path).not.toMatch(BETTING);
    // The site's own address, in the breadcrumbs' markup, is the one place "sixmanfootball" may appear.
    expect(text.replaceAll("txsixmanfootball.com", ""), path).not.toMatch(SOURCE);
    // No row carries a result letter.
    expect(await page.locator(`${GAMES} :text-is("W"), ${GAMES} :text-is("L")`).count(), path).toBe(0);
  }
});

for (const path of ["/programs/jayton/2025", "/programs/calvert/2021", `/programs/jayton/${CURRENT_SEASON}`]) {
  test(`${path}: axe clean, no sideways scroll, 44px targets`, async ({ page }) => {
    const errors = await open(page, path);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll<HTMLElement>("article a")]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({ what: `${el.textContent!.trim().slice(0, 30)} ${el.getAttribute("href")}`, h: Math.round(el.getBoundingClientRect().height) }))
        .filter((x) => x.h < 44),
    }));
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.small).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("the program page's search entry stays one per program: a season page is not in the site search", async ({ page }) => {
  await open(page, "/programs/jayton");
  await expect(page.locator("[data-pagefind-body]")).toHaveCount(1);
  await open(page, "/programs/jayton/2025");
  await expect(page.locator("[data-pagefind-body]")).toHaveCount(0);
});
