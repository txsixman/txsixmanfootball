import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Round B, the playoff run: a bracket page per division with each game's status, and "Path to the final" on a team's page.
// Scores are the robot's, so unconfirmed: marked, and no row names a winner (ADR 0004). The data changes every week, so
// these check structure (every score marked, every game with a status), not a particular game.

const BRACKETS = [
  { path: "/playoffs/bracket/uil-division-i", title: "UIL Division I", siblings: ["Division I", "Division II"] },
  { path: "/playoffs/bracket/uil-division-ii", title: "UIL Division II", siblings: ["Division I", "Division II"] },
  { path: "/playoffs/bracket/tapps-division-i", title: "TAPPS Division I" },
  { path: "/playoffs/bracket/tcaf", title: "TCAF" },
];
// A game not yet played shows its kickoff status (ADR 0036), worked out in the browser.
const STATUS = /^(Starts \d{1,2}:\d\d [AP]M CT|\d{1,2}:\d\d [AP]M CT|In progress|Time not listed|Score not reported yet|Reported tonight|Score reported|Final|Forfeit)/;
const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
const NAMES_A_WINNER = /\b(won|beat|beats|defeated|wins|winner)\b/i;

async function checkPage(page: Page, url: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  expect((await page.goto(url, { waitUntil: "networkidle" }))?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, // the whole page never scrolls sideways
    short: [...document.querySelectorAll("main a, main button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44;
    }).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0 });
  expect(errors).toEqual([]);
}

for (const b of BRACKETS) {
  test(`${b.title}: its own bracket page, every game with a status, every score marked unconfirmed, no winner named`, async ({ page }) => {
    await checkPage(page, b.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(b.title);
    await expect(page.getByText(/^Scores as of \w{3}, \w{3} \d+, \d+:\d\d (AM|PM) CT$/)).toBeVisible();
    if (b.siblings) {
      const tabs = page.getByRole("navigation", { name: `${b.title.split(" ")[0]} brackets` });
      await expect(tabs.getByRole("link")).toHaveText(b.siblings);
      await expect(tabs.getByRole("link", { name: b.title.replace("UIL ", ""), exact: true })).toHaveAttribute("aria-current", "page");
    }

    // The round in play comes first, and is the one marked in the jump bar.
    const rounds = page.locator("section[aria-label]");
    await expect(rounds.first().getByRole("heading", { level: 2 })).toContainText("current round");
    const jump = page.getByRole("navigation", { name: `${b.title} rounds` });
    if (await jump.count()) {
      const current = jump.locator("[aria-current=location]");
      await expect(current).toHaveCount(1);
      expect(await rounds.first().getByRole("heading", { level: 2 }).textContent()).toContain(((await current.textContent()) ?? "").trim());
      for (const href of await jump.getByRole("link").evaluateAll((els) => els.map((a) => a.getAttribute("href")!))) await expect(page.locator(href)).toHaveCount(1);
    }

    const games = rounds.getByRole("listitem");
    const count = await games.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const row = games.nth(i);
      const text = ((await row.textContent()) ?? "").replace(/\s+/g, " ");
      expect(text, text).toMatch(/(Starts \d|In progress|Time not listed|Score not reported yet|Reported tonight|Score reported|Final|Forfeit)/i);
      // A game with a score (digits right after a team) says Unconfirmed; one with none or a forfeit does not claim a score.
      const scored = await row.locator("span.font-num.tabular-nums").evaluateAll((els) => els.some((e) => /\d/.test(e.textContent ?? "")));
      if (scored) expect(text, text).toContain("Unconfirmed");
      expect(text, text).not.toMatch(NAMES_A_WINNER);
    }
    // The status words are the ones the page promises, and nothing reads as betting.
    for (const s of await page.locator("section[aria-label] li p > span.flex > span:first-child").allTextContents()) expect(s).toMatch(STATUS);
    await expect(page.locator("main")).not.toContainText(BETTING);
  });
}

test("a bracket game not yet played shows its projected margin and win probability; the next pairing too, where it is known", async ({ page }) => {
  await page.goto("/playoffs/bracket/tapps-division-i");
  const projected = page.getByText(/^Projected: .+ by (\d+|45\+) · (>99|<1|\d+)% win probability$/);
  expect(await projected.count()).toBeGreaterThan(0);
  // "Likely next pairings" shows while two semifinals (or a region's two area games) are still to play.
  if (await page.locator("#pairings").count()) {
    const pairing = page.locator("#pairings ~ ul li").first();
    await expect(pairing).toContainText(/ vs /);
    await expect(pairing).toContainText(/Projected: .+ by (\d+|45\+) · (>99|<1|\d+)% win probability/);
  }
});

test("the league page links each bracket to its own page, and a past season's page does not", async ({ page }) => {
  await page.goto("/playoffs");
  for (const name of ["UIL Division I", "UIL Division II"]) {
    await expect(page.getByRole("region", { name, exact: true }).getByRole("link", { name: /bracket page: current round first/ })).toHaveAttribute(
      "href",
      name === "UIL Division I" ? "/playoffs/bracket/uil-division-i" : "/playoffs/bracket/uil-division-ii",
    );
  }
  await page.goto("/playoffs/season/2025");
  await expect(page.getByRole("link", { name: /bracket page/ })).toHaveCount(0);
  expect((await page.goto("/playoffs/bracket/no-such-bracket"))?.status()).toBe(404);
});

test("a playoff team's page has its path to the final: games played with unconfirmed scores, games ahead with projections", async ({ page }) => {
  await page.goto("/playoffs/bracket/tapps-division-i", { waitUntil: "networkidle" });
  const first = page.locator("section[aria-label]").first().getByRole("listitem").first();
  const team = await first.getByRole("link").first().getAttribute("href");
  expect(team).toMatch(/^\/programs\//);
  await checkPage(page, team!);
  const path = page.getByRole("region", { name: "Path to the final" });
  await expect(path).toBeVisible();
  await expect(path.getByRole("link", { name: "TAPPS Division I bracket" })).toHaveAttribute("href", "/playoffs/bracket/tapps-division-i");
  expect(await path.getByRole("listitem").count()).toBeGreaterThan(0);
  const text = (await path.textContent()) ?? "";
  expect(text).toMatch(/^Path to the final/);
  expect(text).toMatch(/Starts \d|In progress|Time not listed|Score not reported yet|Reported tonight|Score reported|Final|Forfeit/i); // each game carries a status
  if (/\d+-\d+/.test(text)) expect(text).toContain("Unconfirmed");
  expect(text).not.toMatch(NAMES_A_WINNER);
  expect(text).not.toMatch(BETTING);
  // Where the next pairing is known, the likely opponent and its projection show.
  if (text.includes("If it advances")) {
    expect(text).toMatch(/Likely opponent: .+ \((>99|<1|\d+)% to get there\)/);
    expect(text).toMatch(/Projected: .+ by (\d+|45\+) · (>99|<1|\d+)% win probability/);
  }
});

test("a team in no bracket has no path section", async ({ page }) => {
  await page.goto("/programs/booker");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Booker");
  await expect(page.getByRole("region", { name: "Path to the final" })).toHaveCount(0);
});

test("a forfeit shows the word and no score on a bracket row", async ({ page }) => {
  for (const b of ["taiao-division-3", "tapps-division-iii-large-school", "uil-division-i"]) {
    await page.goto(`/playoffs/bracket/${b}`);
    for (const row of await page.locator("section[aria-label] li").all()) {
      if (/Forfeit/.test((await row.textContent()) ?? "")) expect((await row.locator("span.font-num.tabular-nums").allTextContents()).join("")).toBe("");
    }
  }
});
