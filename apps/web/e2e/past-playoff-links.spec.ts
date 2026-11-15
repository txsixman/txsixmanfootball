import { expect, test } from "@playwright/test";
import { noLiveScores } from "./live-route";

// A past season's bracket rounds may be named again from the whole bracket (ADR 0069), so no past page may link a game by a
// round-based address (`<season>-<round>-<away>-at-<home>`, the season under way's playoff pages, lib/games.ts
// playoffGameId). Every game link on a past season's bracket, season and team pages is a date page
// (`<date>-<away>-at-<home>`), and each one resolves.
test.use({ serviceWorkers: "block" });
noLiveScores(test);
test.setTimeout(300_000); // the dev server compiles each route the first time it is asked

const SEASON = 2021;
const PAGES = [
  `/playoffs/season/${SEASON}`,
  `/playoffs/season/${SEASON}/tapps`,
  `/playoffs/season/${SEASON}/taiao`,
  `/playoffs/season/${SEASON}/tcaf`,
  `/results/${SEASON}`,
  `/programs/san-marcos-academy/${SEASON}`,
  "/programs/san-marcos-academy",
];
/** A game page by date; the other /scores/ pages (tonight, live) are not games. */
const DATE_PAGE = /^\/scores\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+-at-[a-z0-9-]+$/;
const ROUND_PAGE = /^\/scores\/\d{4}-(round-\d+|bi-district|area|regional|quarterfinal|semifinal|final|state)-/;

test("a past season's pages link every game by its date page, never a round-based address, and each resolves", async ({ page, request }) => {
  const links = new Set<string>();
  for (const path of PAGES) {
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.status(), path).toBe(200);
    const hrefs = await page.locator('a[href^="/scores/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")!.split("#")[0]));
    for (const h of hrefs) {
      expect(h, `${path} links a round-based game page`).not.toMatch(ROUND_PAGE);
      if (DATE_PAGE.test(h) && h.startsWith(`/scores/${SEASON}-`)) links.add(h);
    }
  }
  expect(links.size, "past game links found").toBeGreaterThan(5);
  // Each linked past game page resolves (a capped sample, in a fixed order, so a run stays short).
  for (const h of [...links].sort().slice(0, 40)) expect((await request.get(h)).status(), h).toBe(200);
});
