import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { SUPABASE_PUBLISHABLE_KEY } from "../lib/supabase-public";
import { answer, noLiveScores, READ_AT_URL } from "./live-route";

// "Scores checked N min ago" (ADR 0038): the /scores and Tonight boards read the time of the last game-day read through the
// public function results_read_at(). Every request is answered from a fixture, the clock is set (page.clock) from the
// first kickoff of a game night in the data, and the exact wording at fixed times is scripts/scores-checked.test.mjs.
noLiveScores(test);

const MIN = 60_000;
const BAD = /\b(maxpreps|source|winner|wins?|won|leads?|leading|spread|odds|lines?|favorite|bet|betting)\b/i;

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

type Night = { date: string; first: number; tonight: boolean };
let cached: Promise<{ board?: Night; tonight?: Night }> | undefined;
/** A game night in the data with a kickoff listed and nothing yet played on it (so "before kickoff" really is before). */
const nights = () =>
  (cached ??= inWeb(async () => {
    const { loadAlignments } = await import("../lib/alignments");
    const { loadGames } = await import("../lib/games");
    const { gameNight } = await import("../lib/game-night");
    const { loadNight } = await import("../lib/tonight");
    const games = await loadGames(await loadAlignments());
    const pick = (list: { date?: string; kickoff?: string; state: string }[], tonight: boolean): Night | undefined => {
      const dates = [...new Set(list.filter((g) => g.date && g.kickoff && g.state !== "final" && g.state !== "forfeit" && g.state !== "live").map((g) => g.date!))].sort();
      for (const date of dates) {
        const day = list.filter((g) => g.date === date);
        if (day.some((g) => ["final", "forfeit", "live"].includes(g.state))) continue;
        const first = Math.min(...day.flatMap((g) => (g.kickoff ? [Date.parse(g.kickoff)] : [])));
        if (gameNight(new Date(first - 10 * MIN)) === date && gameNight(new Date(first + 3 * 3600_000)) === date) return { date, first, tonight };
      }
      return undefined;
    };
    const night = await loadNight();
    return { board: pick(games, false), tonight: pick(night.orgs.flatMap((o) => o.rounds.flatMap((r) => r.games)), true) };
  }));

const iso = (ms: number) => new Date(ms).toISOString();
const at = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(ms));

/** Opens `url` with the clock at `now`, answering the read-time request with `body` and keeping what the page sent. */
async function open(page: Page, url: string, now: number, body: string | { status: number; body: string }) {
  const seen: { method: string; headers: Record<string, string> }[] = [];
  await page.clock.install({ time: new Date(now) });
  if (typeof body === "string") await answer(page, READ_AT_URL, body);
  else {
    await page.route(READ_AT_URL, (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" } });
      return route.fulfill({ status: body.status, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: body.body });
    });
  }
  page.on("request", (r) => r.url() === READ_AT_URL && r.method() === "POST" && seen.push({ method: r.method(), headers: r.headers() }));
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  return seen;
}

const line = (page: Page) => page.locator("[data-scores-checked]");

for (const where of ["board", "tonight"] as const) {
  const url = where === "board" ? "/scores" : "/scores/tonight";
  test.describe(`${url}`, () => {
    test("N min ago, after kickoff, from one POST with the public key; the minutes move with the clock", async ({ page }) => {
      const n = (await nights())[where];
      test.skip(!n, "no game night with a kickoff on file for this page");
      const now = n!.first + 20 * MIN;
      const seen = await open(page, url, now, JSON.stringify(iso(now - 4 * MIN)));
      await expect(line(page)).toHaveText("Scores checked 4 min ago");
      expect(seen[0].method).toBe("POST");
      expect(seen[0].headers.apikey).toBe(SUPABASE_PUBLISHABLE_KEY);
      expect(await line(page).innerText()).not.toMatch(BAD);
      const first = seen.length; // one on load (two in the dev server, which mounts every effect twice)
      await page.clock.runFor(61_000);
      await expect(line(page)).toHaveText("Scores checked 5 min ago");
      expect(seen.length).toBe(first + 1); // asked again after a minute
    });

    test("60 minutes or more: Scores checked at the time, in Central time", async ({ page }) => {
      const n = (await nights())[where];
      test.skip(!n, "no game night with a kickoff on file for this page");
      const read = n!.first + 31 * MIN;
      await open(page, url, read + 75 * MIN, JSON.stringify(iso(read)));
      await expect(line(page)).toHaveText(`Scores checked at ${at(read)} CT`);
    });

    test("more than 30 minutes past the first kickoff and no read since: Scores may be behind", async ({ page }) => {
      const n = (await nights())[where];
      test.skip(!n, "no game night with a kickoff on file for this page");
      await open(page, url, n!.first + 45 * MIN, "null");
      await expect(line(page)).toHaveText("Scores may be behind");
    });

    test("nothing before the first kickoff, and nothing is asked", async ({ page }) => {
      const n = (await nights())[where];
      test.skip(!n, "no game night with a kickoff on file for this page");
      const seen = await open(page, url, n!.first - 10 * MIN, JSON.stringify(iso(n!.first - 15 * MIN)));
      await page.clock.runFor(61_000);
      await expect(line(page)).toHaveCount(0);
      expect(seen.length).toBe(0);
    });

    test("a failed request or a bad answer shows nothing, not even an error", async ({ page }) => {
      const n = (await nights())[where];
      test.skip(!n, "no game night with a kickoff on file for this page");
      const now = n!.first + 45 * MIN;
      for (const answerTo of [{ status: 500, body: '{"message":"down"}' }, { status: 200, body: '{"message":"JWT expired"}' }, { status: 200, body: '"yesterday-ish"' }, { status: 200, body: "12" }]) {
        const fresh = await page.context().newPage();
        await open(fresh, url, now, answerTo);
        await expect(line(fresh), JSON.stringify(answerTo)).toHaveCount(0);
        await expect(fresh.locator("main")).not.toContainText(/error|failed|unavailable/i);
        await fresh.close();
      }
    });

    test("no request while the tab is hidden; one when it comes back", async ({ page }) => {
      const n = (await nights())[where];
      test.skip(!n, "no game night with a kickoff on file for this page");
      await page.addInitScript(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window as unknown as { __hidden?: boolean }).__hidden === false ? "visible" : "hidden" });
      });
      const now = n!.first + 20 * MIN;
      const seen = await open(page, url, now, JSON.stringify(iso(now - 2 * MIN)));
      await page.clock.runFor(125_000);
      expect(seen.length).toBe(0);
      await expect(line(page)).toHaveCount(0);
      await page.evaluate(() => {
        (window as unknown as { __hidden: boolean }).__hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(line(page)).toBeVisible();
      expect(seen.length).toBe(1);
    });

    test("no request and no line on a day with no game", async ({ page }) => {
      const n = (await nights())[where];
      test.skip(!n, "no game night with a kickoff on file for this page");
      const seen = await open(page, url, Date.parse("2026-07-04T18:00:00Z"), JSON.stringify(iso(Date.parse("2026-07-04T17:50:00Z"))));
      await page.clock.runFor(125_000);
      expect(seen.length).toBe(0);
      await expect(line(page)).toHaveCount(0);
    });
  });
}

test("the sample scoreboard (invented games, no dates) never asks", async ({ page }) => {
  const n = (await nights()).board;
  test.skip(!n, "no game night with a kickoff on file");
  const seen = await open(page, "/scores/sample", n!.first + 20 * MIN, "null");
  await page.clock.runFor(61_000);
  expect(seen.length).toBe(0);
  await expect(line(page)).toHaveCount(0);
});
