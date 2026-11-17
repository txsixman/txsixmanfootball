import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { ORG_TABS } from "./independent";

// Team scoring leaders (/leaders, ADR 0101): final scores only, one organization at a time, UIL by division, a past
// season at /leaders/<season>. Every expectation follows the page's own data (no team or figure is written in here), so a
// new season or a corrected score never breaks it.
noLiveScores(test); // a program page asks for live scores: none reach the network
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

/** Each list: its heading, and which end of the figures is best. */
const LISTS: { name: RegExp; best: "high" | "low" }[] = [
  { name: /^points per game$/i, best: "high" },
  { name: /^fewest points allowed per game$/i, best: "low" },
  { name: /^average margin$/i, best: "high" },
  { name: /^shutouts$/i, best: "high" },
  { name: /^wins by 45 or more$/i, best: "high" },
  { name: /^60-point games$/i, best: "high" },
  { name: /^most points in one game$/i, best: "high" },
  { name: /^fewest points allowed, season$/i, best: "low" },
];
const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b/i;

/** The same checks as the other specs: status, no console errors, axe, 44px targets, no horizontal overflow. */
async function checkPage(page: Page, url: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response?.status(), url).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.height < 44 || r.width < 44);
    }).map((el) => el.textContent?.trim().slice(0, 40)),
  }));
  expect(m).toEqual({ overflow: 0, short: [] });
  expect(errors).toEqual([]);
}

const list = (page: Page, name: RegExp): Locator => page.getByRole("region", { name });
const POINTS = LISTS[0].name;

/** A list's rows as the page shows them: the place, the figure, and the team link's address. */
async function rows(region: Locator) {
  return region.getByRole("listitem").evaluateAll((items) =>
    items.map((li) => ({
      place: Number(li.querySelector("span")?.textContent),
      figure: Number(/^[-+]?\d+(\.\d+)?/.exec(li.lastElementChild?.textContent?.trim() ?? "")?.[0]), // the figure leads; a screen reader's unit follows it
      text: li.textContent ?? "",
      team: li.querySelector("a[href^='/programs/']")?.getAttribute("href") ?? null,
    })),
  );
}

test("the leaders page passes on phone and desktop, with every list, its rules and the organization switch", async ({ page }) => {
  await checkPage(page, "/leaders");
  await expect(page.getByRole("heading", { level: 1, name: "Scoring leaders" })).toBeVisible();
  await expect(page.getByText(/^\d{4} season · UIL · [\d,]+ games$/i)).toBeVisible();
  for (const { name } of LISTS) await expect(list(page, name), String(name)).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2 })).toHaveCount(LISTS.length);
  await expect(main).toContainText(/from final scores\./);
  await expect(main).toContainText(/(forfeit|disputed final)s? .*left out\.|No forfeit or disputed final to leave out\./);
  await expect(main).toContainText(/A team needs \d+ games to be listed\./);
  await expect(main).toContainText(/points per game understates the best teams/);
  await expect(main).toContainText("Teams only");
  const text = (await main.innerText()).toLowerCase();
  expect(text).not.toMatch(BETTING);
  expect(text).not.toMatch(/maxpreps|hudl|calpreps|sixmanfootball|dave campbell/);
  // The organization switch: UIL first, the others after it, never two in one list (ADR 0012).
  const orgs = page.getByRole("navigation", { name: "Leaders by organization" }).getByRole("link");
  const labels = (await orgs.allInnerTexts()).map((t) => t.trim().toLowerCase());
  expect(labels[0]).toBe("uil");
  expect(labels.every((l) => ORG_TABS.some((t) => t.toLowerCase() === l))).toBe(true);
  await expect(page.getByRole("navigation", { name: "Leaders by organization" }).locator("[aria-current=page]")).toHaveText(/UIL/i);
  const divisions = page.getByRole("navigation", { name: "Leaders by division" }).getByRole("link");
  await expect(divisions).toHaveText([/all uil/i, /division i$/i, /division ii$/i]);
});

test("each list shows at most ten rows, best first, ties sharing a place, every team linked to its program", async ({ page }) => {
  await page.goto("/leaders");
  let teams = 0;
  for (const { name, best } of LISTS) {
    const region = list(page, name);
    const found = await rows(region);
    expect(found.length, `${name} shows at most ten rows`).toBeLessThanOrEqual(10);
    found.forEach((r, i) => {
      if (i > 0) expect(best === "high" ? found[i - 1].figure - r.figure : r.figure - found[i - 1].figure, `${name}, row ${i + 1} is no better than the one before it`).toBeGreaterThanOrEqual(0);
      const first = found.findIndex((o) => o.figure === r.figure);
      expect(r.place, `${name}, row ${i + 1} takes the place of the first row with its figure`).toBe(first + 1);
      if (found.filter((o) => o.figure === r.figure).length > 1) expect(r.text, `${name}, row ${i + 1} says it is tied`).toMatch(/tied/);
      if (r.team) teams += 1;
    });
    // A tie that runs past the tenth row is said, not listed.
    if (found.length === 10) {
      const more = region.getByText(/^and \d+ more (teams|games) tied at \d+$/);
      if (await more.count()) expect((await more.innerText()).match(/at (\d+)$/)![1]).toBe(String(found[9].place));
    }
  }
  expect(teams, "teams link to their programs").toBeGreaterThan(0);
  // A game of the most-points list links to its own page.
  const game = list(page, LISTS[6].name).getByRole("link", { name: /game page$/i }).first();
  await expect(game).toHaveAttribute("href", /^\/scores\//);
});

test("a team's program page repeats its scoring figures and links back to the leaders", async ({ page }) => {
  await page.goto("/leaders");
  const top = (await rows(list(page, POINTS)))[0];
  expect(top?.team, "the top team has a program page").toBeTruthy();
  await page.goto(top.team!);
  const line = page.getByText(/^Scoring: \d+\.\d points per game \((tied )?\d+(st|nd|rd|th) in UIL( Division (I|II))?\), \d+\.\d allowed \((tied )?\d+(st|nd|rd|th)\)\.$/);
  await expect(line).toBeVisible();
  await expect(line).toContainText(`${top.figure.toFixed(1)} points per game`);
  const link = page.getByRole("link", { name: "Scoring leaders", exact: true });
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/leaders(\/division-[12])?$/);
});

test("a past season works: its tab, its own address and its own lists", async ({ page }) => {
  await page.goto("/leaders");
  const seasons = page.getByRole("navigation", { name: "Season", exact: true });
  const past = (await seasons.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))).filter((h) => /^\/leaders\/\d{4}$/.test(h));
  expect(past.length, "at least one past season").toBeGreaterThan(0);
  await seasons.locator(`a[href="${past[0]}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${past[0]}$`));
  const year = past[0].split("/").at(-1)!;
  await checkPage(page, past[0]);
  await expect(page.getByText(new RegExp(`^${year} season · UIL · [\\d,]+ games$`, "i"))).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Season", exact: true }).locator("[aria-current=page]")).toHaveText(year);
  for (const { name } of LISTS) await expect(list(page, name), String(name)).toBeVisible();
  expect((await rows(list(page, POINTS))).length).toBeGreaterThan(0);
  // The organization and division switches keep the season.
  await page.getByRole("navigation", { name: "Leaders by division" }).getByRole("link", { name: /division i$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/leaders/${year}/division-1$`));
  await expect(page.getByText(new RegExp(`^${year} season · UIL Division I · `, "i"))).toBeVisible();
  const other = page.getByRole("navigation", { name: "Leaders by organization" }).getByRole("link", { name: /^tapps$/i });
  if (await other.count()) {
    await other.click();
    await expect(page).toHaveURL(new RegExp(`/leaders/${year}/tapps$`));
    await expect(page.getByRole("navigation", { name: "Leaders by division" })).toHaveCount(0);
  }
  // The latest season is /leaders, never /leaders/<year>.
  expect((await page.goto(`/leaders/${new Date().getFullYear() + 5}`))?.status()).toBe(404);
});

test("another organization is its own page, and Rankings and the footer link to the leaders", async ({ page }) => {
  await page.goto("/leaders");
  const tapps = page.getByRole("navigation", { name: "Leaders by organization" }).getByRole("link", { name: /^tapps$/i });
  if (await tapps.count()) {
    await tapps.click();
    await expect(page).toHaveURL(/\/leaders\/tapps$/);
    await expect(page.getByText(/^\d{4} season · TAPPS · /i)).toBeVisible();
  }
  await page.goto("/rankings");
  const fromRankings = page.getByRole("link", { name: "UIL scoring leaders", exact: true });
  await expect(fromRankings).toHaveAttribute("href", "/leaders");
  expect((await fromRankings.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("navigation", { name: "Site sections" }).getByRole("link", { name: "Leaders", exact: true })).toHaveAttribute("href", "/leaders");
});
