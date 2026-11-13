import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { noLiveScores } from "./live-route";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// Playoffs this round (app/playoffs/this-round): every bracket's current round on one page, organization then division,
// built only from the brackets. The data changes every week, so these check structure, not a particular game.

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
const NAMES_A_WINNER = /\b(won|beat|beats|defeated|wins|winner)\b/i;

test("this round: every bracket's current round, a status for every game, no winner named, linked from home and the playoffs page", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  expect((await page.goto("/playoffs/this-round", { waitUntil: "networkidle" }))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Playoffs this round");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44;
    }).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0 });

  // Organizations in tab order, each with at least one division.
  const orgs = await page.locator("main h2").allTextContents();
  expect(orgs.length).toBeGreaterThan(0);
  expect(orgs).toEqual(["UIL", "TAPPS", "TAIAO", "TCAF"].filter((l) => orgs.includes(l)));

  // Each division's round is the one its own bracket page opens on (marked aria-current there).
  const divisions = page.locator("main section[aria-label]");
  const count = await divisions.count();
  expect(count).toBeGreaterThan(0);
  const checks: { href: string; round: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = divisions.nth(i);
    const label = (await d.getAttribute("aria-label"))!;
    const href = (await d.getByRole("link", { name: /^Full .* bracket$/ }).getAttribute("href"))!;
    checks.push({ href, round: label.slice(label.lastIndexOf(", ") + 2) });
    // Every game has a status line, and every reported score is marked.
    const games = d.locator("li");
    for (let j = 0; j < (await games.count()); j++) {
      const text = (await games.nth(j).innerText()).replace(/\s+/g, " ");
      expect(text).toMatch(/(Not yet played|Tonight, no score yet|Score not reported yet|Reported tonight|Score reported|Final|Forfeit)/);
      if (/Reported tonight|Score reported/.test(text)) expect(text).toContain("Unconfirmed");
    }
  }
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(BETTING);
  expect(body).not.toMatch(NAMES_A_WINNER);
  expect(errors).toEqual([]);

  for (const { href, round } of checks) {
    await page.goto(href);
    // A one-round bracket has no round list to mark.
    if (await page.locator('nav[aria-label$="rounds"] a').count()) await expect(page.locator("nav a[aria-current=location]"), href).toHaveText(round);
  }

  // Home links here while a game is still to play (the playoffs page always does).
  const toPlay = /Not yet played|Tonight, no score yet/.test(body);
  await page.goto("/");
  if (toPlay) await expect(page.locator("main").getByRole("link", { name: /this round/i }).first()).toHaveAttribute("href", "/playoffs/this-round");
  await page.goto("/playoffs");
  await expect(page.getByRole("link", { name: "This round in every bracket" })).toHaveAttribute("href", "/playoffs/this-round");
});
