import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { noLiveScores } from "./live-route";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// Kickoff status (ADR 0036): worked out in the browser at the moment of viewing, so the same static page says "Starts",
// "In progress" or "Score not reported yet" as the clock moves. The exact labels at fixed times are scripts/kickoff.test.mjs;
// here, every game not yet played on the pages a fan opens on game night shows one of them once the page runs.
const LABEL = /^(Starts \d{1,2}:\d\d [AP]M CT|\d{1,2}:\d\d [AP]M CT|In progress|Score not reported yet|No score yet|Time not listed)$/i; // some are drawn in capitals
const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
const NAMES_A_WINNER = /\b(won|beat|beats|defeated|wins|winner)\b/i;
const SHOTS = path.join(__dirname, ".results", "shots");

for (const url of ["/playoffs/this-round", "/scores", "/scores/tonight", "/playoffs"]) {
  test(`kickoff status shows on every game not yet played, at the time of viewing: ${url}`, async ({ page }, info) => {
    await page.clock.setFixedTime(new Date("2026-11-14T00:30:00Z")); // 6:30 PM Central, Friday Nov 13
    expect((await page.goto(url, { waitUntil: "networkidle" }))?.status()).toBe(200);
    const statuses = page.locator("[data-kickoff-status]");
    const n = await statuses.count();
    // Each has run in the page: none is left at the server's placeholder.
    if (n) await expect(page.locator('[data-kickoff-status="pending"]')).toHaveCount(0);
    for (const text of await statuses.allTextContents()) expect(text.trim()).toMatch(LABEL);
    expect(await page.locator("main").innerText()).not.toMatch(BETTING);
    // Each game not yet played names no winner (a final may: ADR 0040).
    for (const text of await page.locator("main li").filter({ has: page.locator("[data-kickoff-status]") }).allInnerTexts()) expect(text).not.toMatch(NAMES_A_WINNER);
    if (info.project.name === "phone") {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `kickoff-${url.replace(/\W+/g, "-")}-phone.png`), fullPage: true });
    }
  });
}

test("the label moves with the clock, without a reload", async ({ page }) => {
  // The latest kickoff on file: a minute before it, then two minutes on.
  const rows = readFileSync(path.join(__dirname, "../../../data/seed/game-details/2026.csv"), "utf8").trim().split("\n").slice(1).filter((r) => r.split(",")[3]);
  test.skip(!rows.length, "no kickoff time on file");
  const kickoff = Date.parse(rows.map((r) => r.split(",")[3]).sort().at(-1)!);
  await page.clock.install({ time: new Date(kickoff - 60_000) });
  await page.goto("/playoffs/this-round", { waitUntil: "networkidle" });
  const inProgress = page.locator('[data-kickoff-status="in-progress"]');
  const starts = page.locator('[data-kickoff-status="starts"]');
  const starting = await starts.count();
  test.skip(starting === 0, "that game is not in this round any more");
  // No kickoff on file is later, so every game reading "Starts" now kicks off at this one. Two minutes on, none still
  // reads "Starts" and each of them reads "In progress". The total in progress need not rise: a game that kicked off
  // exactly 4 hours earlier leaves "In progress" at the same minute (two TAPPS finals, 11 AM and 3 PM, Nov 21, 2026).
  await page.clock.runFor(2 * 60_000);
  await expect.poll(() => starts.count()).toBe(0);
  expect(await inProgress.count()).toBeGreaterThanOrEqual(starting);
});

// A game whose date has passed with no score reads "Score not reported yet", never "Later" (ADR 0046). Before the season
// nothing is past; after it, every dated game still without a score has moved out of Later, and none is lost.
test("a past game with no score is under Score not reported yet, not Later: /scores", async ({ page }) => {
  const count = async (when: string) => {
    await page.clock.setFixedTime(new Date(when));
    expect((await page.goto("/scores", { waitUntil: "networkidle" }))?.status()).toBe(200);
    await expect(page.locator('[data-kickoff-status="pending"]')).toHaveCount(0);
    return { later: await page.locator("#later li").count(), notReported: await page.locator("#not-reported li").count() };
  };
  const before = await count("2026-08-01T17:00:00Z");
  expect(before.notReported).toBe(0);
  const after = await count("2027-03-01T18:00:00Z");
  expect(after.later + after.notReported).toBe(before.later);
  if (before.later) expect(after.notReported).toBeGreaterThan(0);
  if (after.notReported) await expect(page.locator("#not-reported h2")).toHaveText("Score not reported yet");
});

// Game night order on /scores (UIL, the default button): the round played last on top of the finals, and between game
// nights this week's games (Later, then Next games) before last week's finals once the next game day is nearer.
test("scores puts the newest finals first, and this week's games first midweek", async ({ page }) => {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  const { lastDay, nextDay, newest } = await (async () => {
    try {
      const { loadAlignments } = await import("../lib/alignments");
      const { loadGames } = await import("../lib/games");
      const { loadBrackets } = await import("../lib/brackets");
      const uil = (await loadGames(await loadAlignments())).filter((g) => g.league.startsWith("UIL ") && g.date);
      const finals = uil.filter((g) => g.state === "final").sort((a, b) => b.date!.localeCompare(a.date!));
      const last = finals[0]?.date;
      const built = (await loadBrackets()).filter((b) => b.league === "UIL").flatMap((b) => b.rounds.flatMap((r) => r.built.flatMap((g) => (g.date ? [g.date] : []))));
      const next = [...uil.filter((g) => g.state === "scheduled").map((g) => g.date!), ...built].filter((d) => !last || d > last).sort()[0];
      return { lastDay: last, nextDay: next, newest: [...new Set(finals.filter((g) => g.date === last).map((g) => g.league))] };
    } finally {
      process.chdir(was);
    }
  })();
  test.skip(!lastDay, "no UIL final yet");
  const order = async (when: string) => {
    await page.clock.setFixedTime(new Date(when));
    await page.goto("/scores", { waitUntil: "networkidle" });
    await expect(page.locator('[data-kickoff-status="pending"]')).toHaveCount(0);
    // The order on screen: the board keeps its sections in one order and CSS moves "Later" up midweek (lib/upcoming-first.ts, ADR 0099).
    return page.locator("main section[id]").evaluateAll((els) => els.map((e) => ({ id: e.id, top: e.getBoundingClientRect().top })).sort((a, b) => a.top - b.top).map((e) => e.id));
  };
  const day = (d: string, plus: number) => new Date(Date.parse(`${d}T18:00:00Z`) + plus * 86_400_000).toISOString();
  // The morning after the last game night: finals first, the newest round on top.
  const after = await order(day(lastDay!, 1));
  expect(newest).toContain(await page.locator("#final h3").first().textContent());
  test.skip(!nextDay || Date.parse(nextDay) - Date.parse(lastDay!) < 3 * 86_400_000, "no later game day far enough off");
  const upcoming = (ids: string[]) => ids.findIndex((id) => id === "later" || id === "next");
  expect(upcoming(after)).toBeGreaterThan(after.indexOf("final"));
  // The day before the next game day: this week's games first.
  const before = await order(day(nextDay!, -1));
  expect(upcoming(before)).toBeGreaterThanOrEqual(0);
  expect(upcoming(before)).toBeLessThan(before.indexOf("final"));
});
