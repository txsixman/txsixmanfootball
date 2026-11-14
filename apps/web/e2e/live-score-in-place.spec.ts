import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { LIVE_SCORES_URL } from "./live-route";

// A game under way shows its live score where its score goes (ADR 0021): the scores board's cells, the game page's big
// score and the program page's next game. Dashed, "Unconfirmed", no winner, with where it stands and, when the reader has
// it, the time left: "Q3 · 4:12 left · as of 7:42 PM CT". Every request to Supabase is answered from a fixture.
test.use({ serviceWorkers: "block" });

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
const AS_OF = String.raw`as of \d{1,2}:\d{2} (AM|PM) CT`;

type Fixture = { id: string; date: string; kickoff: string; home: string; away: string; org: string; key: string; homeSlug: string; awaySlug: string; homeProgram?: string };
let cached: Promise<Fixture> | undefined;
/** A bracket game not yet played, from the loaders (they read ../../data from apps/web). */
const fixture = () =>
  (cached ??= (async () => {
    const was = process.cwd();
    process.chdir(path.join(__dirname, ".."));
    try {
      const { loadAlignments } = await import("../lib/alignments");
      const { loadGames } = await import("../lib/games");
      const { liveKey } = await import("../lib/live-scores");
      const { ORGS } = await import("../lib/orgs");
      const { slugify } = await import("../lib/slug");
      const alignments = await loadAlignments();
      // The live read runs only from kickoff (lib/kickoff.ts): a game with a known kickoff, the earliest, so the hours before
      // it hold no game in progress anywhere.
      const g = (await loadGames(alignments)).filter((x) => x.state === "scheduled" && x.date && x.kickoff).sort((a, b) => a.kickoff!.localeCompare(b.kickoff!))[0];
      if (!g) throw new Error("no unplayed bracket game with a kickoff to test with");
      return {
        id: g.id, date: g.date!, kickoff: g.kickoff!, home: g.home.name, away: g.away.name,
        org: ORGS.find((o) => g.league === o.league || g.league.startsWith(`${o.league} `))!.label,
        key: liveKey(g.date!, g.home.name, g.away.name), homeSlug: slugify(g.home.name), awaySlug: slugify(g.away.name),
        homeProgram: alignments.find((a) => a.school === g.home.name)?.slug,
      };
    } finally {
      process.chdir(was);
    }
  })());

/** Half an hour after kickoff: inside the game's in-progress window. */
const inWindow = (f: Fixture) => new Date(Date.parse(f.kickoff) + 30 * 60_000);

/** Home 28, away 14, third quarter, 4:12 left (the clock column), read half an hour after kickoff. The page's clock is set
 * there too (`at`, else inside the window). Returns the live_scores requests made. */
async function serveLive(page: Page, f: Fixture, over: Record<string, unknown> = {}, at = inWindow(f)) {
  const row = { game_key: f.key, home: f.homeSlug, away: f.awaySlug, home_score: 28, away_score: 14, period: "Q3", clock: "4:12", read_at: inWindow(f).toISOString(), ...over };
  const seen: string[] = [];
  await page.clock.install({ time: at });
  await page.route(LIVE_SCORES_URL, (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    seen.push(route.request().url());
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify([row]) });
  });
  return seen;
}

const noWinner = async (page: Page, scope = page.locator("body")) => {
  await expect(scope.locator("[aria-hidden='true']", { hasText: "◀" })).toHaveCount(0);
  expect((await scope.innerText()).toLowerCase()).not.toMatch(/\b(winner|leading)\b/);
};

test("scores board: the live score is in the game's own cells, under Live, with the time left and when it was read", async ({ page }) => {
  const f = await fixture();
  await serveLive(page, f);
  await page.goto("/scores", { waitUntil: "networkidle" });
  const tab = page.getByRole("button", { name: f.org, exact: true });
  // Clicked until it takes: a click before the board hydrates does nothing.
  if (await tab.count()) await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass();
  const row = page.locator("#live").locator(`li[data-game="${f.id}"]`);
  await expect(row.locator(".decoration-dashed")).toHaveText(["14", "28"], { timeout: 15_000 });
  await expect(row.locator("[data-live-score]")).toHaveText(new RegExp(`^Q3 · 4:12 left · ${AS_OF}$`));
  await expect(row).toContainText(/Unconfirmed/i);
  await expect(row).not.toContainText(/no score|Projected/i);
  await noWinner(page, row);
});

test("game page: the big score holds the live score, dashed, with Live, the period, the time left and Unconfirmed, once", async ({ page }) => {
  const f = await fixture();
  await serveLive(page, f);
  await page.goto(`/scores/${f.id}`);
  const score = page.getByRole("region", { name: "Score" });
  await expect(score.locator(".decoration-dashed")).toHaveText(["14", "28"], { timeout: 15_000 });
  await expect(score).not.toContainText(/no score/);
  await expect(page.locator("[data-live-score]")).toHaveText(new RegExp(`^Live · Q3 · 4:12 left · ${AS_OF} · Unconfirmed$`));
  // The score shows once: in the big score, not again in a banner.
  await expect(page.getByText("14–28")).toHaveCount(0);
  await noWinner(page);
});

test("program page: the next game, while under way, shows its live score from the school's side in the box and the row", async ({ page }) => {
  const f = await fixture();
  test.skip(!f.homeProgram, "the home team has no program page");
  await serveLive(page, f, { clock: null });
  await page.goto(`/programs/${f.homeProgram}`);
  const box = page.getByRole("region", { name: "Next and latest game" });
  await expect(box.locator("[data-live-score]")).toHaveText(new RegExp(`^Live · 28-14 · Q3 · ${AS_OF} · Unconfirmed$`), { timeout: 15_000 });
  // Its row in this season's games: the score where the arrow was, dashed.
  await expect(page.locator(`li a[href="/scores/${f.id}"] .decoration-dashed`)).toHaveText(/^28-14/);
  await noWinner(page, box);
});

test("with no game in its kickoff window, the game page and the program page ask for nothing", async ({ page }) => {
  const f = await fixture();
  test.skip(!f.homeProgram, "the home team has no program page");
  const kickoff = Date.parse(f.kickoff);
  // Before kickoff, and after its four-hour window: no live_scores call, no live score.
  for (const at of [new Date(kickoff - 10 * 3600_000), new Date(kickoff + 5 * 3600_000)]) {
    await page.unrouteAll();
    const seen = await serveLive(page, f, {}, at);
    for (const url of [`/scores/${f.id}`, `/programs/${f.homeProgram}`]) {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.clock.runFor(3 * 60_000);
      expect(seen, `${url} at ${at.toISOString()}`).toHaveLength(0);
      await expect(page.locator("[data-live-score]")).toHaveCount(0);
    }
  }
});

test("the program page makes one live read a minute in the window, shared by its next-game box and its row", async ({ page }) => {
  const f = await fixture();
  test.skip(!f.homeProgram, "the home team has no program page");
  const seen = await serveLive(page, f);
  await page.goto(`/programs/${f.homeProgram}`);
  await expect(page.locator("[data-live-score]")).toHaveCount(2, { timeout: 15_000 }); // the box and the row
  const first = seen.length;
  await page.clock.runFor(61_000);
  await expect.poll(() => seen.length).toBe(first + 1);
});

test("a game with no kickoff time is read through its game date's evening, 5:00 PM to midnight Central, and at no other time", async ({ page }) => {
  const g = await untimed();
  test.skip(!g, "every unplayed bracket game has a kickoff time");
  // 5:00 PM Central on the game date, in UTC: the date's 17:00 Central, whatever the daylight offset.
  const evening = (date: string, hour: number) => new Date(Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`) + offsetHours(date) * 3600_000);
  const nextDay = new Date(Date.parse(`${g!.date}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
  for (const [at, reads] of [
    [evening(g!.date, 19), true],
    [evening(g!.date, 15), false],
    [evening(nextDay, 19), false],
  ] as const) {
    await page.unrouteAll();
    const seen = await serveLive(page, { ...g!, kickoff: at.toISOString() }, { read_at: at.toISOString() }, at);
    await page.goto(`/scores/${g!.id}`, { waitUntil: "networkidle" });
    await page.clock.runFor(61_000);
    if (reads) await expect.poll(() => seen.length, `${at.toISOString()}`).toBeGreaterThan(0);
    else expect(seen, `${at.toISOString()}`).toHaveLength(0);
  }
});

/** Hours Central is behind UTC on `date` (6 in standard time, 5 in daylight time). */
const offsetHours = (date: string) => {
  const noon = new Date(`${date}T12:00:00Z`);
  return 12 - Number(noon.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }));
};

let untimedCache: Promise<Fixture | undefined> | undefined;
/** A bracket game not yet played and with no kickoff time, from the loaders. */
const untimed = () =>
  (untimedCache ??= (async () => {
    const was = process.cwd();
    process.chdir(path.join(__dirname, ".."));
    try {
      const { loadAlignments } = await import("../lib/alignments");
      const { loadGames } = await import("../lib/games");
      const { liveKey } = await import("../lib/live-scores");
      const { slugify } = await import("../lib/slug");
      const g = (await loadGames(await loadAlignments())).find((x) => x.state === "scheduled" && x.date && !x.kickoff);
      return g && { id: g.id, date: g.date!, kickoff: "", home: g.home.name, away: g.away.name, org: "", key: liveKey(g.date!, g.home.name, g.away.name), homeSlug: slugify(g.home.name), awaySlug: slugify(g.away.name) };
    } finally {
      process.chdir(was);
    }
  })());
