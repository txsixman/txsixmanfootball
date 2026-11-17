import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { FIRST_SEASON } from "../lib/season";
import { MIN_MEETINGS, seriesHref } from "../lib/series";
import { noLiveScores } from "./live-route";

// The preview on a game not yet played (/scores/<id>, ADR 0088): each team's last five games with links, the projection and how it
// is made, head-to-head and the last meeting, the opponents both met, the next round, and at a State Championship
// each team's earlier ones. Every expectation comes from the same lib the site is built from, on the games the bracket sets
// this season; no request reaches Supabase.
noLiveScores(test);
test.setTimeout(120_000);

// The game being previewed names no winner; a played game's mark is "Win" or "Loss" to a screen reader.
const BETTING_OR_SOURCE = /\b(spreads?|odds|lines?|bets?|bettors?|favou?rites?|underdogs?|locks?|upsets?|sources?|maxpreps)\b/i;
const plain = (text: string) => text.replace(/win probability|chance to win/gi, "");

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
  const { bracketGames, builtGamePages, gamePreview, resolveGame } = await import("../lib/game-pages");
  const { orgOfLabel } = await import("../lib/orgs");
  const { STATE_ROUNDS } = await import("../lib/state-finals");
  const { CURRENT_SEASON } = await import("../lib/season");
  const games = [...(await bracketGames()), ...(await builtGamePages())].filter((g) => g.state === "scheduled" && g.id.startsWith(`${CURRENT_SEASON}-`));
  const all = (
    await Promise.all(
      games.map(async (g) => {
        const resolved = await resolveGame(g.id);
        if (!resolved?.detail) return [];
        const preview = await gamePreview({ season: CURRENT_SEASON, date: g.date ?? "9999-12-31", home: g.home.name, away: g.away.name, org: orgOfLabel(g.league), detail: resolved.detail, round: g.round });
        return [{ game: g, detail: resolved.detail, preview, built: resolved.built, state: STATE_ROUNDS.has(g.round ?? "") }];
      }),
    )
  ).flat();
  return {
    path: all.find((s) => s.preview.next && s.preview.away.last.length && s.preview.home.last.length),
    nextWithDay: all.find((s) => s.preview.next?.date),
    meeting: all.find((s) => s.detail.meetings.total > 0),
    series: all.find((s) => s.detail.meetings.total >= MIN_MEETINGS),
    state: all.find((s) => s.state && s.preview.history),
    undated: all.find((s) => s.built && !s.game.date),
    noEdge: all.find((s) => s.built || s.state),
    edge: all.find((s) => !s.built && !s.state),
    count: all.length,
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
    short: [...document.querySelectorAll("main a, main button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44;
    }).map((el) => `${el.textContent?.trim().slice(0, 40)} (${Math.round(el.getBoundingClientRect().height)}px)`),
  }));
  expect(m).toEqual({ overflow: 0, short: [] });
  expect(errors).toEqual([]);
}

const previewOf = (page: Page) => page.getByRole("region", { name: "Preview", exact: true });

test("an upcoming playoff game lists each team's last five games, each linking to its page, scores from the team's own side", async ({ page }) => {
  const { path: s } = await fixtures();
  test.skip(!s, "no upcoming playoff game with both teams' results and a next round");
  const { game: g, preview } = s!;
  await checkPage(page, `/scores/${g.id}`);
  const box = previewOf(page).getByRole("region", { name: "Last five games" });
  await expect(box).toBeVisible();
  const lists = box.getByRole("list");
  const sides = [preview.away, preview.home].filter((x) => x.last.length > 0);
  await expect(lists).toHaveCount(sides.length);
  for (const [i, side] of sides.entries()) {
    await expect(box.getByRole("heading", { name: side.team, level: 4 })).toBeVisible();
    const links = lists.nth(i).getByRole("link");
    await expect(links).toHaveCount(side.last.length);
    expect(side.last.length).toBeLessThanOrEqual(5);
    expect(await links.evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(side.last.map((x) => x.href));
    for (const [j, x] of side.last.entries()) {
      await expect(links.nth(j)).toContainText(x.opponent);
      await expect(links.nth(j)).toContainText(x.score);
      // Newest first, every one before the game.
      expect(x.date < (g.date ?? "9999-12-31")).toBe(true);
      if (j > 0) expect(x.date <= side.last[j - 1].date).toBe(true);
    }
  }
  const text = plain(await page.locator("main").innerText());
  expect(text).not.toMatch(BETTING_OR_SOURCE);
});

test("the next round: the round, the opponent as one of two teams, the day and site only when the league lists them", async ({ page }) => {
  const { path: s, nextWithDay } = await fixtures();
  test.skip(!s, "no upcoming playoff game with a next round");
  await page.goto(`/scores/${s!.game.id}`);
  const next = s!.preview.next!;
  const box = previewOf(page).getByRole("region", { name: "Next round" });
  await expect(box).toBeVisible();
  await expect(box).toContainText(next.label);
  if (next.other) await expect(box).toContainText(next.other.text);
  if (s!.preview.bracket) await expect(box.getByRole("link", { name: "Full bracket" })).toHaveAttribute("href", s!.preview.bracket);
  // Nothing is invented: no day, no "When" row.
  if (!next.date) await expect(box.getByText("When", { exact: true })).toHaveCount(0);
  if (!next.site) await expect(box.getByText("Where", { exact: true })).toHaveCount(0);
  if (nextWithDay) {
    await page.goto(`/scores/${nextWithDay.game.id}`);
    await expect(previewOf(page).getByRole("region", { name: "Next round" }).getByText("When", { exact: true })).toBeVisible();
  }
});

test("head-to-head says how often and when they last met, and the projection says whether a home edge is in it", async ({ page }) => {
  const { meeting, noEdge, edge } = await fixtures();
  test.skip(!meeting, "no upcoming playoff game whose teams have met");
  await page.goto(`/scores/${meeting!.game.id}`);
  const h2h = previewOf(page).getByRole("region", { name: `Head-to-head since ${FIRST_SEASON}` });
  const { total, list } = meeting!.detail.meetings;
  await expect(h2h).toContainText(total === 1 ? "Met once" : `Met ${total} times`);
  await expect(h2h).toContainText("Last meeting:");
  await expect(h2h.getByRole("link").first()).toHaveAttribute("href", list[0].result.href);
  for (const [s, words] of [[noEdge, "neither team a home edge"], [edge, "home edge for the listed home team"]] as const) {
    if (!s?.game.projected) continue;
    await page.goto(`/scores/${s.game.id}`);
    await expect(previewOf(page)).toContainText(words);
    await expect(previewOf(page).getByRole("link", { name: "How ratings work" })).toHaveAttribute("href", "/rankings/how");
  }
});

test("a preview whose teams have met twice links to all their meetings", async ({ page }) => {
  const { series } = await fixtures();
  test.skip(!series, "no upcoming playoff game whose teams have met twice");
  const { game: g, detail } = series!;
  await page.goto(`/scores/${g.id}`);
  const link = previewOf(page).getByRole("link", { name: /^All \d+ meetings/ });
  await expect(link).toHaveText(`All ${detail.meetings.total} meetings of ${g.away.name} and ${g.home.name}`);
  const { slugOf } = await inWeb(async () => ({ slugOf: (await import("../lib/slug")).slugify }));
  await expect(link).toHaveAttribute("href", seriesHref(slugOf(g.away.name), slugOf(g.home.name)));
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The link sits beside the head-to-head list, which still holds the meetings themselves.
  await expect(previewOf(page).getByRole("region", { name: `Head-to-head since ${FIRST_SEASON}` }).getByRole("link", { name: /^All \d+ meetings/ })).toHaveCount(0);
  // One link to the page, not two: the preview's replaces the line a game with no preview has below it.
  await expect(page.getByRole("link", { name: new RegExp(`game since ${FIRST_SEASON}$`) })).toHaveCount(0);
  await link.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/ vs /);
  expect(detail.meetings.total).toBe(await page.locator("section[aria-labelledby=meetings] > ul > li").count());
});

test("a State Championship previews each team's earlier State Championships, and no path past it", async ({ page }) => {
  const { state } = await fixtures();
  test.skip(!state, "no State Championship with both teams known");
  await checkPage(page, `/scores/${state!.game.id}`);
  const box = previewOf(page).getByRole("region", { name: "State Championship history" });
  await expect(box).toBeVisible();
  for (const h of state!.preview.history!) {
    await expect(box.getByRole("heading", { name: h.team, level: 4 })).toBeVisible();
  }
  const first = state!.preview.history![0];
  if (first.past.length) await expect(box).toContainText(`${first.past.length === 1 ? "1 State Championship appearance" : `${first.past.length} State Championship appearances`} on record`);
  else await expect(box).toContainText("No earlier State Championship on record.");
  await expect(previewOf(page).getByRole("region", { name: "Next round" })).toHaveCount(0);
  // A game that is not a State Championship has no history section.
  const { path: other } = await fixtures();
  if (other && !other.state) {
    await page.goto(`/scores/${other.game.id}`);
    await expect(previewOf(page).getByRole("region", { name: "State Championship history" })).toHaveCount(0);
  }
});

test("a game the bracket sets with no day yet still has a preview", async ({ page }) => {
  const { undated } = await fixtures();
  test.skip(!undated, "every game the bracket sets has a day");
  await page.goto(`/scores/${undated!.game.id}`);
  await expect(previewOf(page)).toBeVisible();
  await expect(previewOf(page).getByRole("region", { name: "Last five games" })).toBeVisible();
  await expect(page.getByText("Date not listed yet").first()).toBeVisible();
});

test("the longer preview fits a phone: no sideways scroll", async ({ page }) => {
  const { state, path: s } = await fixtures();
  test.skip(!state && !s, "no upcoming playoff game");
  await page.setViewportSize({ width: 375, height: 812 });
  for (const x of [state, s]) {
    if (!x) continue;
    await page.goto(`/scores/${x.game.id}`, { waitUntil: "networkidle" });
    await expect(previewOf(page)).toBeVisible();
    const wide = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, inside: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length }));
    expect(wide).toEqual({ page: 0, inside: 0 });
  }
});
