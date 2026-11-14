import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";

// Every public page has its own meta description, built from its own data (lib/descriptions.ts): not the site-wide one, at
// most 160 characters, one per page, and with no betting word, source name or winner. One page of each kind in the sitemap.
test.use({ serviceWorkers: "block" });
noLiveScores(test); // the game pages ask for live scores: none reach the network
test.setTimeout(600_000); // the dev server compiles each route the first time it is asked

const SITE_WIDE = "Texas six-man football: scores, rankings, playoffs, standings and every state championship.";
const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b/i;
const SOURCE = /maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;
const WINNER = /\b(won|beat|defeated|winner|victory)\b/i;
const CODENAME = /80x40|brady|dcs2|\/Users\//i;

async function sitemapPaths(page: Page) {
  const xml = await (await page.request.get("/sitemap.xml")).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace("https://txsixmanfootball.com", "") || "/");
}

const description = (page: Page) => page.locator('meta[name="description"]').getAttribute("content");

test("every kind of page has its own short description, with no betting word, source or winner", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "a page's meta tags do not depend on the viewport");
  const map = await sitemapPaths(page);
  const first = (re: RegExp) => {
    const found = map.find((p) => re.test(p));
    expect(found, `a sitemap page matching ${re}`).toBeTruthy();
    return found!;
  };
  const pages: [string, string][] = [
    ["home", "/"],
    ["scores", "/scores"],
    ["tonight", "/scores/tonight"],
    ["playoffs", "/playoffs"],
    ["results", "/results"],
    ["rankings", "/rankings"],
    ["how", "/rankings/how"],
    ["standings", "/standings"],
    ["programs", "/programs"],
    ["records", "/records"],
    ["championships", "/championships"],
    ["matchup", "/matchup"],
    ["weeks", "/weeks"],
    ["program", "/programs/jayton"],
    ["program, another", first(/^\/programs\/(?!jayton$)[^/]+$/)],
    ["program season", "/programs/jayton/2025"],
    ["program season, another", first(/^\/programs\/(?!jayton\/)[^/]+\/2025$/)],
    ["game, regular season", first(/^\/scores\/2026-\d\d-\d\d-/)],
    ["game, playoffs", first(/^\/scores\/2026-(bi-district|area|quarterfinal|regional|semifinal|final)-/)],
    ["game, past season", first(/^\/scores\/2025-\d\d-\d\d-/)],
    ["results week", "/results/2025/9"],
    ["results season", "/results/2025"],
    ["results week, TAPPS", "/results/2025/9/tapps"],
    ["rankings division", "/rankings/division-1"],
    ["rankings organization", "/rankings/tapps"],
    ["rankings season", "/rankings/season/2025"],
    ["rankings season organization", "/rankings/season/2025/tapps"],
    ["rankings week", first(/^\/rankings\/week\/\d+$/)],
    ["rankings week organization", first(/^\/rankings\/week\/\d+\/tapps$/)],
    ["standings group", "/standings/tapps"],
    ["standings division", "/standings/division-2"],
    ["playoff league", "/playoffs/tapps"],
    ["playoff season", "/playoffs/season/2025"],
    ["playoff season league", "/playoffs/season/2025/tapps"],
    ["bracket", first(/^\/playoffs\/bracket\//)],
    ["records organization", "/records/tapps"],
    ["week in review", first(/^\/weeks\/\d{4}\/\d+$/)],
    ["week in review, TAPPS", first(/^\/weeks\/\d{4}\/\d+\/tapps$/)],
    ["weeks, TAPPS", "/weeks/tapps"],
  ];

  const seen = new Map<string, string>();
  for (const [kind, path] of pages) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), path).toBe(200);
    const text = await description(page);
    const label = `${kind} (${path})`;
    expect(text, label).toBeTruthy();
    if (!text) continue;
    expect.soft(text, `${label} keeps the site-wide description`).not.toBe(SITE_WIDE);
    expect.soft(text.length, `${label} is ${text.length} characters: ${text}`).toBeLessThanOrEqual(160);
    expect.soft(seen.get(text), `${label} repeats ${seen.get(text)}`).toBeUndefined();
    seen.set(text, label);
    expect.soft(text, label).not.toMatch(BETTING);
    expect.soft(text, label).not.toMatch(SOURCE);
    expect.soft(text, label).not.toMatch(CODENAME);
    expect.soft(text, label).not.toMatch(/unconfirmed/i);
    // A school's own name may hold such a word (Victory Christian Academy-Decatur): leave the page's team names out, longest first.
    const names = (await page.title()).replace(/ \| .*$/, "").split(" vs ").sort((a, b) => b.length - a.length);
    expect.soft(names.reduce((t, n) => t.split(n).join(" "), text), `${label} names a winner`).not.toMatch(WINNER);
    // A game's description never holds a score ("21-14"), only its date, teams and round.
    if (kind.startsWith("game")) expect.soft(text, `${label} holds a score`).not.toMatch(/\d\s*[-–]\s*\d/);
    if (kind.startsWith("game")) expect.soft(text, label).toContain(await page.title().then((t) => t.replace(/ \| .*$/, "")));
  }
  expect(seen.size).toBe(pages.length);
});

test("a program's description carries the record, rank and state titles its own page shows", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "a page's meta tags do not depend on the viewport");
  await page.goto("/programs/jayton", { waitUntil: "domcontentloaded" });
  const text = (await description(page))!;
  expect(text).toMatch(/^Jayton six-man football: 2026 record \d+-\d+(-\d+)?, \d+(st|nd|rd|th) in UIL Division (I|II)\./);
  const header = page.locator("main dl").first();
  await expect(header).toContainText(/record/i);
  await expect(header).toContainText(/(\d+-\d+(?:-\d+)?)/.exec(text)![1]);
  const titles = /(\d+) UIL state titles?/.exec(text);
  expect(titles, "Jayton has state titles").toBeTruthy();
  await expect(page.locator("main")).toContainText(`${titles![1]} UIL state title`);
  // The same words the header shows for district: the description's place is the page's own.
  const place = /Region (\d+), District (\d+)/.exec(text);
  expect(place).toBeTruthy();
  await expect(page.locator("main")).toContainText(`District ${place![2]}`);
});
