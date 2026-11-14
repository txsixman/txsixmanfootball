import { expect, test } from "@playwright/test";
import path from "node:path";
import { noLiveScores } from "./live-route";

// What was projected beside what happened (ADR 0044), on every list a played game is on: /scores, its game page, Results and
// the program pages. A played game's projection is the one from the week before it (lib/pregame.ts), never today's ratings.

noLiveScores(test);

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

const PROJECTION = String.raw`Projected: .+ by (\d+|45\+|less than 1) · (>99|<1|\d+)% chance to win`;
const OUTCOME = String.raw`(Final: .+ by \d+|Final: tied|Forfeit|Disputed)`;
const PLAYED = new RegExp(`^${PROJECTION} · ${OUTCOME}$`);
const EITHER = new RegExp(`^${PROJECTION}( · ${OUTCOME})?$`);
const BETTING = /\b(upset|spread|odds|lines?|bets?|betting|cover|covers)\b/i;

/** A played playoff game's line, worked out on its own: its projection from the week before it, beside its final. */
const expected = (id: string) =>
  inWeb(async () => {
    const { loadAlignments } = await import("../lib/alignments");
    const { gameKey, loadGames } = await import("../lib/games");
    const { outcomeOf } = await import("../lib/score-display");
    const { projectedLine } = await import("../lib/outcome");
    const { pregameShown, projectBefore } = await import("../lib/pregame");
    const { projectionText } = await import("../lib/projection");
    const { loadRatings } = await import("../lib/ratings");
    const g = (await loadGames(await loadAlignments())).find((x) => x.id === id)!;
    const season = Number(g.date!.slice(0, 4));
    const before = (await pregameShown(season)).byKey.get(gameKey(g.date!, g.home.name, g.away.name))!;
    // The same, straight from the season's table: the week before the game, with the playoff home edge.
    const direct = projectBefore(await loadRatings(season), { date: g.date!, home: g.home.name, away: g.away.name }, true)!;
    return { line: projectedLine(g.projected, outcomeOf(g))!, before: projectionText(before), direct: projectionText(direct) };
  });

test("a played playoff game shows its week-before projection beside its final, on /scores and on its page", async ({ page }) => {
  await page.goto("/scores");
  const lines = await page.locator("[data-projected]").allTextContents();
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line).toMatch(EITHER);
  expect(lines.join(" ").replace(/chance to win/g, "")).not.toMatch(BETTING);

  const row = page.locator("li[data-game]").filter({ has: page.locator("[data-projected]", { hasText: / · Final: / }) }).first();
  // The board's games change with the season: before the first playoff final there is none to check.
  if (!(await row.count())) {
    console.log("skipped: no played playoff game with a projection on /scores yet");
    test.skip(true, "no played playoff game with a projection on /scores yet");
  }
  const id = (await row.getAttribute("data-game"))!;
  const shown = await row.locator("[data-projected]").textContent();
  const f = await expected(id);
  expect(shown).toBe(f.line);
  expect(f.direct).toBe(f.before);
  expect(f.line.startsWith(`Projected: ${f.before} · Final: `)).toBe(true); // the projection from before the game

  await page.goto(`/scores/${id}`);
  await expect(page.locator("[data-projected]")).toHaveText(f.line);
});

test("Results rows show each game's projection beside its outcome", async ({ page }) => {
  await page.goto("/results/2025/9");
  const lines = await page.locator("[data-projected]").allTextContents();
  expect(lines.length).toBeGreaterThan(10);
  for (const line of lines) expect(line).toMatch(PLAYED);
  await expect(page.getByText(/upset/i)).toHaveCount(0);
});

/** A program with a played game that has a projection in `season`, picked from the data, never a named team. */
const programWithProjected = (season: number) =>
  inWeb(async () => {
    const { loadAlignments, programFor } = await import("../lib/alignments");
    const { loadSeasonResults } = await import("../lib/games");
    const { shownBefore } = await import("../lib/pregame");
    const [all, results, { before }] = await Promise.all([loadAlignments(), loadSeasonResults(season), shownBefore(season)]);
    for (const r of results) {
      const slug = before.has(r.id) && programFor(all, r.home)?.slug;
      if (slug) return slug;
    }
    return undefined;
  });

test("a program's season page and its current page show each projection beside the outcome", async ({ page }) => {
  const { CURRENT_SEASON } = await import("../lib/season");
  const past = await programWithProjected(2025);
  expect(past, "a 2025 program with a projected game").toBeTruthy();
  await page.goto(`/programs/${past}/2025`);
  const then = await page.locator("[data-projected]").allTextContents();
  expect(then.length).toBeGreaterThan(0);
  for (const line of then) expect(line).toMatch(PLAYED);

  const current = await programWithProjected(CURRENT_SEASON);
  if (!current) {
    console.log(`skipped: no ${CURRENT_SEASON} program with a played, projected game yet`);
    test.skip(true, `no ${CURRENT_SEASON} program with a played, projected game yet`);
  }
  await page.goto(`/programs/${current}`);
  const now = await page.locator("[data-projected]").allTextContents();
  expect(now.length).toBeGreaterThan(0);
  for (const line of now) expect(line).toMatch(EITHER);
  expect(now.some((line) => PLAYED.test(line))).toBe(true);
});
