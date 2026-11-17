import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { FIRST_SEASON } from "../lib/season";
import { MIN_MEETINGS } from "../lib/series";

// A series page: the games of one pair of programs, FIRST_SEASON on, at /series/<a>/<b> with the slugs in alphabetical order, the
// reversed order redirecting to it (ADR 0097). The series is in words ("Jayton won 6, Guthrie won 3"), a game row names no winner
// (ADR 0040), a forfeit shows the word, never 1-0 or 2-0, a disputed final is listed and not counted, and no page names a source.
test.use({ serviceWorkers: "block" });

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

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b/i;
const SOURCE = /maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;
const WINNER = /\b(won|beat|defeated|winner)\b/i;

// Real pairs with three or more games: a UIL pair with a playoff game, one with a forfeit, and two long names.
const JAYTON = ["guthrie", "jayton"] as const;
const FORFEIT = ["dell-city", "fort-davis"] as const;
const LONG = ["baytown-christian-academy", "oconnell-college-preparatory-hs-galveston"] as const;

async function open(page: Page, [first, second]: readonly [string, string]) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(`/series/${first}/${second}`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

const rows = (page: Page) => page.locator("section[aria-labelledby=meetings] > ul > li");

test("the page names both teams, shows both crests, and links each to its program page", async ({ page }) => {
  await open(page, JAYTON);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guthrie vs Jayton");
  await expect(page).toHaveTitle("Guthrie vs Jayton football: every meeting | TX Six-Man Football");
  for (const [slug, name] of [["guthrie", "Guthrie"], ["jayton", "Jayton"]]) {
    const link = page.locator("header").getByRole("link", { name: new RegExp(name) });
    await expect(link).toHaveAttribute("href", `/programs/${slug}`);
    // The logo, or the badge in the school's colors where it has none: either way the crest is drawn.
    await expect(link.locator("img, span[aria-hidden=true]").first()).toBeVisible();
  }
  await expect(page.locator("main")).not.toContainText("not confirmed"); // a final is confirmed (ADR 0040)
  await expect(page.getByText("A forfeit counts as a win or a loss.")).toBeVisible();
});

test("the description fits, names no score or winner, and the canonical link is the alphabetical address", async ({ page }) => {
  await open(page, JAYTON);
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description!.length).toBeLessThanOrEqual(160);
  expect(description).toMatch(new RegExp(`^Guthrie vs Jayton six-man football: \\d+ meetings since ${FIRST_SEASON}\\.`));
  expect(description).not.toMatch(/\d+-\d+|\b(won|beat|defeated|winner|unconfirmed)\b/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://txsixmanfootball.com/series/guthrie/jayton");
});

for (const pair of [JAYTON, FORFEIT, LONG]) {
  test(`${pair.join(" vs ")}: the series in words is the sum of the meetings listed, and no bare 6-3 appears`, async ({ page }) => {
    await open(page, pair);
    const line = (await page.locator("header p").filter({ hasText: /meetings since/ }).textContent())!;
    const m0 = line.match(new RegExp(`^(.+) won (\\d+), (.+) won (\\d+)(?:, (\\d+) ties?)? · (\\d+) meetings since ${FIRST_SEASON}`))!;
    expect(m0, line).not.toBeNull();
    const [firstName, won, secondName, lost, tied, meetings] = [m0[1], Number(m0[2]), m0[3], Number(m0[4]), Number(m0[5] ?? 0), Number(m0[6])];
    expect(line).not.toMatch(/\b\d+-\d+\b/);
    // The side ahead is named first (the first-named team when level): the two names are the heading's, in either order.
    const [h1, h2] = (await page.getByRole("heading", { level: 1 }).textContent())!.split(" vs ");
    expect([firstName, secondName].sort()).toEqual([h1, h2].sort());
    const [ours, theirs] = firstName === h1 ? [won, lost] : [lost, won];
    const list = rows(page);
    await expect(list).toHaveCount(meetings);
    const labels = await list.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("aria-label")!));
    // From the scores on the page itself (away team first): the first-named team's wins and losses, where a score is shown. A
    // disputed final is listed and left out of the record, so it adds nothing to either side.
    let [w, l, t, forfeits, disputed] = [0, 0, 0, 0, 0];
    for (const label of labels) {
      const m = label.match(/^[A-Za-z]+ \d+, \d{4}, (.+) vs (.+?), \d{4} (?:season|playoffs · .+?), (forfeit|(\d+)-(\d+))(, score reported, not counted)?, game page$/)!;
      expect(m, label).not.toBeNull();
      if (m[6]) {
        disputed += 1;
        continue;
      }
      if (m[3] === "forfeit") {
        forfeits += 1;
        continue;
      }
      const [away, home, awayScore, homeScore] = [m[1], m[2], Number(m[4]), Number(m[5])];
      const [us, them] = away === h1 ? [awayScore, homeScore] : [homeScore, awayScore];
      expect([away, home]).toContain(h1);
      if (us > them) w += 1;
      else if (us < them) l += 1;
      else t += 1;
    }
    expect(ours + theirs + tied + disputed).toBe(meetings);
    // A forfeit's side is not on the page (only the word is), so it can make up the difference but never exceed it.
    expect(w).toBeLessThanOrEqual(ours);
    expect(l).toBeLessThanOrEqual(theirs);
    expect(t).toBeLessThanOrEqual(tied);
    expect(ours - w + (theirs - l) + (tied - t)).toBe(forfeits);
  });
}

test("every meeting is newest first, links to its game page, and names its round when it was a playoff game", async ({ page }) => {
  await open(page, JAYTON);
  const list = rows(page);
  const hrefs = await list.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThanOrEqual(3);
  for (const h of hrefs) expect(h).toMatch(/^\/scores\/[a-z0-9-]+$/);
  expect(new Set(hrefs).size).toBe(hrefs.length);
  const dates = await list.getByRole("link").evaluateAll((as) => as.map((a) => new Date(a.querySelector("span")!.textContent! + " 12:00 UTC").getTime()));
  expect(dates).toEqual([...dates].sort((x, y) => y - x));
  // Guthrie and Jayton met in the 2025 bi-district round.
  await expect(list.filter({ hasText: "2025 playoffs · UIL Division II · Bi-district" })).toHaveCount(1);
  await expect(list.filter({ hasText: /\d{4} season/ }).first()).toBeVisible();
  // Each is its own game page.
  await page.goto(hrefs[0]);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a forfeit shows the word, never the recorded 1-0 or 2-0", async ({ page }) => {
  await open(page, FORFEIT);
  const forfeits = rows(page).filter({ hasText: "Forfeit" });
  expect(await forfeits.count()).toBeGreaterThan(0);
  await expect(forfeits.first().getByRole("link")).toHaveAttribute("aria-label", /, forfeit, game page$/);
  await expect(forfeits).not.toContainText(/\b(0-1|1-0|0-2|2-0)\b/);
});

test("a State Championship between the two shows in its own section, and a pair with none has no finals section", async ({ page }) => {
  await open(page, ["benjamin", "loraine"]); // the 2022 Division II final, from the State Championship archive
  const finals = page.getByRole("region", { name: "State Championships" });
  await expect(finals.getByRole("listitem")).toHaveCount(1);
  await expect(finals.getByRole("listitem")).toContainText(/2022\s*Champion Benjamin · Div II\s*Runner-up Loraine\s*68-20/);
  // The same game is also one of the meetings, named by its round.
  await expect(rows(page).filter({ hasText: "2022 playoffs · UIL Division II · State Championship" })).toHaveCount(1);
  await open(page, JAYTON);
  await expect(page.locator("section[aria-labelledby=finals]")).toHaveCount(0);
});

test("the projection uses the words rating, projected margin and chance to win, and links to Matchup", async ({ page }) => {
  await open(page, JAYTON);
  const section = page.getByRole("region", { name: "If they met now" });
  await expect(section).toContainText(/Projected margin: (Guthrie|Jayton) by (\d+|45\+|less than 1) · (>99%|<1%|\d+%) chance to win/);
  await expect(section).toContainText("A projection, not a result.");
  const link = section.getByRole("link", { name: /Matchup/ });
  await expect(link).toHaveAttribute("href", "/matchup?a=guthrie&b=jayton");
});

test("the reversed address redirects to the alphabetical one, so a pair has one page; so does /matchup/<a>/<b>", async ({ request, page }) => {
  const res = await request.get("/series/jayton/guthrie", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(new URL(res.headers().location, "http://x").pathname).toBe("/series/guthrie/jayton");
  expect((await request.get("/series/guthrie/jayton", { maxRedirects: 0 })).status()).toBe(200);
  // A pair that never met twice has no page, in either order.
  expect((await request.get("/series/jayton/nowhere", { maxRedirects: 0 })).status()).toBe(404);
  // The address a reader guesses from Matchup lands on the page, either way round.
  for (const guess of ["/matchup/guthrie/jayton", "/matchup/jayton/guthrie"]) {
    await page.goto(guess);
    await expect(page).toHaveURL(/\/series\/guthrie\/jayton$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Guthrie vs Jayton");
  }
});

test("no game row names a winner, and no betting or source words on the page", async ({ page }) => {
  for (const pair of [JAYTON, FORFEIT, LONG]) {
    await open(page, pair);
    // A school can be named "Victory" or "Beat": strip the two names before looking for the words.
    const names = (await page.getByRole("heading", { level: 1 }).textContent())!.split(" vs ");
    // The site's own address appears in the page's breadcrumb markup, the one place "sixmanfootball" may.
    let text = ((await page.locator("article").textContent()) ?? "").replaceAll("txsixmanfootball.com", "");
    for (const n of names) text = text.replaceAll(n, "");
    // The series in words says who won how many (a record, ADR 0013); a game row, the lists of games and the finals name no winner.
    let games = (await page.locator("section[aria-labelledby=meetings], section[aria-labelledby=playoff-meetings], section[aria-labelledby=finals]").allTextContents()).join(" ");
    for (const n of names) games = games.replaceAll(n, "");
    expect(games).not.toMatch(WINNER);
    expect(text).not.toMatch(BETTING);
    expect(text).not.toMatch(SOURCE);
    expect((await page.locator("main").innerHTML()).replaceAll("txsixmanfootball.com", "")).not.toMatch(SOURCE);
  }
});

for (const pair of [JAYTON, FORFEIT, LONG]) {
  test(`${pair.join(" vs ")}: axe clean, no sideways scroll, 44px targets`, async ({ page }) => {
    const errors = await open(page, pair);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll<HTMLElement>("article a, article summary")]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({ what: `${el.tagName} ${el.textContent!.trim().slice(0, 30)}`, h: Math.round(el.getBoundingClientRect().height) }))
        .filter((x) => x.h < 44),
    }));
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.small).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("a program page links its games count to the series page, only where the pair has one", async ({ page }) => {
  const response = await page.goto("/programs/jayton", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  const section = page.getByRole("region", { name: "Most played" });
  // The most played: Guthrie is among them, and the games count is the link.
  const top = section.locator(":scope > ul > li").filter({ hasText: "Guthrie" });
  const topLink = top.getByRole("link", { name: /^\d+ games, series with Guthrie$/ });
  await expect(topLink).toHaveAttribute("href", "/series/guthrie/jayton");
  expect((await topLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(top.getByRole("link", { name: "Guthrie", exact: true })).toHaveAttribute("href", "/programs/guthrie"); // the program link stays
  // All opponents: a games count is a link exactly when the pair met twice or more.
  await section.locator("details > summary").click();
  const all = section.locator("details li");
  const checks = await all.evaluateAll((lis) =>
    lis.map((li) => {
      const games = Number(li.querySelector("small")!.textContent!.match(/^(\d+) game/)![1]);
      const link = li.querySelector('small a[href^="/series/"]');
      return { games, href: link?.getAttribute("href") ?? null, text: link?.textContent ?? null, height: link ? Math.round(link.getBoundingClientRect().height) : 44 };
    }),
  );
  expect(checks.some((c) => c.href)).toBe(true);
  for (const c of checks) {
    expect(c.href !== null, `${c.games} games`).toBe(c.games >= MIN_MEETINGS);
    if (c.href) {
      expect(c.href).toMatch(/^\/series\/[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(c.text).toBe(`${c.games} games`);
      expect(c.height).toBeGreaterThanOrEqual(44);
    }
  }
  // Following one opens a page whose meetings are as many as the count.
  const guthrie = all.filter({ has: page.getByRole("link", { name: "Guthrie", exact: true }) }).getByRole("link", { name: /^\d+ games$/ });
  const count = Number((await guthrie.textContent())!.match(/\d+/)![0]);
  await page.goto((await guthrie.getAttribute("href"))!);
  await expect(rows(page)).toHaveCount(count);
});

test("a game page links to the two programs' series page, and a pair without one gets no link", async ({ page }) => {
  await page.goto(`/series/${JAYTON.join("/")}`);
  const game = await page.locator("section[aria-labelledby=meetings]").locator('a[href^="/scores/"]').first().getAttribute("href");
  await page.goto(game!);
  const link = page.getByRole("link", { name: new RegExp(`^Every (Guthrie and Jayton|Jayton and Guthrie) game since ${FIRST_SEASON}$`) });
  await expect(link).toHaveAttribute("href", `/series/${JAYTON.join("/")}`);
  expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.goto("/scores/g1"); // an invented sample game: no series
  await expect(page.getByRole("link", { name: new RegExp(`game since ${FIRST_SEASON}$`) })).toHaveCount(0);
});

test("each meeting's game page has a title of its own: the teams, the score and the round or date", async ({ page }) => {
  await page.goto(`/series/${JAYTON.join("/")}`);
  const games = [...new Set(await page.locator("section[aria-labelledby=meetings]").locator('a[href^="/scores/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))];
  const titles: string[] = [];
  for (const href of games) {
    await page.goto(href);
    titles.push(await page.title());
  }
  expect(titles.length).toBeGreaterThanOrEqual(3);
  for (const t of titles) expect(t).toMatch(/^((Guthrie|Jayton) \d+, (Guthrie|Jayton) \d+ · .+|(Guthrie vs Jayton|Jayton vs Guthrie) football score, [A-Z][a-z]{2} \d{1,2}, \d{4}) \| TX Six-Man Football$/);
  expect(new Set(titles).size).toBe(titles.length);
});

const glance = (page: Page) => page.getByRole("region", { name: "At a glance" });
const fact = (page: Page, label: string) => glance(page).locator("dl > div").filter({ has: page.getByText(label, { exact: true }) });

test("at a glance: the last meeting, the longest streak and each side's biggest win, each a link to its game", async ({ page }) => {
  await open(page, JAYTON);
  const hrefs = await rows(page).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  // The last meeting is the newest row of the list.
  const last = fact(page, "Last meeting").getByRole("link");
  await expect(last).toHaveAttribute("href", hrefs[0]);
  await expect(last).toContainText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}(Guthrie|Jayton) vs (Guthrie|Jayton), (\d+-\d+|forfeit)$/);
  // A streak is a run of one team's wins, named with its years, or it says neither team has two in a row.
  await expect(fact(page, "Longest streak")).toContainText(/^(Longest streak)?(?:(Guthrie|Jayton) won \d+ in a row, \d{4}(?: to \d{4})?(?: \(still going\))?|Neither team has won two in a row\.)$/);
  // Each side's biggest win: the winner's score first, the larger of the two, linking to one of the meetings; or none.
  for (const team of ["Guthrie", "Jayton"]) {
    const f = fact(page, `Biggest ${team} win`);
    const link = f.getByRole("link");
    if (await link.count()) {
      expect(hrefs).toContain((await link.getAttribute("href"))!);
      const [, winner, w, , l] = (await link.textContent())!.match(/(Guthrie|Jayton) (\d+), (Guthrie|Jayton) (\d+)$/)! as unknown as string[];
      expect(winner).toBe(team);
      expect(Number(w)).toBeGreaterThan(Number(l));
    } else await expect(f).toContainText("No win by points yet.");
    expect((await f.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(glance(page)).toContainText("A forfeit has no margin, so it is never a biggest win.");
});

test("a forfeit is listed but is never a biggest win", async ({ page }) => {
  await open(page, FORFEIT);
  const forfeitHrefs = await rows(page).filter({ hasText: "Forfeit" }).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  expect(forfeitHrefs.length).toBeGreaterThan(0);
  for (const team of ["Dell City", "Fort Davis"]) {
    for (const link of await fact(page, `Biggest ${team} win`).getByRole("link").all()) expect(forfeitHrefs).not.toContain(await link.getAttribute("href"));
  }
});

test("the playoff meetings are their own list, each also in the full list", async ({ page }) => {
  await open(page, JAYTON);
  const playoffs = page.getByRole("region", { name: "Playoff meetings" }).locator(":scope > ul > li");
  expect(await playoffs.count()).toBeGreaterThanOrEqual(1);
  await expect(playoffs.filter({ hasText: "2025 playoffs · UIL Division II · Bi-district" })).toHaveCount(1);
  await expect(playoffs).toHaveCount(await rows(page).filter({ hasText: /\d{4} playoffs · / }).count());
  const full = new Set(await rows(page).getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!)));
  for (const href of await playoffs.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) expect(full.has(href)).toBe(true);
  // The header says how many.
  await expect(page.locator("header p").filter({ hasText: /meetings since/ })).toContainText(/, \d+ in the playoffs/);
  // A pair that has never met in the playoffs has no such list.
  await open(page, FORFEIT);
  const none = await rows(page).filter({ hasText: /\d{4} playoffs · / }).count();
  await expect(page.getByRole("region", { name: "Playoff meetings" })).toHaveCount(none ? 1 : 0);
});

test("a pair with a game still to play shows it as the next meeting, linking to its page; a pair without one shows none", async ({ page }) => {
  const upcoming = await inWeb(async () => {
    const { loadSeries, upcomingMeetings } = await import("../lib/series-data");
    const [series, ahead] = await Promise.all([loadSeries(), upcomingMeetings()]);
    const pair = series.find((s) => ahead.has(`${s.first}|${s.second}`));
    return pair && { first: pair.first, second: pair.second, game: ahead.get(`${pair.first}|${pair.second}`)![0] };
  });
  test.skip(!upcoming, "no pair with two played games has another game to play (offseason)");
  await open(page, [upcoming!.first, upcoming!.second]);
  const next = fact(page, "Next meeting");
  await expect(next).toHaveCount(1);
  await expect(next.getByRole("link")).toHaveAttribute("href", `/scores/${upcoming!.game.id}`);
  await expect(next).toContainText(`${upcoming!.game.away.name} vs ${upcoming!.game.home.name}`);
  // A game still to play is not a meeting yet: the list holds the played ones only, and the preview's own page opens.
  await expect(rows(page).locator(`a[href="/scores/${upcoming!.game.id}"]`)).toHaveCount(0);
  await page.goto(`/scores/${upcoming!.game.id}`);
  await expect(page.getByRole("region", { name: "Preview", exact: true })).toBeVisible();
  await open(page, JAYTON);
  const jayton = await inWeb(async () => (await (await import("../lib/series-data")).upcomingMeetings()).has("guthrie|jayton"));
  if (!jayton) await expect(page.getByText("Next meeting", { exact: true })).toHaveCount(0);
});

test("a final the sources disagree on is listed with its score, left out of the record, and says so", async ({ page }) => {
  const pair = await inWeb(async () => {
    const [{ loadSeries }, { loadDisputed, isDisputed }] = [await import("../lib/series-data"), await import("../lib/disputed")];
    for (const s of await loadSeries()) {
      for (const { season, result: r } of s.games) {
        if (!r.forfeit && isDisputed(await loadDisputed(season), r.date, r.home, r.away)) return { first: s.first, second: s.second, href: r.href };
      }
    }
    return undefined;
  });
  test.skip(!pair, "no disputed final between two programs that met twice");
  await open(page, [pair!.first, pair!.second]);
  const row = rows(page).filter({ has: page.locator(`a[href="${pair!.href}"]`) });
  await expect(row).toContainText("score reported, not counted");
  await expect(row.getByRole("link")).toHaveAttribute("aria-label", /, score reported, not counted, game page$/);
  await expect(page.locator("header")).toContainText(/finals? (is|are) listed with the score reported and left out of the record/);
  // It names no winner, so it is nobody's biggest win.
  for (const link of await glance(page).locator("dl > div").filter({ hasText: /^Biggest/ }).getByRole("link").all()) expect(await link.getAttribute("href")).not.toBe(pair!.href);
});

test("Matchup lands on the pair's page once two teams that have met twice are chosen", async ({ page }) => {
  await page.goto("/matchup?a=guthrie&b=jayton");
  const link = page.getByRole("link", { name: /^All \d+ meetings$/ });
  await expect(link).toHaveAttribute("href", "/series/guthrie/jayton");
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const count = Number((await link.textContent())!.match(/\d+/)![0]);
  await link.click();
  await expect(page).toHaveURL(/\/series\/guthrie\/jayton$/);
  await expect(rows(page)).toHaveCount(count);
});

test("a program's most played: at most five, each with its series in words and a link to the pair's page", async ({ page }) => {
  await page.goto("/programs/jayton", { waitUntil: "networkidle" });
  const top = page.getByRole("region", { name: "Most played" }).locator(":scope > ul > li");
  const n = await top.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(5);
  for (const li of await top.all()) {
    const text = (await li.textContent())!;
    const games = Number(text.match(/(\d+) games/)![1]);
    const [, won, lost, tied = "0"] = text.match(/won (\d+), lost (\d+)(?:, tied (\d+))?/)!;
    expect(Number(won) + Number(lost) + Number(tied)).toBe(games); // a forfeit counts, as everywhere
    expect(games).toBeGreaterThanOrEqual(MIN_MEETINGS);
    await expect(li.getByRole("link", { name: /^\d+ games, series with / })).toHaveAttribute("href", /^\/series\/[a-z0-9-]+\/[a-z0-9-]+$/);
  }
  // Most played first.
  const counts = await top.evaluateAll((lis) => lis.map((li) => Number(li.textContent!.match(/(\d+) games/)![1])));
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
});
