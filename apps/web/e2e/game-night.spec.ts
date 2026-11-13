import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { LIVE_SCORES_URL, noLiveScores } from "./live-route";

// Game night: the preview on a game not yet played (/scores/<id>) and the Tonight scoreboard (/scores/tonight). No request
// reaches Supabase (e2e/live-route.ts), and every expectation comes from the same lib the site is built from.
//
// Which night "tonight" is depends on the date the site was built, so the Tonight tests check whatever night the build
// shows (and the empty state when it has no games). To look at another night, set GAME_NIGHT=YYYY-MM-DD for the dev server
// and this run, e.g. GAME_NIGHT=2026-11-07 (a night of finals) or GAME_NIGHT=2027-01-02 (a night with none).
noLiveScores(test);
test.setTimeout(120_000);

const WINNER_WORDS = /\b(won|beat|beats|defeated|defeats|winner|wins|winning|victory|loser|lost|leads?|leading|ahead)\b/i;
const BETTING_OR_SOURCE = /\b(spreads?|odds|lines?|bets?|bettors?|favou?rites?|underdogs?|locks?|sources?|maxpreps)\b/i;
// "Win probability" is the projection's own phrase; everything else is checked.
const plain = (text: string) => text.replace(/win probability/gi, "");

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
  const { loadAlignments } = await import("../lib/alignments");
  const { loadGames } = await import("../lib/games");
  const { gameDetail, gamePreview } = await import("../lib/game-pages");
  const { orgOfLabel } = await import("../lib/orgs");
  const { signed } = await import("../lib/signed");
  const { loadNight, tonightsDate } = await import("../lib/tonight");
  const alignments = await loadAlignments();
  const games = await loadGames(alignments);
  const slugOf = new Map(alignments.map((a) => [a.school, a.slug]));
  const scheduled = await Promise.all(
    games
      .filter((g) => g.state === "scheduled" && g.date)
      .map(async (g) => {
        const detail = await gameDetail({ season: 2026, date: g.date!, home: g.home.name, away: g.away.name });
        const preview = await gamePreview({ season: 2026, date: g.date!, home: g.home.name, away: g.away.name, org: orgOfLabel(g.league), detail });
        return { game: g, detail, preview };
      }),
  );
  const night = tonightsDate();
  return {
    // A game with earlier meetings and common opponents, one with neither, and a game already played.
    rich: scheduled.find((s) => s.detail.meetings.total > 0 && s.preview.common.shown.length > 0),
    noMeetings: scheduled.find((s) => s.detail.meetings.total === 0),
    noCommon: scheduled.find((s) => s.preview.common.shown.length === 0),
    played: games.find((g) => g.state === "final" && g.date && g.verification !== "none"),
    slugOf: (name: string) => slugOf.get(name),
    signed,
    night,
    tonight: await loadNight(night),
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

test("a game not yet played has a preview: both teams, the projection, head-to-head and common opponents", async ({ page }) => {
  const { rich, slugOf, signed } = await fixtures();
  test.skip(!rich, "no unplayed game with earlier meetings and common opponents");
  const { game: g, detail, preview } = rich!;
  await checkPage(page, `/scores/${g.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${g.away.name} at ${g.home.name}`);

  const box = page.getByRole("region", { name: "Preview", exact: true });
  await expect(box).toBeVisible();
  // Both teams side by side, away first: record, rating and rank within the organization.
  const cards = box.locator("dl");
  await expect(cards).toHaveCount(2);
  for (const [i, side] of [preview.away, preview.home].entries()) {
    const card = cards.nth(i).locator("xpath=..");
    await expect(card).toContainText(side.team);
    await expect(card.locator("dd").nth(0)).toContainText(side.record);
    if (side.rating != null) await expect(card.locator("dd").nth(1)).toHaveText(signed(side.rating));
    if (side.rank) await expect(card.locator("dd").nth(2)).toContainText(side.rank.text);
    const slug = slugOf(side.team);
    if (slug) await expect(card.getByRole("link", { name: side.team, exact: true })).toHaveAttribute("href", `/programs/${slug}`);
  }
  // The projection: the page's own text, unchanged.
  if (g.projected) await expect(box).toContainText(g.projected);
  await expect(page.getByRole("region", { name: "Game details" })).toContainText(g.projected ?? "");

  // Head-to-head since 2021: each earlier meeting links to its own game page; scores as stored, away first.
  const h2h = box.getByRole("region", { name: "Head-to-head since 2021" });
  const links = h2h.getByRole("link");
  await expect(links).toHaveCount(detail.meetings.list.length);
  expect(await links.evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(detail.meetings.list.map((m) => m.result.href));
  for (const [i, m] of detail.meetings.list.entries()) {
    await expect(links.nth(i)).toContainText(m.result.forfeit ? "Forfeit" : `${m.result.awayScore}-${m.result.homeScore}`);
    expect(m.result.date < g.date!).toBe(true);
  }
  await expect(h2h).toContainText("Scores are not confirmed here and may change.");

  // Common opponents this season: the opponent links to its program, then each team's own score against it.
  const common = box.getByRole("region", { name: "Common opponents this season" });
  const items = common.getByRole("listitem");
  await expect(items).toHaveCount(preview.common.shown.length);
  for (const [i, c] of preview.common.shown.entries()) {
    const item = items.nth(i);
    await expect(item).toContainText(`${preview.away.team} ${c.a.join(", ")}`);
    await expect(item).toContainText(`${preview.home.team} ${c.b.join(", ")}`);
    const slug = slugOf(c.opponent);
    if (slug) await expect(item.getByRole("link", { name: c.opponent, exact: true })).toHaveAttribute("href", `/programs/${slug}`);
    else await expect(item).toContainText(c.opponent);
  }
  if (preview.common.rest) await expect(common).toContainText(`${preview.common.shown.length} of ${preview.common.shown.length + preview.common.rest}`);

  // The page names no winner and no betting word, and no source.
  const text = plain(await page.locator("main").innerText());
  expect(text).not.toMatch(WINNER_WORDS);
  expect(text).not.toMatch(BETTING_OR_SOURCE);
  // Records and meetings are not listed twice: the preview holds them.
  await expect(page.getByRole("region", { name: "Going in" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Earlier meetings" })).toHaveCount(0);
});

test("the preview says so plainly when two teams have no head-to-head or no common opponent", async ({ page }) => {
  const { noMeetings, noCommon } = await fixtures();
  test.skip(!noMeetings && !noCommon, "every unplayed game has both");
  if (noMeetings) {
    await page.goto(`/scores/${noMeetings.game.id}`);
    const h2h = page.getByRole("region", { name: "Head-to-head since 2021" });
    await expect(h2h).toContainText("No earlier game between these two on record since 2021.");
    await expect(h2h.getByRole("listitem")).toHaveCount(0);
  }
  if (noCommon) {
    await page.goto(`/scores/${noCommon.game.id}`);
    await expect(page.getByRole("region", { name: "Common opponents this season" })).toContainText("No opponent both teams have played this season.");
  }
});

test("a game already played has no preview and keeps its page as it was", async ({ page }) => {
  const { played } = await fixtures();
  test.skip(!played, "no played bracket game");
  await page.goto(`/scores/${played!.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${played!.away.name} at ${played!.home.name}`);
  await expect(page.getByRole("region", { name: "Preview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Common opponents this season" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Earlier meetings" })).toBeVisible();
});

test("the preview fits a phone: no sideways scroll, the long head-to-head list included", async ({ page }) => {
  const { rich } = await fixtures();
  test.skip(!rich, "no unplayed game with earlier meetings");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/scores/${rich!.game.id}`, { waitUntil: "networkidle" });
  const box = page.getByRole("region", { name: "Preview", exact: true });
  await expect(box).toBeVisible();
  const wide = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, inside: [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length }));
  expect(wide).toEqual({ page: 0, inside: 0 });
});

test.describe("Tonight", () => {
  test("lists the night's games by organization and round, or says there are none", async ({ page }) => {
    const { tonight } = await fixtures();
    await checkPage(page, "/scores/tonight");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tonight");
    await expect(page.getByText(/^Page updated .*\d{1,2}:\d{2} (AM|PM) CT$/)).toBeVisible();
    if (tonight.count === 0) {
      await expect(page.getByText(/No games are listed for/)).toBeVisible();
      await expect(page.getByRole("link", { name: "See every playoff game" })).toHaveAttribute("href", "/scores");
      return;
    }
    // One section per organization, in the site's order; each holds only its own games, rounds in bracket order.
    const sections = page.locator("main section[aria-labelledby^='night-']");
    await expect(sections).toHaveCount(tonight.orgs.length);
    for (const [i, org] of tonight.orgs.entries()) {
      const section = sections.nth(i);
      await expect(section.getByRole("heading", { level: 2 })).toHaveText(org.label);
      await expect(section.getByRole("heading", { level: 3 })).toHaveText(org.rounds.map((r) => r.label));
      const ids = org.rounds.flatMap((r) => r.games.map((g) => g.id));
      expect(await section.locator("li[data-game]").evaluateAll((li) => li.map((x) => x.getAttribute("data-game")))).toEqual(ids);
      for (const g of org.rounds.flatMap((r) => r.games)) {
        const row = section.locator(`li[data-game="${g.id}"]`);
        await expect(row.getByRole("link")).toHaveAttribute("href", g.href);
        await expect(row).toContainText(`${g.away} at ${g.home}`);
        if (g.state === "later") await expect(row).toContainText("Tonight, no score yet");
        if (g.state === "forfeit") {
          await expect(row).toContainText("Forfeit");
          await expect(row).not.toContainText(/\b[0-2]\s*,\s|\b[0-2]–[0-2]\b/);
        }
        if (g.state === "final" && g.unconfirmed) {
          await expect(row).toContainText("Final · Unconfirmed");
          await expect(row).toContainText(`${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}`);
        }
      }
    }
    const text = plain(await page.locator("main").innerText());
    expect(text).not.toMatch(WINNER_WORDS);
    expect(text).not.toMatch(BETTING_OR_SOURCE);
    // A game opens its own page.
    const first = tonight.orgs[0].rounds[0].games[0];
    await page.locator(`li[data-game="${first.id}"] a`).click();
    await expect(page).toHaveURL(first.href);
  });

  test("a game under way shows its live line, Unconfirmed, with no leader named", async ({ page }) => {
    const { tonight } = await fixtures();
    const later = tonight.orgs.flatMap((o) => o.rounds.flatMap((r) => r.games)).find((g) => g.state === "later");
    test.skip(!later, "no game of the night is waiting for a score");
    const { liveKey } = await import("../lib/live-scores");
    const { slugify } = await import("../lib/slug");
    await page.route(LIVE_SCORES_URL, (route) =>
      route.fulfill({
        status: route.request().method() === "OPTIONS" ? 204 : 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" },
        body: JSON.stringify([{ game_key: liveKey(later!.date, later!.home, later!.away), home: slugify(later!.home), away: slugify(later!.away), home_score: 28, away_score: 14, period: "Q3", read_at: new Date().toISOString() }]),
      }),
    );
    await page.goto("/scores/tonight");
    const row = page.locator(`li[data-game="${later!.id}"]`);
    await expect(row.locator("[data-live-score]").getByText("Live · Q3 · 14–28 · Unconfirmed")).toBeVisible();
    expect(plain(await row.innerText()).replace(later!.away, "").replace(later!.home, "")).not.toMatch(WINNER_WORDS);
    // The other rows are untouched.
    await expect(page.locator("[data-live-score]")).toHaveCount(1);
  });

  test("the home page links to it only when the night has games", async ({ page }) => {
    const { tonight } = await fixtures();
    await page.goto("/");
    const link = page.getByRole("link", { name: /^Tonight, / });
    if (tonight.count) {
      await expect(link).toHaveAttribute("href", "/scores/tonight");
      await expect(link).toContainText(`${tonight.count} ${tonight.count === 1 ? "game" : "games"}`);
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    } else {
      await expect(link).toHaveCount(0);
    }
  });
});
