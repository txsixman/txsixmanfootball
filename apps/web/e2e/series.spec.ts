import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIRST_SEASON } from "../lib/season";

// A series page: the games of one pair of programs, FIRST_SEASON on, at /series/<a>/<b> with the slugs in alphabetical order. The
// record comes from unconfirmed scores (ADR 0013), so the page says so and no game row names a winner (ADR 0004); a forfeit
// shows the word, never 1-0 or 2-0; and no page names a source.
test.use({ serviceWorkers: "block" });

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
  test(`${pair.join(" vs ")}: the record is the first team's, and it adds up to the meetings listed`, async ({ page }) => {
    await open(page, pair);
    const line = (await page.locator("header p").filter({ hasText: /against/ }).textContent())!;
    const [, won, lost, tied = "0", meetings] = line.match(new RegExp(`(\\d+)-(\\d+)(?:-(\\d+))? for .+ against .+ since ${FIRST_SEASON} · (\\d+) meetings`))!.map((x, i) => (i ? x : undefined)) as string[];
    const list = rows(page);
    await expect(list).toHaveCount(Number(meetings));
    expect(Number(won) + Number(lost) + Number(tied)).toBe(Number(meetings));
    // From the scores on the page itself (away team first): the first-named team's wins and losses, where a score is shown.
    const first = (await page.getByRole("heading", { level: 1 }).textContent())!.split(" vs ")[0];
    const labels = await list.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("aria-label")!));
    let [w, l, t, forfeits] = [0, 0, 0, 0];
    for (const label of labels) {
      const m = label.match(/^[A-Za-z]+ \d+, \d{4}, (.+) vs (.+?), (forfeit|(\d+)-(\d+)), game page$/)!;
      expect(m, label).not.toBeNull();
      if (m[3] === "forfeit") {
        forfeits += 1;
        continue;
      }
      const [away, home, awayScore, homeScore] = [m[1], m[2], Number(m[4]), Number(m[5])];
      const [us, them] = away === first ? [awayScore, homeScore] : [homeScore, awayScore];
      expect([away, home]).toContain(first);
      if (us > them) w += 1;
      else if (us < them) l += 1;
      else t += 1;
    }
    // A forfeit's side is not on the page (only the word is), so it can make up the difference but never exceed it.
    expect(w).toBeLessThanOrEqual(Number(won));
    expect(l).toBeLessThanOrEqual(Number(lost));
    expect(t).toBeLessThanOrEqual(Number(tied));
    expect(Number(won) - w + (Number(lost) - l) + (Number(tied) - t)).toBe(forfeits);
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

test("a state final between the two shows in its own section, and a pair with none has no finals section", async ({ page }) => {
  await open(page, ["benjamin", "loraine"]); // the 2022 Division II final, from the state final archive
  const finals = page.getByRole("region", { name: "State finals" });
  await expect(finals.getByRole("listitem")).toHaveCount(1);
  await expect(finals.getByRole("listitem")).toContainText(/2022\s*Champion Benjamin · Div II\s*Runner-up Loraine\s*68-20/);
  // The same game is also one of the meetings, named by its round.
  await expect(rows(page).filter({ hasText: "2022 playoffs · UIL Division II · State final" })).toHaveCount(1);
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

test("the reversed address has no page of its own", async ({ request }) => {
  const res = await request.get("/series/jayton/guthrie", { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  expect((await request.get("/series/guthrie/jayton", { maxRedirects: 0 })).status()).toBe(200);
});

test("no winner, betting or source words on the page", async ({ page }) => {
  for (const pair of [JAYTON, FORFEIT, LONG]) {
    await open(page, pair);
    // A school can be named "Victory" or "Beat": strip the two names before looking for the words.
    const names = (await page.getByRole("heading", { level: 1 }).textContent())!.split(" vs ");
    // The site's own address appears in the page's breadcrumb markup, the one place "sixmanfootball" may.
    let text = ((await page.locator("article").textContent()) ?? "").replaceAll("txsixmanfootball.com", "");
    for (const n of names) text = text.replaceAll(n, "");
    expect(text).not.toMatch(WINNER);
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
  // All opponents: a games count is a link exactly when the pair met three times or more.
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
    expect(c.href !== null, `${c.games} games`).toBe(c.games >= 3);
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
  const game = await page.getByRole("main").locator('a[href^="/scores/"]').first().getAttribute("href");
  await page.goto(game!);
  const link = page.getByRole("link", { name: new RegExp(`^Every (Guthrie and Jayton|Jayton and Guthrie) game since ${FIRST_SEASON}$`) });
  await expect(link).toHaveAttribute("href", `/series/${JAYTON.join("/")}`);
  expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.goto("/scores/g1"); // an invented sample game: no series
  await expect(page.getByRole("link", { name: new RegExp(`game since ${FIRST_SEASON}$`) })).toHaveCount(0);
});

test("each meeting's game page has a title of its own: the teams, the score and the round or date", async ({ page }) => {
  await page.goto(`/series/${JAYTON.join("/")}`);
  const games = [...new Set(await page.getByRole("main").locator('a[href^="/scores/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))];
  const titles: string[] = [];
  for (const href of games) {
    await page.goto(href);
    titles.push(await page.title());
  }
  expect(titles.length).toBeGreaterThanOrEqual(3);
  for (const t of titles) expect(t).toMatch(/^((Guthrie|Jayton) \d+, (Guthrie|Jayton) \d+ · .+|(Guthrie vs Jayton|Jayton vs Guthrie) football score, [A-Z][a-z]{2} \d{1,2}, \d{4}) \| TX Six-Man Football$/);
  expect(new Set(titles).size).toBe(titles.length);
});
