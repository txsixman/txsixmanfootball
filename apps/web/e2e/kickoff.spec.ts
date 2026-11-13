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
    // Each game: the page's own notes may say that no game names a winner.
    for (const text of await page.locator("main li").allInnerTexts()) expect(text).not.toMatch(NAMES_A_WINNER);
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
  const before = await inProgress.count();
  test.skip((await page.locator('[data-kickoff-status="starts"]').count()) === 0, "that game is not in this round any more");
  await page.clock.runFor(2 * 60_000);
  await expect.poll(() => inProgress.count()).toBeGreaterThan(before);
});
