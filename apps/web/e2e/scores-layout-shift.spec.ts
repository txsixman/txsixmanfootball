import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// The scoreboard moved by 0.55 on a Tuesday (Nov 17, 2026): between game nights it lists this week's games before last week's finals,
// and it worked that out after the page's script loaded, so every section jumped (Lighthouse's cumulative-layout-shift, limit 0.03).
// Now the order is set before first paint (lib/upcoming-first.ts, ADR 0103). This loads /scores on each side of the halfway point
// between the last game day and the next, twice each with the service worker active (the second load comes through it), and
// reads the page's layout shift with a PerformanceObserver. CI only: the worker runs only in a production build.
test.skip(!process.env.CI, "the service worker runs only in a production build");

/** The date of the latest UIL final and of the next UIL game day after it, as the board counts them. */
async function gameDays() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    const { loadAlignments } = await import("../lib/alignments");
    const { loadGames } = await import("../lib/games");
    const { loadBrackets } = await import("../lib/brackets");
    const uil = (await loadGames(await loadAlignments())).filter((g) => g.league.startsWith("UIL ") && g.date);
    const last = uil.filter((g) => g.state === "final").map((g) => g.date!).sort().at(-1);
    const built = (await loadBrackets()).filter((b) => b.league === "UIL").flatMap((b) => b.rounds.flatMap((r) => r.built.flatMap((g) => (g.date ? [g.date] : []))));
    const next = [...uil.filter((g) => g.state === "scheduled").map((g) => g.date!), ...built].filter((d) => !last || d > last).sort()[0];
    return { last, next };
  } finally {
    process.chdir(was);
  }
}

const noon = (day: string) => Date.parse(`${day}T12:00:00-06:00`);

async function shift(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // the page's own script, the clock's first tick and any late relabelling
  return page.evaluate(() => (window as unknown as { __shift: number }).__shift);
}

for (const [label, where] of [["finals first (the morning after the last game night)", 0.1], ["this week's games first (past the halfway point)", 0.9]] as const) {
  test(`/scores moves nothing after it loads, with the worker active: ${label}`, async ({ page }) => {
    const { last, next } = await gameDays();
    test.skip(!last || !next || noon(next) - noon(last) < 3 * 86_400_000, "no later game day far enough off");
    // `where` of the way from the last game day to the next (the board flips at one half).
    await page.clock.setFixedTime(new Date(noon(last!) + (noon(next!) - noon(last!)) * where));
    await page.addInitScript(() => {
      (window as unknown as { __shift: number }).__shift = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { __shift: number }).__shift += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/scores");
    await page.evaluate(() => navigator.serviceWorker.ready);
    expect(await shift(page), "first load").toBeLessThan(0.01);
    await page.reload(); // through the worker now
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(await shift(page), "second load, through the worker").toBeLessThan(0.01);
    await page.goto("/scores"); // a third, as Lighthouse's third run is
    expect(await shift(page), "third load").toBeLessThan(0.01);
    // And the order really is the one for that side of the halfway point.
    const sections = await page.locator("main section[id]").evaluateAll((els) => els.map((e) => ({ id: e.id, top: e.getBoundingClientRect().top })).sort((a, b) => a.top - b.top).map((e) => e.id));
    const upcoming = sections.findIndex((id) => id === "later" || id === "next");
    const finals = sections.indexOf("final");
    if (upcoming >= 0 && finals >= 0) expect(upcoming < finals, sections.join(" ")).toBe(where > 0.5);
  });
}
