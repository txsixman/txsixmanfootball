import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { LIVE_SCORES_URL } from "./live-route";

// A game under way shows its live score where its score goes (ADR 0021): the scores board's cells, the game page's big
// score and the program page's next game. Dashed, "Unconfirmed", no winner, with where it stands and, when the reader has
// it, the time left: "Q3 · 4:12 left · as of 7:42 PM CT". Every request to Supabase is answered from a fixture.
test.use({ serviceWorkers: "block" });

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
const AS_OF = String.raw`as of \d{1,2}:\d{2} (AM|PM) CT`;

type Fixture = { id: string; date: string; home: string; away: string; org: string; key: string; homeSlug: string; awaySlug: string; homeProgram?: string };
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
      const g = (await loadGames(alignments)).find((x) => x.state === "scheduled" && x.date);
      if (!g) throw new Error("no unplayed bracket game to test with");
      return {
        id: g.id, date: g.date!, home: g.home.name, away: g.away.name,
        org: ORGS.find((o) => g.league === o.league || g.league.startsWith(`${o.league} `))!.label,
        key: liveKey(g.date!, g.home.name, g.away.name), homeSlug: slugify(g.home.name), awaySlug: slugify(g.away.name),
        homeProgram: alignments.find((a) => a.school === g.home.name)?.slug,
      };
    } finally {
      process.chdir(was);
    }
  })());

/** Home 28, away 14, third quarter, 4:12 left (the clock column), read now. */
async function serveLive(page: Page, f: Fixture, over: Record<string, unknown> = {}) {
  const row = { game_key: f.key, home: f.homeSlug, away: f.awaySlug, home_score: 28, away_score: 14, period: "Q3", clock: "4:12", read_at: new Date().toISOString(), ...over };
  await page.route(LIVE_SCORES_URL, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify([row]) }),
  );
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
