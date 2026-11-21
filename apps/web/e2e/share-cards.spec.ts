import { expect, test } from "@playwright/test";
import path from "node:path";
import { demoGames } from "../lib/demo-games";
import { noLiveScores } from "./live-route";

// A shared game, program or State Championship link previews a card of its own (ADR 0093): the page's og:image and twitter:image
// are its card, a 1200 by 630 PNG, with a large Twitter card and alt text that says what the card shows (the score of a final, or
// the matchup, day, time and site of a game still to play).
noLiveScores(test);
test.setTimeout(180_000); // the dev server draws each card on first request

const SIZE = { width: 1200, height: 630 };

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

/** A name as literal text in a regular expression: school names hold parentheses and dots. */
const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Case = { name: string; url: string; card: string; alt: RegExp };

/** A current-season game with a score, and one still to play, from the same files the site is built from; none of a kind (in the
 * offseason) leaves it out, logged. */
const gameCases = (): Promise<Case[]> =>
  inWeb(async () => {
    const { loadSeasonResults } = await import("../lib/games");
    const { bracketGames, builtGamePages } = await import("../lib/game-pages");
    const cases: Case[] = [];
    const played = (await loadSeasonResults(2026)).find((r) => r.href === `/scores/${r.id}` && !r.forfeit);
    if (played) cases.push({ name: "a game with a score", url: played.href, card: `${played.href}/card`, alt: new RegExp(`^(Final score|Score reported, not confirmed), .+: ${esc(played.away)} \\d+, ${esc(played.home)} \\d+\\.`) });
    const ahead = [...(await bracketGames()), ...(await builtGamePages())].find((g) => g.state === "scheduled" && !demoGames.includes(g));
    if (ahead) cases.push({ name: "a game still to play", url: `/scores/${ahead.id}`, card: `/scores/${ahead.id}/card`, alt: new RegExp(`^Scheduled, .+: ${esc(ahead.away.name)} versus ${esc(ahead.home.name)}, `) });
    else console.warn("skipped: no game is still to play");
    return cases;
  });

/** How a card's alt text names a side: a known team by name; an open side ("Winner of G29" on the bracket) as "the team that
 * wins game 29", never "winner" (ADR 0093). */
const sideAlt = (side: { team?: string; text: string }) => {
  if (side.team !== undefined) return side.text;
  const token = /^Winner of (.+)$/.exec(side.text)?.[1];
  return token ? `the team that wins ${token.replace(/^G(\d+)$/, "game $1").replace(/^SF(\d+)$/, "semifinal $1")}` : "a team to be decided";
};

/** A State Championship with a recorded champion, and one still to play. */
const championshipCases = (): Promise<Case[]> =>
  inWeb(async () => {
    const { stateChampionships } = await import("../lib/state-championships");
    const all = await stateChampionships(2026);
    const cases: Case[] = [];
    const done = all.find((c) => c.final && !c.final.forfeit);
    if (done) cases.push({ name: "a recorded State Championship", url: done.href, card: `${done.href}/card`, alt: new RegExp(`^2026 ${esc(done.bracket)} State Championship: ${esc(done.final!.champion)}, State Champion\\. Final score \\d+ to \\d+ over ${esc(done.final!.runnerUp)}`) });
    const ahead = all.find((c) => !c.final && !c.scores);
    if (ahead) cases.push({ name: "a State Championship still to play", url: ahead.href, card: `${ahead.href}/card`, alt: new RegExp(`^2026 ${esc(ahead.bracket)} State Championship: ${esc(sideAlt(ahead.sides[0]))} versus ${esc(sideAlt(ahead.sides[1]))}, `) });
    else console.warn("skipped: no State Championship is still to play");
    return cases;
  });

const content = (page: import("@playwright/test").Page, selector: string) => page.locator(selector).getAttribute("content");

/** Every page's preview names the site, its type and language, and its own public address (app/layout.tsx, lib/site.ts OPEN_GRAPH), whether or not the page sets its own card. */
async function checkSiteFields(page: import("@playwright/test").Page, name: string) {
  const here = new URL(page.url()).pathname;
  expect(await content(page, 'meta[property="og:site_name"]'), `${name} og:site_name`).toBe("TX Six-Man Football");
  expect(await content(page, 'meta[property="og:type"]'), `${name} og:type`).toBe("website");
  expect(await content(page, 'meta[property="og:locale"]'), `${name} og:locale`).toBe("en_US");
  const noSlash = (u: string | null) => u?.replace(/\/$/, "");
  expect(noSlash(await content(page, 'meta[property="og:url"]')), `${name} og:url`).toBe(`https://txsixmanfootball.com${here}`.replace(/\/$/, ""));
}

test("every page's link preview names the site, and keeps its own title and description", async ({ page }) => {
  for (const url of ["/", "/scores", "/programs/jayton", "/results/2025/9/tapps"]) {
    await page.goto(url);
    await checkSiteFields(page, url);
    expect(await content(page, 'meta[property="og:title"]'), url).toBe(await page.title());
    expect(await content(page, 'meta[property="og:description"]'), url).toBe(await content(page, 'meta[name="description"]'));
  }
});

async function checkCard(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, { name, url, card, alt }: Case) {
  await page.goto(url);
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    expect(await page.locator(selector).count(), `${name} ${selector}`).toBe(1);
    expect(await content(page, selector), `${name} ${selector}`).toContain(card);
  }
  await expect(page.locator('meta[name="twitter:card"]'), name).toHaveAttribute("content", "summary_large_image");
  await expect(page.locator('meta[property="og:image:width"]'), name).toHaveAttribute("content", String(SIZE.width));
  await expect(page.locator('meta[property="og:image:height"]'), name).toHaveAttribute("content", String(SIZE.height));
  for (const selector of ['meta[property="og:image:alt"]', 'meta[name="twitter:image:alt"]']) expect(await content(page, selector), `${name} ${selector}`).toMatch(alt);
  await checkSiteFields(page, name);
  const image = new URL((await content(page, 'meta[property="og:image"]'))!);
  const res = await request.get(image.pathname + image.search);
  expect(res.status(), name).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  // A PNG's IHDR holds its width and height.
  const body = await res.body();
  expect([body.readUInt32BE(16), body.readUInt32BE(20)], name).toEqual([SIZE.width, SIZE.height]);
}

test("a shared game link previews its own card: the score of a final, the matchup, day, time and site of a game ahead", async ({ page, request }) => {
  for (const c of await gameCases()) await checkCard(page, request, c);
});

test("a shared State Championship link previews its own card: the champion and score, or the matchup", async ({ page, request }) => {
  for (const c of await championshipCases()) await checkCard(page, request, c);
});

test("a shared program link previews the school's own card, and so does each of its season pages", async ({ page, request }) => {
  await checkCard(page, request, { name: "a program", url: "/programs/jayton", card: "/programs/jayton/card", alt: /^Jayton Jaybirds football, UIL Division I · .+\. 2026: / });
  await checkCard(page, request, { name: "a program's season", url: "/programs/jayton/2025", card: "/programs/jayton/card", alt: /^Jayton Jaybirds football/ });
  // A season page has no image route of its own.
  expect((await request.get("/programs/jayton/2025/card")).status()).toBe(404);
});

test("the sample game has a card too, and a card's alt text never says winner or leading", async ({ page, request }) => {
  const sample = await request.get("/scores/g2/card");
  expect(sample.status()).toBe(200);
  expect(sample.headers()["content-type"]).toBe("image/png");
  for (const c of [...(await gameCases()), ...(await championshipCases())]) {
    await page.goto(c.url);
    expect(await content(page, 'meta[property="og:image:alt"]'), c.name).not.toMatch(/winner|leading/i);
  }
});
