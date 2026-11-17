import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { answer, LIVE_SCORES_URL, READ_AT_URL } from "./live-route";

// Following a game live (ADR 0087): the game page's band and note (no jump when a score arrives or leaves, "Updated 3 min ago",
// "may be behind", honest words before kickoff, in progress with no score and past the window), what is next for a final's
// winner, the board's Live now for a game under way with no score yet, and Tonight's strip and clock order. Every request to
// Supabase is answered from a fixture, never the real project. The service worker is blocked: it would fetch outside page.route.
test.use({ serviceWorkers: "block" });
test.setTimeout(120_000);

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
const WINNER_OR_BETTING = /\b(wins?|won|winner|winning|leads?|leading|leader|ahead|beat|beats|defeated|victory|spread|odds|lines?|favou?rites?|underdog|bets?|betting|maxpreps)\b/i;

/** The loaders read ../../data from the working directory; the tests run from the repo root. */
async function inWeb<T>(run: () => Promise<T>): Promise<T> {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await run();
  } finally {
    process.chdir(was);
  }
}

type Fixture = { id: string; date: string; home: string; away: string; org: string; key: string; homeSlug: string; awaySlug: string; kickoff: string };
let cached: Promise<Fixture> | undefined;
/** The earliest bracket game not yet played with a kickoff, so the hours before it hold no game in progress anywhere. */
const fixture = () =>
  (cached ??= inWeb(async () => {
    const { loadAlignments } = await import("../lib/alignments");
    const { loadGames } = await import("../lib/games");
    const { liveKey } = await import("../lib/live-scores");
    const { ORGS } = await import("../lib/orgs");
    const { slugify } = await import("../lib/slug");
    const g = (await loadGames(await loadAlignments())).filter((x) => x.state === "scheduled" && x.date && x.kickoff).sort((a, b) => a.kickoff!.localeCompare(b.kickoff!))[0];
    if (!g) throw new Error("no unplayed bracket game with a kickoff to test with");
    return {
      id: g.id, date: g.date!, home: g.home.name, away: g.away.name, kickoff: g.kickoff!,
      org: ORGS.find((o) => g.league === o.league || g.league.startsWith(`${o.league} `))!.label,
      key: liveKey(g.date!, g.home.name, g.away.name), homeSlug: slugify(g.home.name), awaySlug: slugify(g.away.name),
    };
  }));

/** Half an hour after kickoff: inside the game's in-progress window. */
const inWindow = (f: Fixture) => new Date(Date.parse(f.kickoff) + 30 * 60_000);
const liveRow = (f: Fixture, over: Record<string, unknown> = {}) => ({
  game_key: f.key, home: f.homeSlug, away: f.awaySlug, home_score: 28, away_score: 14, period: "Q3", clock: "4:12", read_at: inWindow(f).toISOString(), ...over,
});

/** Answers the live read with whatever `current.rows` holds (the board's "Scores checked" line too: never the real project). */
async function serveLive(page: Page, current: { rows: unknown[] }) {
  await answer(page, READ_AT_URL, "null");
  await page.route(LIVE_SCORES_URL, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(current.rows) });
  });
}

/** Where the big score and the game details sit on the page, to the pixel: a score arriving or leaving must move neither. */
const places = (page: Page) =>
  page.evaluate(() => {
    const top = (el: Element | null) => Math.round((el?.getBoundingClientRect().top ?? -1) + window.scrollY);
    return { score: top(document.querySelector('section[aria-label="Score"]')), details: top(document.getElementById("details")), height: document.documentElement.scrollHeight };
  });

test("the game page holds a place for the live score, so one arriving or leaving moves nothing", async ({ page }) => {
  const f = await fixture();
  const current: { rows: unknown[] } = { rows: [] };
  await page.clock.install({ time: inWindow(f) });
  await serveLive(page, current);
  await page.goto(`/scores/${f.id}`);
  // In progress with no score: never blank (ADR 0087).
  const note = page.locator("[data-score-note]");
  await expect(note).toContainText("In progress");
  await expect(note).toContainText("No live score yet");
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
  const before = await places(page);
  expect(before.score).toBeGreaterThan(0);

  current.rows = [liveRow(f, { read_at: new Date(inWindow(f).getTime() + 60_000).toISOString() })];
  await page.clock.runFor(61_000);
  await expect(page.locator("[data-live-score]")).toHaveText(/^Live · Q3 · 4:12 left · as of /);
  await expect(note).toHaveCount(0);
  expect(await places(page)).toEqual(before);

  current.rows = [];
  await page.clock.runFor(61_000);
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
  await expect(note).toContainText("In progress");
  expect(await places(page)).toEqual(before);
});

test("the band turns red, says Live and how long ago the score was read, and warns when two reads are missed", async ({ page }) => {
  const f = await fixture();
  const current = { rows: [liveRow(f)] };
  await page.clock.install({ time: inWindow(f) });
  await serveLive(page, current);
  await page.goto(`/scores/${f.id}`);
  const band = page.locator("article header > div").first();
  await expect(band).toContainText("Live");
  await expect(band).toHaveClass(/bg-alert/);
  const updated = page.locator("[data-live-updated]");
  await expect(updated).toHaveText("Updated just now");
  await page.clock.runFor(3 * 60_000); // nothing new is read: the same row, three minutes old
  await expect(updated).toHaveText("Updated 3 min ago");
  await expect(page.locator("[data-live-score]")).not.toContainText("may be behind");
  await page.clock.runFor(23 * 60_000); // 26 minutes: two reads missed
  await expect(updated).toHaveText("Updated 26 min ago · may be behind");
  await expect(page.locator("[data-live-score]")).toHaveText(/as of \d{1,2}:\d{2} (AM|PM) CT · may be behind · Unconfirmed$/);
  // Still no leader and no winner named, and nothing from a betting page.
  expect((await page.locator("article header").innerText()).replace(f.away, "").replace(f.home, "")).not.toMatch(WINNER_OR_BETTING);
  // A finished read is a final: Final, no "Updated", no red band.
  current.rows = [liveRow(f, { period: null, finished: true, read_at: new Date(inWindow(f).getTime() + 26 * 60_000).toISOString() })];
  await page.clock.runFor(61_000);
  await expect(updated).toHaveCount(0);
  await expect(band).not.toHaveClass(/bg-alert/);
  await expect(page.locator("[data-kickoff-status]")).toHaveText("Final");
});

test("before kickoff the page says not started, past its window it says no score has come in; neither asks for a score", async ({ page }) => {
  const f = await fixture();
  let asked = 0;
  await answer(page, READ_AT_URL, "null");
  await page.route(LIVE_SCORES_URL, (route) => {
    if (route.request().method() !== "OPTIONS") asked++;
    return route.fulfill({ status: route.request().method() === "OPTIONS" ? 204 : 200, headers: CORS, contentType: "application/json", body: "[]" });
  });
  await page.clock.install({ time: new Date(Date.parse(f.kickoff) - 30 * 60_000) });
  await page.goto(`/scores/${f.id}`);
  const note = page.locator("[data-score-note]");
  await expect(note).toContainText("Not started");
  await expect(note).toContainText(/Kickoff \d{1,2}:\d{2} (AM|PM) CT\./);
  await expect(page.locator("[data-live-updated]")).toHaveCount(0);
  const before = await places(page);
  await page.clock.runFor(3 * 60_000);
  expect(asked).toBe(0);
  // Past the 4-hour window with no final: honest, and it says what to do.
  await page.clock.runFor(5 * 3600_000);
  await expect(note).toContainText("Score not reported yet");
  await expect(note).toContainText("No score has come in. Reload later to check.");
  const after = asked;
  await page.clock.runFor(5 * 60_000);
  expect(asked).toBe(after);
  expect(Math.abs((await places(page)).score - before.score)).toBeLessThanOrEqual(1);
  expect(await note.innerText()).not.toMatch(WINNER_OR_BETTING);
});

test("the scoreboard lists a game under way with no score yet under In progress, saying so, and not under Later or Live now", async ({ page }) => {
  const f = await fixture();
  await page.clock.install({ time: inWindow(f) });
  await serveLive(page, { rows: [] });
  await page.goto("/scores", { waitUntil: "networkidle" });
  const tab = page.getByRole("button", { name: f.org, exact: true });
  if (await tab.count()) {
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
    }).toPass();
  }
  const row = page.locator("#in-progress").locator(`li[data-game="${f.id}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#live").locator(`li[data-game="${f.id}"]`)).toHaveCount(0);
  await expect(row).toContainText("In progress");
  await expect(row.locator("[data-no-score]")).toHaveText("No live score yet. Checked every few minutes.");
  await expect(page.locator("#later").locator(`li[data-game="${f.id}"]`)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Jump to" }).getByRole("link", { name: /^Live\s*\d/ })).toBeVisible();
  expect((await row.innerText()).replace(/\s+/g, " ")).not.toMatch(/\bUnconfirmed\b|\bwinner\b/i);
});

test("a stale live read on the scoreboard says the score may be behind", async ({ page }) => {
  const f = await fixture();
  // The page's clock is 30 minutes past the read.
  await page.clock.install({ time: new Date(inWindow(f).getTime() + 30 * 60_000) });
  await serveLive(page, { rows: [liveRow(f)] });
  await page.goto("/scores", { waitUntil: "networkidle" });
  const tab = page.getByRole("button", { name: f.org, exact: true });
  if (await tab.count()) {
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
    }).toPass();
  }
  await expect(page.locator("#live").locator(`li[data-game="${f.id}"] [data-live-score]`)).toHaveText(/^Q3 · 4:12 left · as of \d{1,2}:\d{2} (AM|PM) CT · may be behind$/, { timeout: 15_000 });
});

test.describe("after a final", () => {
  type Case = { id: string; winner: string; label: string };
  let found: Promise<Case | undefined> | undefined;
  /** A confirmed bracket final whose winner has a game still to play in the next round (from the bracket data, worked out apart from the page). */
  const next = () =>
    (found ??= inWeb(async () => {
      const { loadBrackets } = await import("../lib/brackets");
      const { ROUNDS } = await import("../lib/games");
      const { loadAlignments } = await import("../lib/alignments");
      const { loadGames } = await import("../lib/games");
      const ids = new Map((await loadGames(await loadAlignments())).map((g) => [`${g.date}|${g.home.name}|${g.away.name}`, g.id]));
      for (const b of await loadBrackets()) {
        for (const r of b.rounds) {
          for (const g of r.games) {
            if (g.homeScore == null || g.awayScore == null || !g.confirmed || g.forfeit || g.homeScore === g.awayScore) continue;
            const [winner] = g.homeScore > g.awayScore ? [g.home, g.away] : [g.away, g.home];
            const later = b.rounds.filter((x) => ROUNDS.indexOf(x.round) > ROUNDS.indexOf(r.round)).sort((x, y) => ROUNDS.indexOf(x.round) - ROUNDS.indexOf(y.round));
            const upcoming = later.flatMap((x) => x.games.filter((y) => y.homeScore == null && [y.home, y.away].includes(winner)));
            const id = ids.get(`${g.date}|${g.home}|${g.away}`);
            const played = later.flatMap((x) => x.games.filter((y) => y.homeScore != null && [y.home, y.away].includes(winner)));
            if (id && upcoming.length && !played.length) return { id, winner, label: later.find((x) => x.games.includes(upcoming[0]))!.label };
          }
        }
      }
      return undefined;
    }));

  test("a final's page says what is next for its winner, with a link to that game", async ({ page }) => {
    const c = await next();
    test.skip(!c, "no confirmed bracket final whose winner has a game still to play");
    await page.goto(`/scores/${c!.id}`);
    const box = page.locator("[data-whats-next]");
    await expect(box.getByRole("heading", { level: 2 })).toHaveText(`What's next for ${c!.winner}`);
    await expect(box).toContainText(c!.label);
    await expect(box).toContainText(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}|Day and time not listed yet/);
    await expect(box).toContainText(/Site: |Site not listed yet/);
    const link = box.getByRole("link");
    await expect(link).toHaveCount(1);
    expect(await link.getAttribute("href")).toMatch(/^\/scores\/[a-z0-9-]+$/);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // It follows the link to a real page.
    await link.click();
    await expect(page).toHaveURL(/\/scores\/[a-z0-9-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(" vs ");
  });

  test("a game not yet played, and a page with no confirmed winner, show no such box", async ({ page }) => {
    const f = await fixture();
    await answer(page, LIVE_SCORES_URL, "[]");
    await answer(page, READ_AT_URL, "null");
    await page.goto(`/scores/${f.id}`);
    await expect(page.locator("[data-whats-next]")).toHaveCount(0);
  });

  test("the page passes axe with the box on it, and fits a phone", async ({ page }) => {
    const c = await next();
    test.skip(!c, "no confirmed bracket final whose winner has a game still to play");
    await answer(page, LIVE_SCORES_URL, "[]");
    await answer(page, READ_AT_URL, "null");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/scores/${c!.id}`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-whats-next]")).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});

test.describe("Tonight", () => {
  type Night = { id: string; kickoff: string; date: string; home: string; away: string; key: string; homeSlug: string; awaySlug: string; org: string };
  let cachedNight: Promise<Night | undefined> | undefined;
  /** Tonight's earliest game with a kickoff and no score yet, and its organization. */
  const tonight = () =>
    (cachedNight ??= inWeb(async () => {
      const { loadNight } = await import("../lib/tonight");
      const { liveKey } = await import("../lib/live-scores");
      const { slugify } = await import("../lib/slug");
      const night = await loadNight();
      const games = night.orgs.flatMap((o) => o.rounds.flatMap((r) => r.games.map((g) => ({ g, org: o.slug }))));
      const first = games.filter((x) => x.g.state === "later" && x.g.kickoff).sort((a, b) => a.g.kickoff!.localeCompare(b.g.kickoff!))[0];
      return first && {
        id: first.g.id, kickoff: first.g.kickoff!, date: first.g.date, home: first.g.home, away: first.g.away, key: liveKey(first.g.date, first.g.home, first.g.away),
        homeSlug: slugify(first.g.home), awaySlug: slugify(first.g.away), org: first.org,
      };
    }));

  test("a game under way puts its organization first and counts in the strip, which jumps to it", async ({ page }) => {
    const n = await tonight();
    test.skip(!n, "no game tonight with a kickoff and no score yet");
    const at = new Date(Date.parse(n!.kickoff) + 30 * 60_000);
    await page.clock.install({ time: at });
    await serveLive(page, { rows: [{ game_key: n!.key, home: n!.homeSlug, away: n!.awaySlug, home_score: 28, away_score: 14, period: "Q3", read_at: at.toISOString() }] });
    await page.goto("/scores/tonight");
    const row = page.locator(`[data-group="in-progress"] li[data-game="${n!.id}"]`);
    await expect(row.locator("[data-live-score]")).toContainText("14–28", { timeout: 15_000 });
    // Its organization's section is the first on the page, and the strip's Live link points at its In progress group.
    await expect(page.locator("main section[aria-labelledby^='night-']").first()).toHaveAttribute("aria-labelledby", `night-${n!.org}`);
    const strip = page.getByRole("navigation", { name: "All organizations tonight" });
    const live = strip.getByRole("link", { name: /^Live\s*\d/ });
    await expect(live).toHaveAttribute("href", `#night-${n!.org}-in-progress`);
    await expect(page.locator(`#night-${n!.org}-in-progress`)).toBeVisible();
    // Every link in the strip is a phone-sized target, and a kind with no games is plain text, not a link.
    for (const link of await strip.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The game is listed under its own organization's In progress group; organizations never share a list (ADR 0012).
    await expect(page.locator(`#night-${n!.org}-in-progress li[data-game="${n!.id}"]`)).toHaveCount(1);
  });

  test("a game under way with no score yet, and one past its window, each say so", async ({ page }) => {
    const n = await tonight();
    test.skip(!n, "no game tonight with a kickoff and no score yet");
    await serveLive(page, { rows: [] });
    await page.clock.install({ time: new Date(Date.parse(n!.kickoff) + 30 * 60_000) });
    await page.goto("/scores/tonight");
    const row = page.locator(`[data-group="in-progress"] li[data-game="${n!.id}"]`);
    await expect(row).toContainText("In progress", { timeout: 15_000 });
    await expect(row.locator("[data-no-score]")).toHaveText("No live score yet. Checked every few minutes.");
    await page.clock.runFor(4 * 3600_000);
    const late = page.locator(`[data-group="awaiting"] li[data-game="${n!.id}"]`);
    await expect(late).toContainText("Score not reported yet");
    await expect(late.locator("[data-no-score]")).toHaveText("No score has come in for this game yet.");
    expect((await late.innerText()).replace(n!.away, "").replace(n!.home, "")).not.toMatch(WINNER_OR_BETTING);
    const strip = page.getByRole("navigation", { name: "All organizations tonight" });
    await expect(strip.getByRole("link", { name: /^No score\s*\d/ })).toHaveAttribute("href", /^#night-[a-z]+-awaiting$/);
  });
});
