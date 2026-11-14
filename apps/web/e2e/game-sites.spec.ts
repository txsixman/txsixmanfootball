import { expect, test } from "@playwright/test";
import path from "node:path";
import { noLiveScores } from "./live-route";

// A bracket game's page names where it is played (ADR 0041): "Site: <name>, <city>" once the site is known, "Site not
// listed yet" until then. The home team of a bracket game is only its designation, so it is never shown as the site, and
// the page never says where the site came from. Fixtures come from the same lib the site is built from.
noLiveScores(test);

type Fixture = { id: string; site: string; home: string };
let cached: Promise<{ sited?: Fixture; unsited?: Fixture }> | undefined;
const fixtures = () =>
  (cached ??= (async () => {
    const was = process.cwd();
    process.chdir(path.join(__dirname, ".."));
    try {
      const { loadAlignments } = await import("../lib/alignments");
      const { loadGames } = await import("../lib/games");
      const { NO_SITE } = await import("../lib/kickoffs");
      const games = (await loadGames(await loadAlignments())).filter((g) => g.date);
      const pick = (want: (site: string) => boolean) => {
        const g = games.find((x) => want(x.venue));
        return g && { id: g.id, site: g.venue, home: g.home.name };
      };
      return { sited: pick((v) => v !== NO_SITE && v.includes(", ")), unsited: pick((v) => v === NO_SITE) };
    } finally {
      process.chdir(was);
    }
  })());

const siteFact = (page: import("@playwright/test").Page) => page.locator("dl div", { has: page.locator("dt", { hasText: /^Site$/ }) }).locator("dd");

test("a bracket game with a known site shows it as '<name>, <city>', naming no source", async ({ page }) => {
  const { sited } = await fixtures();
  test.skip(!sited, "no bracket game has a site yet");
  await page.goto(`/scores/${sited!.id}`);
  await expect(siteFact(page)).toHaveText(sited!.site);
  await expect(siteFact(page)).not.toContainText(/\(home\)/);
  expect((await page.locator("main").innerText()).toLowerCase()).not.toMatch(/maxpreps|dave campbell|sixmanfootball/);
});

test("a bracket game whose site is not known says 'Site not listed yet', never the home team's field", async ({ page }) => {
  const { unsited } = await fixtures();
  test.skip(!unsited, "every bracket game has a site");
  await page.goto(`/scores/${unsited!.id}`);
  await expect(siteFact(page)).toHaveText("Site not listed yet");
});
