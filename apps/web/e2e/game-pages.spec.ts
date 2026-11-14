import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";
import path from "node:path";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// A page for every robot-read game (/scores/<id>, all seasons): teams, score, status words, the week-before projection,
// earlier meetings, and the lists that link to it. Fixtures come from the same lib the site is built from.

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

type Fixtures = Awaited<ReturnType<typeof build>>;
let cached: Promise<Fixtures> | undefined;
const fixtures = () => (cached ??= inWeb(build));

async function build() {
  const { loadSeasonResults } = await import("../lib/games");
  const { pregame } = await import("../lib/pregame");
  const { gameDetail, resultPageIds } = await import("../lib/game-pages");
  const { loadWeeks, resultSeasons } = await import("../lib/weeks");
  const { loadAlignments, programFor } = await import("../lib/alignments");
  const { projectionParts } = await import("../lib/projection");
  const results = await loadSeasonResults(2025);
  const judged = await pregame(2025);
  const detail = (r: (typeof results)[number]) => gameDetail({ season: 2025, date: r.date, home: r.home, away: r.away, id: r.id });
  const withMeetings = async (test: (r: (typeof results)[number]) => boolean) => {
    for (const r of results) if (test(r) && (await detail(r)).meetings.total >= 2) return r;
    throw new Error("no fixture game");
  };
  // A game the ratings projected (both teams had four games) with earlier meetings, a forfeit, and a game too early to project.
  const projected = await withMeetings((r) => judged.has(r.id) && !r.forfeit);
  const forfeit = await withMeetings((r) => r.forfeit);
  const early = results.find((r) => !judged.has(r.id) && !r.forfeit)!;
  // A game whose earlier meetings include a forfeit.
  let afterForfeit: (typeof results)[number] | undefined;
  for (const r of results) {
    if ((await detail(r)).meetings.list.some((m) => m.result.forfeit)) {
      afterForfeit = r;
      break;
    }
  }
  const seasons = await resultSeasons();
  const all = (await Promise.all(seasons.map((s) => loadSeasonResults(s)))).flat();
  // A current-season regular game between two programs (its schedule row is on a program page), and a current-season game
  // that is also a playoff game (one page, the bracket game's).
  const alignments = await loadAlignments();
  const current = await loadSeasonResults(2026);
  const regular = current.find((r) => r.href === `/scores/${r.id}` && programFor(alignments, r.home) && programFor(alignments, r.away))!;
  const playoff = current.find((r) => r.href !== `/scores/${r.id}`)!;
  const weeks2025 = await loadWeeks(2025);
  return {
    projected, forfeit, early, afterForfeit, regular, playoff,
    projectedText: projectionParts(judged.get(projected.id)!),
    weekOf: (id: string) => weeks2025.find((w) => w.games.some((g) => g.id === id))!.number,
    programSlug: (name: string) => programFor(alignments, name)!.slug,
    all,
    pageIds: await resultPageIds(),
    meetingsOf: async (r: (typeof results)[number]) => (await detail(r)).meetings.list.map((m) => m.result),
  };
}

async function checkPage(page: Page, url: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response?.status(), url).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button, main input")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44 && !el.matches("input");
    }).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0 });
  expect(errors).toEqual([]);
}

const NO_SOURCE_OR_BETTING = /\b(spreads?|odds|lines?|bets?|bettors?|sources?|maxpreps)\b/i;
// A final names its winner (ADR 0040), marked on the score and read out as "winner"; no other winner word is written.
// "Win probability" is the projection's own phrase.
const WINNER_WORDS = /\b(won|beat|beats|defeated|defeats|winner|wins|victory|loser|lost)\b/i;
const withoutProjectionPhrase = (text: string) => text.replace(/win probability/gi, "");

test.setTimeout(120_000);

test("a regular-season game page shows the teams and the final score, the winner marked", async ({ page }) => {
  const { projected: r } = await fixtures();
  await checkPage(page, r.href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${r.away} vs ${r.home}`);
  const score = page.getByRole("region", { name: "Score" });
  await expect(score).toContainText(r.away);
  await expect(score).toContainText(r.home);
  expect(((await score.innerText()).replace(/\s*winner/g, "").match(/^\d+$/gm) ?? [])).toEqual([String(r.awayScore), String(r.homeScore)]); // away first
  await expect(page.getByText("Unconfirmed", { exact: false })).toHaveCount(0);
  const winner = r.homeScore > r.awayScore ? r.home : r.away;
  if (r.homeScore !== r.awayScore) {
    await expect(score.getByText("winner", { exact: false })).toHaveCount(1);
    await expect(score.locator("div.border-b").filter({ hasText: /\bwinner\b/ })).toContainText(winner);
  }
  const text = withoutProjectionPhrase((await page.locator("main").innerText()).replace(/\bwinner\b/g, ""));
  expect(text).not.toMatch(WINNER_WORDS);
  expect(text).not.toMatch(NO_SOURCE_OR_BETTING);
  await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
});

test("a forfeit game page says Forfeit and never shows the recorded 1-0 or 2-0", async ({ page }) => {
  const { forfeit: r } = await fixtures();
  await checkPage(page, r.href);
  await expect(page.getByText("Forfeit", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Forfeit. No score was played.")).toBeVisible();
  const score = await page.getByRole("region", { name: "Score" }).innerText();
  expect(score.match(/^\d+$/gm) ?? []).toEqual([]); // no big number for either team
  expect(await page.locator("head title").textContent()).not.toMatch(/\b\d+-\d+\b/); // no score in the title either
  await expect(page.getByRole("region", { name: /Projection/ })).toHaveCount(0); // a forfeit is never judged
});

test("a game after a forfeit lists it as the word, not the score", async ({ page }) => {
  const { afterForfeit } = await fixtures();
  test.skip(!afterForfeit, "no game with a forfeit among its earlier meetings");
  await page.goto(afterForfeit!.href);
  const row = page.getByRole("region", { name: "Earlier meetings" }).getByRole("listitem").filter({ hasText: "Forfeit" });
  await expect(row.first()).toBeVisible();
  await expect(row.first()).not.toContainText(/\b[0-2]-[0-2]\b/);
});

test("the week-before projection shows once both teams had four games, and how far the result was from it", async ({ page }) => {
  const { projected: r, early, projectedText } = await fixtures();
  await page.goto(r.href);
  const projection = page.getByRole("region", { name: "Projection before the game" });
  await expect(projection).toContainText(projectedText.margin);
  await expect(projection).toContainText(projectedText.chance);
  await expect(projection).toContainText(/finished (about as projected|\d+ points (better|worse) than the projected margin)/);
  await expect(projection).toContainText("A projection, not a result.");
  const going = page.getByRole("region", { name: "Going in" });
  await expect(going.getByRole("columnheader")).toHaveText(["Team", "Record", "Rating"]);
  // Too early in the season to judge: no projection, but still the page.
  await page.goto(early.href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${early.away} vs ${early.home}`);
  await expect(page.getByRole("region", { name: "Projection before the game" })).toHaveCount(0);
});

test("earlier meetings link to their own game pages", async ({ page }) => {
  const { projected: r, meetingsOf } = await fixtures();
  const expected = await meetingsOf(r);
  await page.goto(r.href);
  const list = page.getByRole("region", { name: "Earlier meetings" });
  const links = list.getByRole("link");
  await expect(links).toHaveCount(expected.length);
  expect(await links.evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(expected.map((m) => m.href));
  for (const m of expected) expect(m.date < r.date).toBe(true); // earlier only, newest first
  await links.first().click();
  await expect(page).toHaveURL(expected[0].href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${expected[0].away} vs ${expected[0].home}`);
});

test("a results row and a program schedule row link to the game page", async ({ page }) => {
  const { projected: r, weekOf, regular, programSlug } = await fixtures();
  await page.goto(`/results/2025/${weekOf(r.id)}`);
  const row = page.getByRole("link", { name: new RegExp(`^${r.away} vs ${r.home}, .*game page$`) });
  await expect(row).toHaveAttribute("href", r.href);
  await row.click();
  await expect(page).toHaveURL(r.href);

  await page.goto(`/programs/${programSlug(regular.home)}`);
  const schedule = page.getByRole("region", { name: /2026 games/ });
  const game = schedule.locator(`a[href="${regular.href}"]`);
  await expect(game).toHaveCount(1);
  await expect(game).toHaveAccessibleName(/game page$/);
  // The opponent keeps its own link on the same row.
  await expect(schedule.getByRole("listitem").filter({ has: page.locator(`a[href="${regular.href}"]`) }).getByRole("link", { name: regular.away, exact: true })).toHaveAttribute("href", `/programs/${programSlug(regular.away)}`);
  await game.click();
  await expect(page).toHaveURL(regular.href);
});

test("every link on a game page returns 200", async ({ page, request }) => {
  const { projected: r } = await fixtures();
  await page.goto(r.href);
  const hrefs = await page.locator("main a[href^='/']").evaluateAll((a) => [...new Set(a.map((x) => x.getAttribute("href")!))]);
  expect(hrefs.length).toBeGreaterThan(4);
  for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);
});

test("a current-season playoff game has one page, the bracket game's, with the projection and meetings added", async ({ page, request }) => {
  const { playoff: r } = await fixtures();
  expect(r.href).not.toBe(`/scores/${r.id}`);
  expect((await request.get(`/scores/${r.id}`)).status()).toBe(404); // no second page for the same game
  await checkPage(page, r.href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${r.away} vs ${r.home}`);
  await expect(page.getByRole("region", { name: "Earlier meetings" })).toBeVisible();
  const hrefs = await page.locator("main a[href^='/']").evaluateAll((a) => [...new Set(a.map((x) => x.getAttribute("href")!))]);
  for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);
});

test("every robot-read game has exactly one address", async () => {
  const { all, pageIds } = await fixtures();
  const hrefs = all.map((g) => g.href);
  expect(new Set(hrefs).size).toBe(hrefs.length); // no two games share a page
  expect(new Set(all.map((g) => g.id)).size).toBe(all.length);
  const own = all.filter((g) => g.href === `/scores/${g.id}`).map((g) => g.id).sort();
  expect([...pageIds].sort()).toEqual(own); // a page for each, the playoff games' pages built from the bracket instead
  expect(all.length - own.length).toBeLessThan(200); // only current-season playoff games are folded into bracket pages
});
