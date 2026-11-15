import path from "node:path";
import { expect, test } from "@playwright/test";
import { bracketHref, loadBrackets } from "../lib/brackets";
import { noLiveScores } from "./live-route";

// Who is projected to go on (ADR 0071), on a phone: a UIL bracket's projected sides and its "Chance to reach each
// round" table, and a team's one line on its program page. The data changes every week, so what to expect comes from
// the same data the pages are built from.
noLiveScores(test);

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|picks?|underdogs?|favou?rites?)\b/i;

/** The loaders read ../../data from the working directory; the tests run from the repo root (as bracket-tree.spec.ts does). */
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

test("a UIL bracket: every side no game sets shows its projected team, and the table reads at 375 px", async ({ page }) => {
  const b = (await brackets()).find((x) => x.league === "UIL" && x.advancement);
  test.skip(!b, "no UIL bracket still in play");
  const a = b!.advancement!;
  await page.goto(bracketHref(b!.name));
  const main = page.locator("main");
  // One projected row a side the bracket has not set, each marked "Projected" with its chance, or too few games.
  const waiting = b!.tree.filter((n) => n.state === "open").flatMap((n) => n.projected ?? []).filter(Boolean).length;
  expect(waiting).toBeGreaterThan(0);
  await expect(main.locator("[data-rounds] [data-projected]")).toHaveCount(waiting);
  for (const text of await main.locator("[data-rounds] [data-projected]").allInnerTexts()) expect(text).toMatch(/^Projected\s+(>99%|<1%|\d+%)\s+\S|^Not enough games to project$/i);
  await expect(main.locator("[data-projected-note]")).toContainText("A projection, not a result.");

  const section = main.locator("[data-advance-table]");
  await expect(section.getByRole("heading", { name: "Chance to reach each round" })).toBeVisible();
  const table = section.locator("table");
  await expect(table.locator("tbody tr")).toHaveCount(a.rows.length);
  await expect(table.locator("thead th").last()).toHaveText("Win the State Championship");
  await expect(table.locator("tbody tr").first().locator("th")).toContainText(a.rows[0].team);
  await expect(section).toContainText("A projection, not a result.");
  expect(await section.innerText()).not.toMatch(BETTING);
  // The table may scroll sideways inside itself; the page never does.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("a program still in: one line with its next round and its State Championship chance", async ({ page }) => {
  const b = (await brackets()).find((x) => x.league === "UIL" && x.advancement?.rows.some((r) => r.title !== undefined));
  test.skip(!b, "no UIL bracket still in play");
  // The first team of the bracket's table, by its own link.
  await page.goto(bracketHref(b!.name));
  const link = page.locator("main [data-advance-table] tbody tr").first().locator("a");
  await expect(link).toContainText(b!.advancement!.rows[0].team);
  await page.goto((await link.getAttribute("href"))!);
  const line = page.locator("main [data-advance]");
  await expect(line).toHaveCount(1);
  await expect(line).toHaveText(/^Projected: .*\d+% to win the State Championship\. A projection, not a result\.$/);
  expect(await line.innerText()).not.toMatch(BETTING);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
