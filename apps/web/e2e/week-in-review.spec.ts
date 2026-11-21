import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { noLiveScores } from "./live-route";
import { ORGS } from "../lib/orgs";
import { CURRENT_SEASON, FIRST_SEASON } from "../lib/season";
import { SITE_NAME } from "../lib/site";

// The week in review (/weeks, /weeks/<season>/<week>[/<org>]): every expectation comes from the same lib the site is built from.
// The pages are static, and no request reaches Supabase (e2e/live-route.ts).
noLiveScores(test);
test.setTimeout(180_000);

// A final is confirmed (ADR 0040), so the recap names who won ("Final: X by 3", "Has now won 5 games in a row"); but no row ever
// says "winner", "leading" or "ahead", the words of a game still being played (ADR 0092). "chance to win" is the projection's own phrase.
const WINNER_WORDS = /\b(winner|winners|leads?|leading|ahead)\b/i;
const BETTING_OR_SOURCE = /\b(spreads?|odds|lines?|bets?|bettors?|favou?rites?|underdogs?|locks?|sources?|maxpreps)\b/i;
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
  const { activeOrgs } = await import("../lib/active-orgs");
  const { ORGS } = await import("../lib/orgs");
  const { resultSeasons } = await import("../lib/weeks");
  const { latestReview, loadWeekReview, reviewPages } = await import("../lib/week-review-load");
  const { chanceText } = await import("../lib/projection");
  const { aOrAn, plural } = await import("../lib/plural");
  const { weekHref } = await import("../lib/week-review-hrefs");
  const orgs = await activeOrgs();
  const uil = ORGS[0];
  const latest = (await latestReview())!;
  const review = (await loadWeekReview(uil, latest.season, latest.week))!;
  const pages = new Map(await Promise.all(orgs.map(async (o) => [o, await reviewPages(o)] as const)));
  const everyReview = async (org: (typeof orgs)[number], pick: (r: NonNullable<Awaited<ReturnType<typeof loadWeekReview>>>) => boolean) => {
    for (const p of pages.get(org)!) {
      const r = await loadWeekReview(org, p.season, p.week);
      if (r && pick(r)) return r;
    }
    return undefined;
  };
  const seasonCards = (await Promise.all(orgs.map(async (o) => (await resultSeasons(o)).map((s) => `/weeks/card/${s}/${o.slug}/opengraph-image`)))).flat();
  return {
    orgs,
    chanceText,
    aOrAn,
    plural,
    uil,
    latest,
    review,
    weekHref,
    seasonCards,
    // One week of each kind: a bracket round with advancement, a forfeit, a week before ratings are tracked, another organization.
    withAdvance: await everyReview(uil, (r) => r.advanced.some((a) => a.wentOn.length > 0)),
    withForfeit: await everyReview(uil, (r) => r.games.some((g) => g.forfeit)),
    untracked: await everyReview(uil, (r) => !r.tracked),
    withUpset: await everyReview(uil, (r) => r.upsets.length > 1),
    withStreak: await everyReview(uil, (r) => r.streaks.some((s) => s.change === "ended") && r.streaks.some((s) => s.change === "reached")),
    withFirsts: await everyReview(uil, (r) => new Set(r.milestones.map((m) => m.kind)).size > 1),
    withDispute: await everyReview(uil, (r) => r.disputed.size > 0),
    other: orgs.length > 1 ? await everyReview(orgs[1], (r) => r.games.length > 3) : undefined,
    pageCount: [...pages.values()].reduce((n, p) => n + p.length, 0),
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

/** The words a week page must never carry: a winner named from an unconfirmed score, betting, a data source, the codename. */
async function checkWords(page: Page, teams: string[] = []) {
  // A school's own name may hold such a word (Victory Christian Academy): leave the teams out, longest first.
  const names = [...new Set(teams)].sort((a, b) => b.length - a.length);
  const bare = (text: string) => names.reduce((t, n) => t.split(n).join(" "), plain(text));
  // Rows (every list item): no winner word. Section notes may say "names a winner" to explain the rule.
  const rows = bare((await page.locator("main li").allInnerTexts()).join("\n"));
  expect(rows).not.toMatch(WINNER_WORDS);
  const text = bare(await page.locator("main").innerText());
  expect(text).not.toMatch(BETTING_OR_SOURCE);
  // The page's own name holds no "|": the layout's title template adds the site's name after one.
  expect((await page.title()).replace(` | ${SITE_NAME}`, "")).not.toContain("|");
}

const teamsOf = (r: { games: { home: string; away: string }[] }) => r.games.flatMap((g) => [g.home, g.away]);

const SECTIONS = ["Upsets", "Biggest wins", "Closest games", "Rating movers", "Furthest from the projection", "Playoff advancement", "Every game"];

test("the index lists every season and week, newest first, one organization at a time", async ({ page }) => {
  const { orgs, latest, weekHref, uil } = await fixtures();
  await checkPage(page, "/weeks");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Week in review");
  await expect(page.getByRole("link", { name: `Latest: ${latest.season} week ${latest.week}` })).toHaveAttribute("href", weekHref(latest.season, latest.week, uil));
  const tabs = page.getByRole("navigation", { name: "Organization" }).getByRole("link");
  expect((await tabs.allInnerTexts()).map((t) => t.toLowerCase())).toEqual(orgs.map((o) => o.label.toLowerCase())); // the tabs are drawn in capitals
  // Seasons newest first, each with its own weeks, newest first.
  const seasons = await page.locator("main h2").allInnerTexts();
  const years = seasons.map((s) => Number(s.slice(0, 4)));
  expect(years).toEqual([...years].sort((a, b) => b - a));
  const first = page.getByRole("navigation", { name: `${years[0]} weeks` }).getByRole("link");
  const numbers = (await first.allInnerTexts()).map(Number);
  expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  expect(numbers[0]).toBe(latest.week);
  await checkWords(page);
});

test("the latest week has every section, each with rows or a plain empty message, and every game links to its page", async ({ page }) => {
  const { review, latest, uil, plural } = await fixtures();
  await checkPage(page, `/weeks/${latest.season}/${latest.week}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Week in review");
  await expect(page.locator("main")).toContainText(`${uil.label} · ${latest.season} season · Week ${latest.week}`);
  for (const name of SECTIONS) {
    const section = page.getByRole("region", { name, exact: true });
    await expect(section, name).toBeVisible();
    // Rows (a list item), a bracket round (a sub-heading), or the plain empty message: never a bare heading.
    expect(await section.getByRole("listitem").count() + (await section.getByRole("heading", { level: 3 }).count()) + (await section.locator("div.bg-panel").count()), name).toBeGreaterThan(0);
  }

  // Every game of the week, linked to its own page (away first, scores as stored, a forfeit as the word).
  const games = page.getByRole("region", { name: "Every game", exact: true }).getByRole("link");
  await expect(games).toHaveCount(review.games.length);
  expect(await games.evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(
    // listed by day, in the order the week's games are held
    [...Map.groupBy(review.games, (g) => g.status).values()].flat().map((g) => g.href),
  );
  for (const g of review.games.slice(0, 20)) {
    const link = page.getByRole("region", { name: "Every game", exact: true }).locator(`a[href="${g.href}"]`);
    await expect(link).toHaveAttribute("aria-label", g.forfeit ? `${g.away}, ${g.home}, forfeit, game page` : `${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}, game page`);
  }

  // Closest games (one score or less) and biggest wins: the lib's order, never a forfeit, the figure is the points between the scores.
  for (const [name, list] of [["Closest games", review.oneScore], ["Biggest wins", review.wins.map((w) => w.game)]] as const) {
    const rows = page.getByRole("region", { name, exact: true }).getByRole("listitem");
    await expect(rows).toHaveCount(list.length);
    for (const [i, g] of list.entries()) {
      await expect(rows.nth(i).getByRole("link")).toHaveAttribute("href", g.href);
      await expect(rows.nth(i)).toContainText(`${plural(Math.abs(g.homeScore - g.awayScore), "point")} apart`);
      expect(g.forfeit).toBe(false);
    }
  }
  for (const g of review.oneScore) expect(Math.abs(g.homeScore - g.awayScore)).toBeLessThanOrEqual(8);
  for (const [i, w] of review.wins.entries()) {
    await expect(page.getByRole("region", { name: "Biggest wins", exact: true }).getByRole("listitem").nth(i)).toContainText(`Final: ${w.winner} by ${w.margin}`);
  }

  // Furthest from the projection: the projection as the Results page words it, and the distance, with no winner.
  const { projectionText } = await inWeb(() => import("../lib/projection"));
  const off = page.getByRole("region", { name: "Furthest from the projection", exact: true }).getByRole("listitem");
  await expect(off).toHaveCount(review.furthest.length);
  for (const [i, o] of review.furthest.entries()) {
    await expect(off.nth(i)).toContainText(`Projected: ${projectionText(o.projection)}`);
    await expect(off.nth(i)).toContainText(`${plural(Math.round(o.gap), "point")} from the projection`);
    await expect(off.nth(i).getByRole("link")).toHaveAttribute("href", o.game.href);
  }
  await checkWords(page, [...teamsOf(review), ...review.rises.map((m) => m.team), ...review.drops.map((m) => m.team)]);
});

test("upsets: the team with the lower chance to win won, lowest chance first, with the chance in words and a link to the game", async ({ page }) => {
  const { withUpset, uil, weekHref, chanceText, aOrAn } = await fixtures();
  test.skip(!withUpset, "no UIL week with two upsets");
  const review = withUpset!;
  await checkPage(page, weekHref(review.season, review.week, uil));
  const rows = page.getByRole("region", { name: "Upsets", exact: true }).getByRole("listitem");
  const shown = review.upsets.slice(0, 8);
  await expect(rows).toHaveCount(shown.length);
  for (const [i, u] of shown.entries()) {
    expect(u.chance).toBeLessThan(0.5);
    expect(u.game.forfeit).toBe(false);
    if (review.disputed.has(u.game.id)) throw new Error("a disputed final is no upset");
    await expect(rows.nth(i)).toContainText(`${u.winner} had ${aOrAn(chanceText(u.chance))} ${chanceText(u.chance)} chance to win.`);
    await expect(rows.nth(i).getByRole("link")).toHaveAttribute("href", u.game.href);
  }
  expect(review.upsets.map((u) => u.chance)).toEqual([...review.upsets.map((u) => u.chance)].sort((a, b) => a - b));
  await expect(page.locator("main")).toContainText(`${review.games.length} games: ${review.upsets.length} upsets`);
  await checkWords(page, teamsOf(review));
});

test("streaks and milestones: each line names its team and links its game, and a section with nothing is left out", async ({ page }) => {
  const { withStreak, withFirsts, uil, weekHref } = await fixtures();
  test.skip(!withStreak && !withFirsts, "no UIL week with streaks or milestones");
  if (withStreak) {
    await checkPage(page, weekHref(withStreak.season, withStreak.week, uil));
    const rows = page.getByRole("region", { name: "Streaks", exact: true }).getByRole("listitem");
    await expect(rows).toHaveCount(withStreak.streaks.length);
    for (const [i, s] of withStreak.streaks.entries()) {
      await expect(rows.nth(i)).toContainText(s.team);
      await expect(rows.nth(i)).toContainText(s.change === "ended" ? `streak of ${s.length} games ended` : `won ${s.length} games in a row`);
      await expect(rows.nth(i).locator(`a[href="${s.game.href}"]`)).toHaveCount(1);
      if (s.change === "reached") expect(s.length % 5).toBe(0);
      else expect(s.length).toBeGreaterThanOrEqual(5);
    }
    await checkWords(page, teamsOf(withStreak));
  }
  if (withFirsts) {
    await checkPage(page, weekHref(withFirsts.season, withFirsts.week, uil));
    const rows = page.getByRole("region", { name: "Milestones", exact: true }).getByRole("listitem");
    await expect(rows).toHaveCount(withFirsts.milestones.length);
    for (const [i, m] of withFirsts.milestones.entries()) {
      await expect(rows.nth(i)).toContainText(m.team);
      await expect(rows.nth(i)).toContainText({ "state-game": "First State Championship game", "playoff-win": "First playoff win", "first-loss": "First loss of the season" }[m.kind]);
      await expect(rows.nth(i).locator(`a[href="${m.game.href}"]`)).toHaveCount(1);
    }
    await checkWords(page, teamsOf(withFirsts));
  }
});

test("a week with a disputed final names no winner for it in any recap section", async ({ page }) => {
  const { withDispute, uil, weekHref } = await fixtures();
  test.skip(!withDispute, "no UIL week with a disputed final");
  await checkPage(page, weekHref(withDispute!.season, withDispute!.week, uil));
  for (const id of withDispute!.disputed) {
    const g = withDispute!.games.find((x) => x.id === id);
    if (!g) continue;
    for (const name of ["Upsets", "Biggest wins", "Closest games", "Streaks", "Milestones"]) {
      await expect(page.getByRole("region", { name, exact: true }).locator(`a[href="${g.href}"]`), name).toHaveCount(0);
    }
  }
});

test("rating movers are ranked within the organization: biggest change first, rank now, and the places moved", async ({ page }) => {
  const { review, latest } = await fixtures();
  test.skip(!review.rises.length && !review.drops.length, "no rating moves in the latest week");
  await page.goto(`/weeks/${latest.season}/${latest.week}`);
  const { signed } = await inWeb(() => import("../lib/signed"));
  for (const [heading, list] of [["Biggest rises", review.rises], ["Biggest drops", review.drops]] as const) {
    const rows = page.locator(`h3:has-text("${heading}") + ol > li`);
    await expect(rows).toHaveCount(list.length);
    for (const [i, m] of list.entries()) {
      await expect(rows.nth(i)).toContainText(m.team);
      await expect(rows.nth(i)).toContainText(signed(m.change));
      await expect(rows.nth(i)).toContainText(`Rating ${signed(m.rating)}, was ${signed(m.was)}`);
      if (m.place > 0) await expect(rows.nth(i)).toContainText(`UIL rank ${m.place}`);
    }
    if (list.length > 1) expect(list.map((m) => Math.abs(m.change))).toEqual([...list.map((m) => Math.abs(m.change))].sort((a, b) => b - a));
  }
});

test("a week before ratings are tracked says so instead of showing an empty list", async ({ page }) => {
  const { untracked, uil, weekHref } = await fixtures();
  test.skip(!untracked, "every week has a rating column");
  await checkPage(page, weekHref(untracked!.season, untracked!.week, uil));
  await expect(page.getByRole("region", { name: "Rating movers", exact: true })).toContainText("tracked week by week from the fourth week");
});

test("playoff advancement names the teams with a later-round game listed, by bracket, and no winner", async ({ page }) => {
  const { withAdvance, uil, weekHref } = await fixtures();
  test.skip(!withAdvance, "no UIL week with a bracket round that sent teams on");
  await checkPage(page, weekHref(withAdvance!.season, withAdvance!.week, uil));
  const section = page.getByRole("region", { name: "Playoff advancement", exact: true });
  for (const a of withAdvance!.advanced) {
    await expect(section).toContainText(`${a.bracket} · ${a.label}`);
    await expect(section).toContainText(`${a.games} ${a.games === 1 ? "game" : "games"} played`);
    for (const w of a.wentOn) for (const t of w.teams) await expect(section.getByText(t, { exact: true }).first()).toBeVisible();
  }
  await expect(section).toContainText("Listed in");
  await checkWords(page, [...teamsOf(withAdvance!), ...withAdvance!.rises.map((m) => m.team), ...withAdvance!.drops.map((m) => m.team)]);
});

test("a forfeit shows the word, never the recorded score, in every list", async ({ page }) => {
  const { withForfeit, uil, weekHref } = await fixtures();
  test.skip(!withForfeit, "no UIL week with a forfeit");
  await checkPage(page, weekHref(withForfeit!.season, withForfeit!.week, uil));
  const f = withForfeit!.games.find((g) => g.forfeit)!;
  const link = page.getByRole("region", { name: "Every game", exact: true }).locator(`a[href="${f.href}"]`);
  await expect(link).toContainText("Forfeit");
  await expect(link).toHaveAttribute("aria-label", `${f.away}, ${f.home}, forfeit, game page`);
  expect(await link.innerText()).not.toMatch(/\d/);
  for (const name of ["Upsets", "Closest games", "Biggest wins", "Streaks", "Milestones", "Furthest from the projection"]) {
    await expect(page.getByRole("region", { name, exact: true }).locator(`a[href="${f.href}"]`)).toHaveCount(0);
  }
});

test("another organization has its own address, tab and games, and none of UIL's", async ({ page }, info) => {
  const { other, orgs, weekHref } = await fixtures();
  test.skip(!other, "only one organization has games");
  const org = other!.org;
  await checkPage(page, weekHref(other!.season, other!.week, org));
  await expect(page).toHaveURL(new RegExp(`/weeks/${other!.season}/${other!.week}/${org.slug}$`));
  await expect(page.getByRole("navigation", { name: "Organization" }).locator('a[aria-current="page"]')).toHaveText(org.label);
  await expect(page.getByRole("region", { name: "Every game", exact: true }).getByRole("link")).toHaveCount(other!.games.length);
  expect(orgs.length).toBeGreaterThan(1);
  await expect(page.locator("main")).toContainText(`${org.label} · ${other!.season} season`);
  await checkWords(page, [...teamsOf(other!), ...other!.rises.map((m) => m.team), ...other!.drops.map((m) => m.team)]);
  expect(info.project.name).toBeTruthy();
});

test("a week or organization with no page is a 404", async ({ page }) => {
  const { latest } = await fixtures();
  for (const url of [`/weeks/${latest.season}/99`, `/weeks/1999/1`, `/weeks/${latest.season}/${latest.week}/uil`, "/weeks/nope", `/weeks/${latest.season}`]) {
    expect((await page.goto(url))?.status(), url).toBe(404);
  }
});

test("the home page and Scores link to the latest week in review", async ({ page }) => {
  const { latest, weekHref, uil } = await fixtures();
  const name = `Week in review: ${latest.season} week ${latest.week}`;
  for (const url of ["/", "/scores"]) {
    await page.goto(url);
    const link = page.getByRole("link", { name });
    await expect(link, url).toHaveAttribute("href", weekHref(latest.season, latest.week, uil));
    expect((await link.boundingBox())!.height, url).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("link", { name }).click();
  await expect(page).toHaveURL(`/weeks/${latest.season}/${latest.week}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Week in review");
});

test("the home page's week card shows the week's top upset and closest game, each linked to its game", async ({ page }) => {
  const { review, latest, chanceText, aOrAn } = await fixtures();
  await page.goto("/");
  const card = page.getByRole("region", { name: `UIL week ${latest.week} highlights`, exact: true });
  const top = review.upsets[0];
  const rows = card.getByRole("listitem");
  await expect(rows).toHaveCount((top ? 1 : 0) + (review.closest ? 1 : 0));
  test.skip(!top && !review.closest, "the latest week has neither an upset nor a played game");
  if (top) {
    await expect(card.getByRole("link").first()).toHaveAttribute("href", top.game.href);
    await expect(rows.first()).toContainText(`${top.winner} had ${aOrAn(chanceText(top.chance))} ${chanceText(top.chance)} chance to win.`);
  }
  if (review.closest) {
    const link = card.getByRole("link").last();
    await expect(link).toHaveAttribute("href", review.closest.href);
    await expect(link).toContainText("Closest game");
  }
  for (const link of await card.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await card.innerText()).not.toMatch(WINNER_WORDS);
});

test("share cards: one per organization and season, never one per week", async ({ page, request }) => {
  const { latest, seasonCards, pageCount } = await fixtures();
  expect(seasonCards.length).toBeLessThanOrEqual(ORGS.length * (CURRENT_SEASON - FIRST_SEASON + 1)); // at most one per organization and season
  expect(seasonCards.length).toBeLessThan(pageCount);
  console.info(`week in review: ${pageCount} pages, ${seasonCards.length} share images`);
  await page.goto(`/weeks/${latest.season}/${latest.week}`);
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toContain(`/weeks/card/${latest.season}/uil/opengraph-image`);
  const res = await request.get(new URL(og!).pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
});
