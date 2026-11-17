import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { bracketHref, loadBrackets } from "../lib/brackets";
import { centralClock, currentRound } from "../lib/playoff-status";
import { slugify } from "../lib/slug";
import { noLiveScores } from "./live-route";

// Brackets on a phone during the playoffs (ADR 0094): the rounds as ARIA tabs with the current one open, each game a card, "Who's
// left" with each team's next game, a team's road, and the current round named on the playoffs pages of every league. The data
// changes every week, so what to expect comes from the same data the pages are built from.
noLiveScores(test);

/** The loaders read ../../data from the working directory; the tests run from the repo root (as bracket-tree.spec.ts does). */
async function brackets() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await loadBrackets();
  } finally {
    process.chdir(was);
  }
}

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
const rounds = (page: Page) => page.locator("[data-rounds]");
const open = (page: Page) => rounds(page).getByRole("tabpanel");

/** Nothing sideways, every link and button 44 by 44, axe clean (the rules the other page tests run). */
async function noProblems(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button, main summary")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44);
    }).map((el) => el.outerHTML.slice(0, 80)),
  }));
  expect(m).toEqual({ overflow: 0, short: [] });
}

/** A bracket that is a tree with a game still to play, so every part has something to show. */
async function pick() {
  const all = await brackets();
  return all.find((b) => b.name === "UIL Division I") ?? all[0];
}

test.describe("round tabs", () => {
  test("a tablist with one tab a round, one panel open, the current round first, and a panel for each tab", async ({ page }) => {
    const b = await pick();
    await page.goto(bracketHref(b.name));
    await page.getByRole("button", { name: "By round" }).click(); // wide screens open on the tree; this shows the same view a phone has
    const bar = rounds(page).getByRole("tablist", { name: `${b.name} rounds` });
    const tabs = bar.getByRole("tab");
    await expect(tabs).toHaveCount(b.tree.length ? new Set(b.tree.map((n) => n.round)).size : 0);

    // The round the page calls current is open, marked on its tab for a screen reader ("current round") and by a square for the eye.
    const now = currentRound(b.rounds, centralClock().date)!;
    const nowLabel = b.tree.find((n) => n.round === now.round)!.label;
    const selected = bar.getByRole("tab", { selected: true });
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveText(new RegExp(`^${nowLabel}`, "i"));
    await expect(selected).toHaveAccessibleName(`${nowLabel} (current round)`);
    await expect(bar.locator("[data-now]")).toHaveCount(1);

    // Each tab controls a panel that it labels; exactly one panel is shown; only the open tab is in the tab order.
    for (let i = 0; i < (await tabs.count()); i++) {
      const tab = tabs.nth(i);
      const panel = page.locator(`[id="${await tab.getAttribute("aria-controls")}"]`);
      await expect(panel).toHaveAttribute("role", "tabpanel");
      await expect(panel).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
      if ((await tab.getAttribute("aria-selected")) === "true") await expect(panel).toBeVisible();
      else await expect(panel).toBeHidden();
      await expect(tab).toHaveAttribute("tabindex", (await tab.getAttribute("aria-selected")) === "true" ? "0" : "-1");
    }
    await expect(open(page)).toHaveCount(1);
  });

  test("the arrow keys, Home and End move between tabs and open them; the ends wrap", async ({ page }) => {
    const b = await pick();
    await page.goto(bracketHref(b.name));
    await page.getByRole("button", { name: "By round" }).click();
    const tabs = rounds(page).getByRole("tablist").getByRole("tab");
    const n = await tabs.count();
    expect(n).toBeGreaterThan(1);
    const selectedIndex = async () => tabs.evaluateAll((els) => els.findIndex((el) => el.getAttribute("aria-selected") === "true"));
    await tabs.nth(await selectedIndex()).focus();
    await page.keyboard.press("Home");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(open(page)).toHaveCount(1);
    await expect(open(page)).toHaveAttribute("aria-labelledby", (await tabs.nth(1).getAttribute("id"))!);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft"); // from the first tab: the last
    await expect(tabs.nth(n - 1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight"); // from the last tab: the first
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.nth(n - 1)).toBeFocused();
  });

  test("a game card: both teams, the day and kickoff, the site, a result or projection, a link to the game's page", async ({ page }) => {
    const b = await pick();
    await page.goto(bracketHref(b.name));
    await page.getByRole("button", { name: "By round" }).click();
    const cards = open(page).locator("[data-card]");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    const DAY = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}\b|Date not listed yet/;
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const text = (await card.innerText()).replace(/\s+/g, " ");
      const state = (await card.getAttribute("data-state"))!;
      // Both teams are there, as a button each (a team) or as the game whose winner it will be.
      expect(await card.locator("button[aria-pressed], [title]").count(), text).toBeGreaterThanOrEqual(2);
      if (state === "upcoming" || state === "open") {
        expect(text, "a game to play says its day").toMatch(DAY);
        expect(text, "and its site, or that none is listed").toMatch(/Site: |Site not listed yet/);
      }
      if (state === "final") expect(text).toMatch(/Final|Forfeit/);
      const link = card.getByRole("link", { name: /^Game page for / });
      if (await link.count()) await expect(link).toHaveAttribute("href", /^\/scores\//);
    }
    // No winner named for a game under way, no betting words.
    expect((await open(page).innerText()).replace(/winner of/gi, "")).not.toMatch(/\b(winner|leading)\b/i);
    expect(await open(page).innerText()).not.toMatch(BETTING);
    await noProblems(page);
  });

  test("a bracket that is not one tree yet still has its rounds as tabs", async ({ page }) => {
    const rest = (await brackets()).filter((b) => b.name !== "UIL Division I");
    test.skip(!rest.length, "one bracket this season");
    for (const b of rest.slice(0, 4)) {
      await page.goto(bracketHref(b.name));
      const bar = rounds(page).getByRole("tablist");
      if (!(await bar.isVisible())) await page.getByRole("button", { name: "By round" }).click();
      await expect(bar.getByRole("tab", { selected: true }), b.name).toHaveCount(1);
      await expect(open(page), b.name).toHaveCount(1);
    }
  });
});

test.describe("who's left", () => {
  test("every team still in is listed, none that lost its last game, each with its next game", async ({ page }) => {
    for (const b of (await brackets()).slice(0, 5)) {
      await page.goto(bracketHref(b.name));
      // The teams of the tree, and which of them lost the last game it played (a confirmed final it did not win).
      const teams = new Map<string, string>();
      const out = new Set<string>();
      for (const n of b.tree) for (const s of n.sides) if (s.team) teams.set(slugify(s.team), s.team);
      for (const [key] of teams) {
        const last = b.tree.findLast((n) => n.sides.some((s) => s.team && slugify(s.team) === key))!;
        if (last.state === "final" && !last.sides.find((s) => s.team && slugify(s.team) === key)?.won) out.add(key);
      }
      const expected = [...teams.keys()].filter((k) => !out.has(k)).sort();
      const section = page.locator("[data-whos-left]");
      if (!expected.length) {
        await expect(section, b.name).toHaveCount(0);
        continue;
      }
      await expect(section, b.name).toBeVisible();
      expect((await section.locator("[data-left]").evaluateAll((els) => els.map((el) => el.getAttribute("data-left")!))).sort(), b.name).toEqual(expected);
      await expect(section.getByRole("heading", { level: 2 }), b.name).toContainText(`${expected.length} ${expected.length === 1 ? "team" : "teams"}`);
      for (const li of await section.locator("[data-left]").all()) {
        const text = (await li.innerText()).replace(/\s+/g, " ");
        expect(text, b.name).toMatch(/Next: .+ · .+ · vs |Next game not set yet|Won the State Championship/);
      }
      expect(await section.innerText(), b.name).not.toMatch(BETTING);
    }
  });

  test("a chance to win the State Championship shows where the page has one, and agrees with the table of chances", async ({ page }) => {
    const b = (await brackets()).find((x) => x.advancement && x.advancement.rows.length);
    test.skip(!b, "no bracket with chances to reach each round");
    await page.goto(bracketHref(b!.name));
    const table = page.locator("[data-advance-table] tbody tr");
    const section = page.locator("[data-whos-left]");
    await expect(section).toBeVisible();
    for (const r of b!.advancement!.rows.slice(0, 6)) {
      const row = section.locator(`[data-left="${slugify(r.team)}"]`);
      if (r.title === undefined || r.title === 1 || !(await row.count())) continue;
      const shown = (await table.filter({ hasText: r.team }).first().locator("td").last().innerText()).trim();
      await expect(row, r.team).toContainText(shown === "In" ? ">99%" : shown);
    }
    await expect(section).toContainText("not a result");
  });

  test("Light its path lights the team's path and says so; its program page's playoff path is one tap away", async ({ page }) => {
    const b = await pick();
    await page.goto(bracketHref(b.name));
    const section = page.locator("[data-whos-left]");
    const row = section.locator("[data-left]", { has: page.locator("a[href^='/programs/']") }).first();
    const key = (await row.getAttribute("data-left"))!;
    const button = row.locator("button[aria-pressed]");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/’s path is lit\./)).toBeVisible();
    const link = page.getByRole("link", { name: "Playoff path on its page" });
    await expect(link).toHaveAttribute("href", `/programs/${key}#path`);
    await expect(row.getByRole("link", { name: /playoff path$/ })).toHaveAttribute("href", `/programs/${key}#path`);

    // The road, game by game: games played, then the next, then what its wins would lead to.
    const road = page.locator("[data-path-road]");
    await road.locator("summary").click();
    expect(await road.locator("li[data-step]").count()).toBeGreaterThan(0);
    if (/Next: /.test(await row.innerText())) await expect(road.locator("li[data-step=next]")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(road).toHaveCount(0);
  });
});

test.describe("a team's road in the rounds view", () => {
  test("tapping a team in a card lights its games, lists its road, and a line of the road opens that round", async ({ page }) => {
    const b = await pick();
    await page.goto(bracketHref(b.name));
    await page.getByRole("button", { name: "By round" }).click();
    const first = open(page).locator("[data-card] button[aria-pressed]").first();
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    // Games off its road dim; its own stay at full strength.
    if ((await open(page).locator("[data-card]").count()) > 1) expect(await open(page).locator("[data-card].opacity-40").count()).toBeGreaterThan(0);
    const road = page.locator("[data-path-road]");
    await road.locator("summary").click();
    const steps = road.locator("li[data-step] button");
    expect(await steps.count()).toBeGreaterThan(0);
    // A line names its round first; tapping it opens that round's tab.
    const text = (await steps.first().innerText()).trim();
    await steps.first().click();
    await expect(rounds(page).getByRole("tab", { selected: true })).toHaveText(new RegExp(`^${text.slice(0, text.indexOf(":"))}`, "i"));
  });
});

test.describe("the playoffs pages name the current round", () => {
  test("every league: a Current round block with each bracket's round, the same round marked in its list, and how many teams are left", async ({ page }) => {
    const all = await brackets();
    const today = centralClock().date;
    const leagues = [...new Set(all.map((b) => b.league))];
    expect(leagues.length).toBeGreaterThan(0);
    for (const league of leagues) {
      await page.goto(league === "UIL" ? "/playoffs" : `/playoffs/${league.toLowerCase()}`);
      const block = page.locator("[data-current-rounds]");
      await expect(block, league).toBeVisible();
      await expect(block.getByRole("heading", { name: "Current round" }), league).toBeVisible();
      const mine = all.filter((b) => b.league === league);
      for (const b of mine) {
        const now = currentRound(b.rounds, today)!;
        const row = block.locator(`li[data-bracket="${b.name}"]`);
        await expect(row.first(), b.name).toContainText(now.label);
        // The same round is marked in that bracket's own round list.
        const region = page.getByRole("region", { name: b.name, exact: true });
        if (b.rounds.length > 1) await expect(region.locator("nav a[aria-current=location]"), b.name).toHaveText(now.label);
        await expect(region.getByRole("heading", { level: 3, name: new RegExp(`^${now.label}.*current round`, "i") }), b.name).toBeVisible();
        // The line jumps to that round on this page; another to the bracket's list of who is left.
        await expect(row.first().getByRole("link").first()).toHaveAttribute("href", /^#bracket-/);
        const left = row.first().getByRole("link", { name: /^Who.s left: \d+ teams?/ });
        if (await left.count()) await expect(left).toHaveAttribute("href", `${bracketHref(b.name)}#whos-left`);
      }
      await noProblems(page);
    }
  });

  test("a past season has no current round", async ({ page }) => {
    await page.goto("/playoffs/season/2025");
    await expect(page.locator("[data-current-rounds]")).toHaveCount(0);
  });
});
