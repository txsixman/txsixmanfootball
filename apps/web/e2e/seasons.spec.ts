import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { noLiveScores } from "./live-route";

// The season hubs (/seasons, /seasons/<year>): one page per season with games read, 2021 to the current season. Every
// expectation comes from the same lib the site is built from. The pages are static and no request reaches Supabase.
noLiveScores(test);
test.setTimeout(600_000); // the dev server compiles each linked route the first time it is asked (CI serves a build)

// No game row names a winner from an unconfirmed score (ADR 0004); the state finals are official, so "Champion" is fine.
const WINNER_WORDS = /\b(won|beat|beats|defeated|defeats|winner|wins|winning|victory|loser|lost|leads?|leading|ahead)\b/i;
const BETTING_OR_SOURCE = /\b(spreads?|odds|lines?|bets?|bettors?|favou?rites?|underdogs?|locks?|sources?|maxpreps)\b/i;
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

let cached: Promise<Awaited<ReturnType<typeof build>>> | undefined;
const fixtures = () => (cached ??= inWeb(build));

async function build() {
  const { hubSeasons, loadSeasonHub } = await import("../lib/season-hub");
  const { CURRENT_SEASON } = await import("../lib/season");
  const seasons = await hubSeasons();
  const hubs = new Map(await Promise.all(seasons.map(async (s) => [s, await loadSeasonHub(s)] as const)));
  return { seasons, hubs, CURRENT_SEASON };
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
    short: [...document.querySelectorAll("main a, main button")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height < 44;
      })
      .map((el) => `${el.textContent?.trim().slice(0, 40)} (${Math.round(el.getBoundingClientRect().height)}px)`),
  }));
  expect(m).toEqual({ overflow: 0, short: [] });
  expect(errors).toEqual([]);
}

async function checkWords(page: Page, teams: string[]) {
  // A school's own name may hold such a word (Victory Christian Academy): leave the teams out, longest first.
  let text = await page.locator("main").innerText();
  for (const name of [...new Set(teams)].sort((a, b) => b.length - a.length)) text = text.split(name).join(" ");
  expect(plain(text)).not.toMatch(WINNER_WORDS);
  expect(text).not.toMatch(BETTING_OR_SOURCE);
  expect(text).not.toMatch(/80x40|\/Users\//);
}

test("the index lists every season with games, newest first, each linking to its page", async ({ page }) => {
  const { seasons, hubs } = await fixtures();
  expect(seasons.length).toBeGreaterThanOrEqual(5);
  expect(seasons.at(-1)).toBe(2021);
  await checkPage(page, "/seasons");
  const links = await page.locator("main ol a[href^='/seasons/']").evaluateAll((els) => els.map((a) => a.getAttribute("href")));
  expect(links).toEqual(seasons.map((s) => `/seasons/${s}`));
  for (const s of seasons) await expect(page.locator(`main a[href='/seasons/${s}']`)).toContainText(`${hubs.get(s)!.games.toLocaleString("en-US")} games`);
  await expect(page.locator("main").getByRole("link", { name: /2026/ })).toContainText("under way");
  await expect(page).toHaveTitle(/^Six-man football seasons \| /);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/seasons$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Seasons");
  await checkWords(page, []);
});

test("2025: the UIL finals, one section per organization with five ranked teams, leaders and week links", async ({ page, request }) => {
  const { hubs } = await fixtures();
  const hub = hubs.get(2025)!;
  expect(hub.orgs.map((o) => o.org.label)).toContain("UIL");
  await checkPage(page, "/seasons/2025");
  const teams: string[] = [];
  const main = page.locator("main");
  await expect(page).toHaveTitle(/^2025 six-man football season \| /);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/seasons\/2025$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2025 season");
  await expect(main).toContainText(`${hub.games.toLocaleString("en-US")} games read from ${hub.programs} programs`);
  await expect(main).toContainText("Scores are not confirmed here");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("2025 season");
  // A past season says how many of today's schools it reaches.
  expect(hub.coverage.played).toBeLessThanOrEqual(hub.coverage.total);
  await expect(page.locator("#season-coverage")).toHaveText(`Games from ${hub.coverage.played} of ${hub.coverage.total} schools for this season.`);

  // The UIL state finals: one row per division, champion, runner-up and score (UIL's own archive).
  expect(hub.finals.length).toBeGreaterThanOrEqual(2);
  const finals = page.locator("section[aria-labelledby='finals'] li");
  await expect(finals).toHaveCount(hub.finals.length);
  for (const [i, f] of hub.finals.entries()) {
    const row = finals.nth(i);
    await expect(row).toContainText(`Division ${f.division}`);
    await expect(row).toContainText(f.champion);
    await expect(row).toContainText(f.runnerUp);
    await expect(row).toContainText(`${f.championScore}-${f.runnerUpScore}`);
    teams.push(f.champion, f.runnerUp);
  }

  // One section per organization with a game that season, never merged; each has its own five (or fewer, when it has fewer ranked).
  const sections = page.locator("section[aria-labelledby^='org-']");
  await expect(sections).toHaveCount(hub.orgs.length);
  for (const o of hub.orgs) {
    const section = page.locator(`section[aria-labelledby='org-${o.org.slug}']`);
    await expect(section.getByRole("heading", { level: 2 })).toHaveText(o.org.label);
    const top = section.locator(`ol[aria-labelledby='org-${o.org.slug}-top'] > li`);
    expect(o.top.length, `${o.org.label} has ranked teams`).toBe(Math.min(5, o.ranked));
    await expect(top).toHaveCount(o.top.length);
    for (const [i, t] of o.top.entries()) {
      await expect(top.nth(i)).toContainText(t.name);
      await expect(top.nth(i).locator(`a[href='/programs/${t.slug}']`)).toHaveCount(1);
      teams.push(t.name);
    }
    for (const kind of ["scored", "allowed"] as const) {
      const rows = section.locator(`ol[aria-labelledby='org-${o.org.slug}-${kind}'] > li`);
      expect(o[kind].length).toBeLessThanOrEqual(3);
      await expect(rows).toHaveCount(o[kind].length);
      for (const [i, l] of o[kind].entries()) {
        expect(l.games).toBeGreaterThanOrEqual(6);
        await expect(rows.nth(i)).toContainText(l.team);
        await expect(rows.nth(i)).toContainText(l.average.toFixed(1));
        teams.push(l.team);
      }
    }
    await expect(section.getByRole("link", { name: `Full ${o.org.label} rankings for 2025` })).toHaveAttribute("href", o.org.slug === "uil" ? "/rankings/season/2025" : `/rankings/season/2025/${o.org.slug}`);
    await expect(section).toContainText("forfeits are left out");
  }
  // Another organization's teams never sit in a section (ADR 0012): the TAPPS section carries no UIL top-five team.
  const uil = hub.orgs.find((o) => o.org.slug === "uil")!;
  const tapps = hub.orgs.find((o) => o.org.slug === "tapps");
  if (tapps) for (const t of uil.top) await expect(page.locator("section[aria-labelledby='org-tapps']")).not.toContainText(t.name);

  // Every week link answers 200 and so does each way out of the page.
  const weekLinks = await page.locator("section[aria-labelledby='weeks'] ol a").evaluateAll((els) => els.map((a) => a.getAttribute("href")!));
  expect(weekLinks.length).toBe(hub.weeks.length + hub.reviewWeeks.length);
  expect(weekLinks).toContain(`/results/2025/${hub.weeks[0].number}`);
  const others = await main.locator("a[href^='/']").evaluateAll((els) => [...new Set(els.map((a) => a.getAttribute("href")!.split("#")[0]))]);
  for (const href of new Set([...weekLinks, ...others])) {
    const res = await request.get(href, { maxRedirects: 0 });
    // The latest season's bare addresses never redirect from here; a link that did would be a 3xx.
    expect(res.status(), href).toBe(200);
  }
  expect(others).toEqual(expect.arrayContaining(["/results/2025", "/playoffs/season/2025", "/records", "/seasons", "/championships"]));
  await checkWords(page, teams);
});

test("every past season's hub carries the coverage line, with no more schools played than listed", async ({ page }) => {
  const { seasons, hubs, CURRENT_SEASON } = await fixtures();
  for (const s of seasons.filter((y) => y < CURRENT_SEASON)) {
    const { played, total } = hubs.get(s)!.coverage;
    expect(played, String(s)).toBeLessThanOrEqual(total);
    expect(played, String(s)).toBeGreaterThan(0);
    await page.goto(`/seasons/${s}`);
    await expect(page.locator("#season-coverage")).toHaveText(`Games from ${played} of ${total} schools for this season.`);
  }
});

test("2026: the finals are in December, with the playoffs one tap away; links use the bare addresses", async ({ page, request }) => {
  const { hubs, CURRENT_SEASON } = await fixtures();
  const hub = hubs.get(CURRENT_SEASON)!;
  expect(hub.latest).toBe(true);
  await checkPage(page, `/seasons/${CURRENT_SEASON}`);
  const finals = page.locator("section[aria-labelledby='finals']");
  if (hub.finals.length === 0) {
    await expect(finals).toContainText("state finals are in December");
    await expect(finals.getByRole("link", { name: "UIL playoffs" })).toHaveAttribute("href", "/playoffs");
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${CURRENT_SEASON} season`);
  await expect(page.locator("main")).toContainText("so far");
  await expect(page.locator("#season-coverage")).toHaveCount(0); // the season under way has no coverage line
  const hrefs = await page.locator("main a[href^='/']").evaluateAll((els) => [...new Set(els.map((a) => a.getAttribute("href")!.split("#")[0]))]);
  // The season under way lives at the bare addresses, which a redirect would otherwise send visitors through.
  expect(hrefs).toEqual(expect.arrayContaining(["/results", "/rankings", "/playoffs"]));
  expect(hrefs).not.toContain(`/results/${CURRENT_SEASON}`);
  expect(hrefs).not.toContain(`/rankings/season/${CURRENT_SEASON}`);
  for (const href of hrefs) expect((await request.get(href, { maxRedirects: 0 })).status(), href).toBe(200);
});

test("an unknown year answers 404", async ({ page }) => {
  for (const url of ["/seasons/1999", "/seasons/2099", "/seasons/abc"]) {
    expect((await page.goto(url))?.status(), url).toBe(404);
  }
});

test("a season page fits a phone and every target is at least 44px (phone width)", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone widths only");
  const { hubs } = await fixtures();
  for (const s of [2025, 2021, [...hubs.keys()][0]]) {
    await page.goto(`/seasons/${s}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll("a[href], button")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          // The skip link is out of sight until focused (audit-a11y.spec.ts checks it then).
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44) && !el.matches("a[href='#main']");
        })
        .map((el) => `${el.textContent?.trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
    }));
    expect(m, `/seasons/${s}`).toEqual({ overflow: 0, small: [] });
  }
});

test("every season's page answers 200 with a state final or a note, and the site footer links the index", async ({ page }) => {
  const { seasons, hubs } = await fixtures();
  for (const s of seasons) {
    expect((await page.goto(`/seasons/${s}`))?.status(), String(s)).toBe(200);
    const hub = hubs.get(s)!;
    await expect(page.locator("section[aria-labelledby='finals'] li, section[aria-labelledby='finals'] p").first()).toBeVisible();
    await expect(page.locator("section[aria-labelledby^='org-']")).toHaveCount(hub.orgs.length);
  }
  await page.goto("/");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Seasons" })).toHaveAttribute("href", "/seasons");
  await expect(page.getByRole("banner").getByRole("link", { name: "Seasons" })).toHaveCount(0);
});
