import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import path from "node:path";
import { noLiveScores } from "./live-route";

// A bracket game's page names where it is played (ADR 0041): "Site: <name>, <city>" once the site is known, "Site not
// listed yet" until then. The home team of a bracket game is only its designation, so it is never shown as the site, and
// the page never says where the site came from. Fixtures come from the same lib the site is built from.
noLiveScores(test);

type Fixture = { id: string; site: string; home: string; address?: string; directions?: string; kickoff?: string };
let cached: Promise<{ sited?: Fixture; unsited?: Fixture; addressed?: Fixture; upcoming?: Fixture }> | undefined;
const fixtures = () =>
  (cached ??= (async () => {
    const was = process.cwd();
    process.chdir(path.join(__dirname, ".."));
    try {
      const { loadAlignments } = await import("../lib/alignments");
      const { loadGames } = await import("../lib/games");
      const { NO_SITE } = await import("../lib/kickoffs");
      const { addressLine, directionsUrl } = await import("../lib/address");
      const { kickoffTime } = await import("../lib/kickoff");
      const games = (await loadGames(await loadAlignments())).filter((g) => g.date);
      const pick = (want: (g: (typeof games)[number]) => boolean) => {
        const g = games.find(want);
        return g && { id: g.id, site: g.venue, home: g.home.name, ...(g.address && { address: addressLine(g.address), directions: directionsUrl(g.venue, g.address) }), ...(g.state === "scheduled" && g.kickoff && { kickoff: kickoffTime(g.kickoff) }) };
      };
      return {
        sited: pick((g) => g.venue !== NO_SITE && g.venue.includes(", ")),
        unsited: pick((g) => g.venue === NO_SITE),
        addressed: pick((g) => g.venue !== NO_SITE && Boolean(g.address)),
        upcoming: pick((g) => g.state === "scheduled" && Boolean(g.kickoff)),
      };
    } finally {
      process.chdir(was);
    }
  })());

const siteFact = (page: import("@playwright/test").Page) => page.locator("dl div", { has: page.locator("dt", { hasText: /^Site$/ }) }).locator("dd");

test("a bracket game with a known site shows it as '<name>, <city>', naming no source", async ({ page }) => {
  const { sited } = await fixtures();
  test.skip(!sited, "no bracket game has a site yet");
  await page.goto(`/scores/${sited!.id}`);
  await expect(siteFact(page)).toContainText(sited!.site);
  await expect(siteFact(page)).not.toContainText(/\(home\)/);
  expect((await page.locator("main").innerText()).toLowerCase()).not.toMatch(/maxpreps|dave campbell|sixmanfootball/);
});

test("a bracket game whose site is not known says 'Site not listed yet', never the home team's field", async ({ page }) => {
  const { unsited } = await fixtures();
  test.skip(!unsited, "every bracket game has a site");
  await page.goto(`/scores/${unsited!.id}`);
  await expect(siteFact(page)).toHaveText("Site not listed yet");
});

// ADR 0066: the site's street address under it, and Directions, a maps search with no key and no embedded map.
test("a game with a site address shows the address and a Directions link under the site, accessible", async ({ page }) => {
  const { addressed } = await fixtures();
  test.skip(!addressed, "no bracket game has a site address yet");
  await page.goto(`/scores/${addressed!.id}`);
  await expect(siteFact(page).locator("[data-address]")).toContainText(addressed!.address!);
  const link = siteFact(page).getByRole("link", { name: /^Directions to / });
  await expect(link).toHaveAttribute("href", addressed!.directions!);
  await expect(link).not.toHaveAttribute("href", /key=|embed/);
  await expect(page.locator("main iframe")).toHaveCount(0);
  expect((await page.locator("main").innerText()).toLowerCase()).not.toMatch(/maxpreps|dave campbell|sixmanfootball/);
  const axe = await new AxeBuilder({ page }).include("dl").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

// Game night: a fan heading to the game finds the day, the kickoff and the site before anything else on the page.
test("a game still to play shows its kickoff with its day, and its details come before the alerts", async ({ page }) => {
  const { upcoming } = await fixtures();
  test.skip(!upcoming, "no game is waiting to be played");
  await page.goto(`/scores/${upcoming!.id}`);
  const kickoff = page.locator("dl div", { has: page.locator("dt", { hasText: /^Kickoff$/ }) }).locator("dd");
  await expect(kickoff).toContainText(upcoming!.kickoff!);
  const details = await page.getByRole("region", { name: "Game details" }).boundingBox();
  const alerts = page.getByRole("region", { name: "Follow these teams" });
  if (await alerts.count()) expect(details!.y).toBeLessThan((await alerts.boundingBox())!.y);
});
