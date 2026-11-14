import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../lib/supabase-public";
import { LIVE_SCORES_URL } from "./live-route";

// Live scores during a game (ADR 0021): the page reads the public function live_scores() in the browser, so every request to
// Supabase here is answered from a fixture. The service worker is blocked: it would otherwise fetch outside page.route.
test.use({ serviceWorkers: "block" });

const NO_WINNER_OR_BETTING = /\b(wins?|won|winner|winning|leads?|leading|leader|ahead|beat|beats|defeated|victory|spread|odds|line|lines|favorite|favourite|underdog|bet|bets|betting)\b/i;
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };

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

type Fixture = { id: string; date: string; home: string; away: string; org: string; key: string; homeSlug: string; awaySlug: string; kickoff?: string };
let cached: Promise<{ scheduled: Fixture; final: Fixture }> | undefined;
const fixtures = () =>
  (cached ??= inWeb(async () => {
    const { loadAlignments } = await import("../lib/alignments");
    const { loadGames } = await import("../lib/games");
    const { liveKey } = await import("../lib/live-scores");
    const { ORGS } = await import("../lib/orgs");
    const { slugify } = await import("../lib/slug");
    const games = await loadGames(await loadAlignments());
    const fixture = (g: (typeof games)[number]): Fixture => ({
      id: g.id, date: g.date!, home: g.home.name, away: g.away.name,
      org: ORGS.find((o) => g.league === o.league || g.league.startsWith(`${o.league} `))!.label,
      key: liveKey(g.date!, g.home.name, g.away.name), homeSlug: slugify(g.home.name), awaySlug: slugify(g.away.name), kickoff: g.kickoff,
    });
    // The live read starts at kickoff (lib/kickoff.ts): a game with a known kickoff to put the clock inside.
    // The earliest kickoff of any unplayed game, so the hours before it hold no game in progress anywhere.
    const scheduled = games.filter((g) => g.state === "scheduled" && g.date && g.kickoff).sort((a, b) => a.kickoff!.localeCompare(b.kickoff!))[0];
    const final = games.find((g) => g.state === "final" && g.date);
    if (!scheduled || !final) throw new Error("no scheduled and final bracket game to test with");
    return { scheduled: fixture(scheduled), final: fixture(final) };
  }));

/** Half an hour after kickoff: inside the game's in-progress window. */
const inWindow = (f: Fixture) => new Date(Date.parse(f.kickoff!) + 30 * 60_000);

/** The page's clock is fixed, so a row is read "now" on that clock. */
const liveRow = (f: Fixture, over: Record<string, unknown> = {}) => ({
  game_key: f.key, home: f.homeSlug, away: f.awaySlug, home_score: 28, away_score: 14, period: "Q3", ...over, read_at: over.read_at ?? inWindow(f).toISOString(),
});

/** Answers the live_score request with whatever `current.rows` holds, and keeps what the page sent. */
async function serveLive(page: Page, current: { rows: unknown; status?: number }) {
  const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
  await page.route(LIVE_SCORES_URL, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    seen.push({ url: request.url(), method: request.method(), headers: request.headers() });
    return route.fulfill({ status: current.status ?? 200, headers: CORS, contentType: "application/json", body: JSON.stringify(current.rows) });
  });
  return seen;
}

async function openBoard(page: Page, f: Fixture) {
  await page.goto("/scores", { waitUntil: "networkidle" });
  const tab = page.getByRole("button", { name: f.org, exact: true });
  if (await tab.count()) await tab.click();
  return page.locator(`li[data-game="${f.id}"]`);
}

test("a game under way shows its live score in the score itself on the game page and the board: dashed, Unconfirmed, no winner", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  const seen = await serveLive(page, { rows: [liveRow(f)] });
  await page.clock.install({ time: inWindow(f) });

  await page.goto(`/scores/${f.id}`);
  const line = page.locator("[data-live-score]");
  // The score is in the big score, each on its own team (away listed first: 14, home 28), dashed; the line says where it stands.
  await expect(line).toHaveText(/^Live · Q3 · as of \d{1,2}:\d{2} (AM|PM) CT · Unconfirmed$/);
  await expect(page.getByRole("region", { name: "Score" }).locator(".decoration-dashed")).toHaveText(["14", "28"]);
  expect((await line.innerText()).replace(f.away, "").replace(f.home, "")).not.toMatch(NO_WINNER_OR_BETTING);
  // One POST to the function, with the public key and nothing else.
  expect(seen[0].url).toBe(`${SUPABASE_URL}/rest/v1/rpc/live_scores`);
  expect(seen[0].method).toBe("POST");
  expect(seen[0].headers.apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
  // The page still names nobody: no winner mark anywhere on it.
  await expect(page.locator("body")).not.toContainText(/winner/i);

  // The board lists it under Live, counted in the jump bar, its score in its own cells (dashed), Unconfirmed, no projection.
  const row = await openBoard(page, f);
  await expect(page.locator("#live").locator(`li[data-game="${f.id}"]`)).toBeVisible();
  await expect(page.locator("#later").locator(`li[data-game="${f.id}"]`)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Jump to" }).getByRole("link", { name: /Live\s*1/ })).toBeVisible();
  const text = (await row.innerText()).replace(/\s+/g, " ");
  expect(text).toMatch(/^Live Q3 /i);
  await expect(row.locator(".decoration-dashed")).toHaveText(["14", "28"]);
  expect(text).toMatch(/Unconfirmed/i);
  expect(text).not.toMatch(/Projected|no score|In progress/i);
  await expect(row.locator("[data-live-score]")).toHaveText(/^Q3 · as of \d{1,2}:\d{2} (AM|PM) CT$/);
  expect(text.toLowerCase()).not.toMatch(/\bwinner\b/);
  await expect(row.locator("[aria-hidden='true']", { hasText: "◀" })).toHaveCount(0);
});

test("a game the read saw finished shows as Score reported until the final: dashed, no winner, never In progress (ADR 0042)", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  await serveLive(page, { rows: [liveRow(f, { period: null, finished: true })] });
  await page.goto(`/scores/${f.id}`);
  await expect(page.locator("[data-live-score]")).toHaveText(/^Score reported · as of \d{1,2}:\d{2} (AM|PM) CT · Unconfirmed$/);
  await expect(page.getByRole("region", { name: "Score" }).locator(".decoration-dashed")).toHaveText(["14", "28"]);
  await expect(page.locator("body")).not.toContainText(/winner|In progress/i);

  // The board lists it under Score reported, counted in the jump bar, not under Live.
  const row = await openBoard(page, f);
  await expect(page.locator("#reported").locator(`li[data-game="${f.id}"]`)).toBeVisible();
  await expect(page.locator("#live").locator(`li[data-game="${f.id}"]`)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Jump to" }).getByRole("link", { name: /Reported\s*\d+/ })).toBeVisible();
  await expect(row.locator(".decoration-dashed")).toHaveText(["14", "28"]);
  const text = (await row.innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/In progress|Projected|\bLive\b/i);
  expect(text.replace(f.away, "").replace(f.home, "")).not.toMatch(NO_WINNER_OR_BETTING);
});

test("a row with no period reads Live · as of … · Unconfirmed, the score in the big score", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  await serveLive(page, { rows: [liveRow(f, { period: null })] });
  await page.clock.install({ time: inWindow(f) });
  await page.goto(`/scores/${f.id}`);
  await expect(page.locator("[data-live-score]")).toHaveText(/^Live · as of \d{1,2}:\d{2} (AM|PM) CT · Unconfirmed$/);
  await expect(page.getByRole("region", { name: "Score" }).locator(".decoration-dashed")).toHaveText(["14", "28"]);
});

test("a game with a final ignores a live row, on its page and on the board", async ({ page }) => {
  const { scheduled, final: f } = await fixtures();
  const seen = await serveLive(page, { rows: [liveRow(f, { read_at: inWindow(scheduled).toISOString() })] });
  await page.clock.install({ time: inWindow(scheduled) }); // a game on the board is in progress, so the board asks
  await page.goto(`/scores/${f.id}`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
  expect(seen.length).toBe(0); // a game with a final never enables the read, though another game is in progress
  const row = await openBoard(page, f);
  await expect(row).toBeVisible();
  expect(seen.length).toBeGreaterThan(0); // the board did ask; it just shows nothing for a final
  await expect(row.locator("[data-live-score]")).toHaveCount(0);
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
});

test("nothing extra shows when the request fails, the answer is not a list, or a row is bad", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  const current: { rows: unknown; status?: number } = { rows: { message: "no" }, status: 500 };
  await serveLive(page, current);
  await page.clock.install({ time: inWindow(f) });
  await page.goto(`/scores/${f.id}`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
  for (const rows of [{ message: "JWT expired" }, [liveRow(f, { home_score: 999 })], [liveRow(f, { period: "<b>" })], [liveRow(f, { read_at: "2020-01-01T00:00:00Z" })]]) {
    current.rows = rows;
    current.status = 200;
    await page.goto(`/scores/${f.id}`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-live-score]"), JSON.stringify(rows)).toHaveCount(0);
  }
});

test("the line refreshes every minute and goes away when the game leaves the table", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  await page.clock.install({ time: inWindow(f) });
  const current: { rows: unknown[] } = { rows: [] };
  await serveLive(page, current);
  await page.goto(`/scores/${f.id}`);
  const line = page.locator("[data-live-score]");
  await expect(line).toHaveCount(0);
  current.rows = [liveRow(f, { home_score: 35, away_score: 14, period: "Q4", read_at: new Date(inWindow(f).getTime() + 60_000).toISOString() })];
  await page.clock.runFor(61_000);
  await expect(line).toHaveText(/^Live · Q4 · as of /);
  await expect(page.getByRole("region", { name: "Score" }).locator(".decoration-dashed")).toHaveText(["14", "35"]);
  current.rows = [];
  await page.clock.runFor(61_000);
  await expect(line).toHaveCount(0);
});

// The request is made only while a game is in progress (by kickoff, re-checked each minute) and the tab is visible.
const requests = (seen: unknown[]) => seen.length;

test("a game page asks for nothing before kickoff, starts by itself at kickoff, and stops when the window ends", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  const kickoff = Date.parse(f.kickoff!);
  await page.clock.install({ time: new Date(kickoff - 5 * 60_000) });
  const seen = await serveLive(page, { rows: [liveRow(f, { read_at: new Date(kickoff + 60_000).toISOString() })] });
  await page.goto(`/scores/${f.id}`);
  await page.clock.runFor(2 * 60_000); // two minutes before kickoff
  expect(requests(seen)).toBe(0);
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
  await page.clock.runFor(4 * 60_000); // a minute after kickoff
  await expect.poll(() => requests(seen)).toBeGreaterThan(0);
  await expect(page.locator("[data-live-score]")).toHaveText(/^Live · Q3 · as of /);
  await expect(page.getByRole("region", { name: "Score" }).locator(".decoration-dashed")).toHaveText(["14", "28"]);
  // Past the window (4 hours): no more requests, and the line goes.
  await page.clock.runFor(4 * 3600_000);
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
  const after = requests(seen);
  await page.clock.runFor(5 * 60_000);
  expect(requests(seen)).toBe(after);
});

test("the board and Tonight ask for nothing before the first kickoff", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  const seen = await serveLive(page, { rows: [liveRow(f)] });
  await page.clock.install({ time: new Date(Date.parse(f.kickoff!) - 10 * 3600_000) });
  await page.goto("/scores", { waitUntil: "networkidle" });
  await page.clock.runFor(3 * 60_000);
  expect(requests(seen)).toBe(0);
  await page.goto("/scores/tonight", { waitUntil: "networkidle" });
  await page.clock.runFor(3 * 60_000);
  expect(requests(seen)).toBe(0);
});

test("a hidden tab makes no request", async ({ page }) => {
  const { scheduled: f } = await fixtures();
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  });
  await page.clock.install({ time: inWindow(f) });
  const seen = await serveLive(page, { rows: [liveRow(f)] });
  await page.goto(`/scores/${f.id}`, { waitUntil: "networkidle" });
  await page.clock.runFor(3 * 60_000);
  expect(requests(seen)).toBe(0);
});
