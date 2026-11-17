import path from "node:path";
import { expect, test } from "@playwright/test";
import { bracketHref, loadBrackets } from "../lib/brackets";
import { slugify } from "../lib/slug";
import { noLiveScores } from "./live-route";

// The road to the State Championship on a program page (ADR 0104), on a phone: a team still in a bracket lists each round
// ahead, its next game first, every link at least 44 px, and no page scrolls sideways. What to expect comes from the same data
// the pages are built from, so the test holds as the playoffs go on.
noLiveScores(test);

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|picks?|underdogs?|favou?rites?)\b/i;

async function brackets() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await loadBrackets();
  } finally {
    process.chdir(was);
  }
}

test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "the phone width, 375 px"));

test("a team still in: its road lists the rounds ahead, next game first, ending in the State Championship", async ({ page }) => {
  const b = (await brackets()).find((x) => x.league === "UIL" && x.roads && [...x.roads.values()].some((r) => r.state === "alive" && r.steps.length > 1));
  test.skip(!b, "no UIL team with rounds ahead");
  // The first team of the bracket's who's-left list that has a road with rounds ahead, by its Path link.
  await page.goto(bracketHref(b!.name));
  const rows = page.locator("[data-whos-left] [data-left]");
  const count = await rows.count();
  let href: string | null = null;
  let road;
  for (let i = 0; i < count && !href; i++) {
    const key = await rows.nth(i).getAttribute("data-left");
    const found = [...b!.roads!].find(([team, r]) => slugify(team) === key && r.state === "alive" && r.steps.length > 0);
    if (!found) continue;
    road = found[1];
    href = await rows.nth(i).getByRole("link", { name: /^Path to the State Championship for / }).getAttribute("href");
  }
  expect(href).toMatch(/^\/programs\/[^#]+#road$/);
  await page.goto(href!);
  const section = page.getByRole("region", { name: "Road to the State Championship" });
  await expect(section).toBeVisible();
  const steps = section.locator("[data-road-step]");
  await expect(steps).toHaveCount(road!.steps.length);
  await expect(steps.first()).toHaveAttribute("data-road-step", "next");
  // Rounds in the bracket's own order, the last one the State Championship.
  const names = await steps.locator("[data-road-round]").allTextContents();
  expect(names.at(-1)).toMatch(/State Championship/);
  await expect(steps.first()).toContainText(/Chance to win it: (>99|<1|\d+)%|Not enough games/);
  // Every opponent names its chance of being there and a projection, and every link is at least 44 px.
  const text = await section.innerText();
  expect(text).toContain("A projection, not a result.");
  expect(text).not.toMatch(BETTING);
  expect(text).not.toMatch(/\b(winner|leading)\b/i);
  for (const link of await section.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, await link.innerText()).toBeGreaterThanOrEqual(43.5);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
  }
  // The next game's page, when it has one, is one tap away; the road never scrolls the page sideways.
  const gameLink = steps.first().getByRole("link", { name: /^Game page for / });
  if (await gameLink.count()) await expect(gameLink).toHaveAttribute("href", /^\/scores\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("a team that is out has no road section", async ({ page }) => {
  const all = await brackets();
  const out = all.flatMap((b) => [...(b.roads ?? [])].filter(([, r]) => r.state === "out").map(([team]) => ({ b, team })))[0];
  test.skip(!out, "no team is out yet");
  await page.goto(`/programs/${slugify(out!.team)}`);
  await expect(page.locator("[data-road]")).toHaveCount(0);
  await expect(page.locator("[data-road-out]").first()).toContainText(/^Out in the .+ round of the .+ bracket\.$/);
});
