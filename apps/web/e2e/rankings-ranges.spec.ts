import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CURRENT_SEASON } from "../lib/season";
import { placeRows } from "../lib/rank-range";
import { MOVE_THRESHOLD, movement, type RatingRow } from "../lib/ratings";
import { meetingScore, scheduleStats } from "../lib/schedule-strength";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// The ratings round's rankings pages: rating and rank ranges, tiers, NR, honest arrows, record strength, schedule, best win
// and worst loss, why a rating moved, and the scorecard on /rankings/how.

const row = (team: string, rating: number, sd: number | undefined, rated = 8, was?: number | null): RatingRow => ({ team, rating, sd, rated, won: 5, lost: 3, tied: 0, was });

test("a rank range is the places a team would hold one sd higher or lower, with the others where they are", () => {
  const placed = placeRows([row("A", 100, 10), row("B", 95, 10), row("C", 60, 10), row("D", 20, 10)]);
  expect(placed.get("A")).toMatchObject({ rank: 1, range: { best: 1, worst: 2 } }); // at 90 it would sit below B's 95
  expect(placed.get("B")).toMatchObject({ rank: 2, range: { best: 1, worst: 2 } }); // 105 tops A; 85 stays above C
  expect(placed.get("C")).toMatchObject({ rank: 3, range: { best: 3, worst: 3 } });
  expect(placed.get("D")?.range).toEqual({ best: 4, worst: 4 });
});

test("a team on too few games is NR and is left out of every other team's range", () => {
  const placed = placeRows([row("A", 100, 10), row("Few", 98, 10, 2), row("B", 90, 10)]);
  expect(placed.get("Few")).toEqual({}); // no rank, no range, no tier
  expect(placed.get("B")?.rank).toBe(2);
  expect(placed.get("B")?.range).toEqual({ best: 1, worst: 2 }); // "Few" would have been above B at 98
});

test("tiers hold teams whose range overlaps the tier leader's, never a chain of neighbors", () => {
  const rows = [100, 92, 84, 76, 68, 60].map((rating, i) => row(`T${i}`, rating, 5));
  const tiers = rows.map((r) => placeRows(rows).get(r.team)!.tier);
  // Ranges are rating +/- 5. T0 (95 to 105) overlaps T1 (87 to 97) only; T2 (79 to 89) starts the next tier, and so on.
  expect(tiers).toEqual([1, 1, 2, 2, 3, 3]);
  expect(placeRows([row("X", 10, undefined)]).get("X")).toEqual({ rank: 1 }); // no sd: a rank, no range and no tier
});

test("an arrow needs the rating to move more than the threshold", () => {
  expect(MOVE_THRESHOLD).toBe(4);
  const rows = [row("Up", 50, 5, 8, 44), row("Small", 40, 5, 8, 39), row("Edge", 30, 5, 8, 26), row("Gone", 20, 5, 8, null)];
  const moved = movement(rows)!;
  expect(moved.get("Up")).toBe(0); // 6 points, but it was and is first: no places moved
  expect(moved.get("Small")).toBe(0); // 1 point
  expect(moved.get("Edge")).toBe(0); // exactly 4 points: not more than 4
  expect(moved.get("Gone")).toBe("new");
  const swap = movement([row("A", 50, 5, 8, 40), row("B", 45, 5, 8, 49)])!;
  expect(swap.get("A")).toBe(1); // 10 points up, from second to first
  const nudge = movement([row("A", 50, 5, 8, 47), row("B", 48, 5, 8, 49)])!;
  expect([nudge.get("A"), nudge.get("B")]).toEqual([0, 0]); // places swapped on 3 and 1 points: no arrows
});

test("strength of record, schedule, best win and worst loss; a forfeit is never a best win and shows as a word", () => {
  const table = {
    games: 4,
    home_field: 4,
    sigma: 20,
    calibration: { family: "logistic" as const, scale: 16 },
    teams: ["Us", "Strong", "Weak", "Mid"].map((team, i) => row(team, [30, 60, -20, 10][i], 5)),
  };
  const game = (id: string, home: string, away: string, homeScore: number, awayScore: number, forfeit = false) => ({ id, href: `/scores/${id}`, date: `2026-10-0${id}`, status: id, home, away, homeScore, awayScore, forfeit });
  const stats = scheduleStats(
    table,
    [
      game("1", "Us", "Strong", 20, 21), // a close loss to the best team
      game("2", "Weak", "Us", 0, 40), // a win at the weakest
      game("3", "Us", "Mid", 2, 0, true), // a forfeit win over Mid: no figure, never the best win
      game("4", "Weak", "Mid", 0, 2, true), // a forfeit loss for Weak to Mid: a worst loss, shown as a word
    ],
    new Set(),
    30, // a benchmark team as good as Us
  );
  const us = stats.get("Us")!;
  expect(us.games).toBe(2); // the forfeit is left out
  expect(us.sos).toBeCloseTo((60 + -20) / 2);
  expect(us.wins).toBe(1);
  expect(us.best?.opponent).toBe("Weak"); // the forfeit over Mid is not a best win, and Strong was a loss
  expect(us.worst?.opponent).toBe("Strong");
  expect(meetingScore(us.worst!)).toBe("20-21");
  expect(us.sor).toBeCloseTo(us.wins - us.expected);
  // A benchmark as good as Us: it expects to beat Weak easily and lose to Strong, so 1-1 here is about even.
  expect(Math.abs(us.sor)).toBeLessThan(0.5);
  const weak = stats.get("Weak")!;
  expect(weak.worst).toMatchObject({ opponent: "Mid", forfeit: true });
  expect(meetingScore(weak.worst!)).toBe("Forfeit");
  expect(weak.best).toBeUndefined();
  // A harder schedule earns more record strength for the same wins: beating Strong counts for more than beating Weak.
  const beatStrong = scheduleStats(table, [game("1", "Strong", "Us", 0, 7)], new Set(), 30).get("Us")!;
  const beatWeak = scheduleStats(table, [game("1", "Weak", "Us", 0, 7)], new Set(), 30).get("Us")!;
  expect(beatStrong.sor).toBeGreaterThan(beatWeak.sor);
});

test("the rankings show a rating range, a rank range, tiers, and the wide columns only on a wide screen", async ({ page }, info) => {
  await page.goto("/rankings", { waitUntil: "networkidle" });
  const table = page.getByRole("table");
  const first = table.getByRole("row").nth(1);
  await expect(first).toContainText(/^1/);
  await expect(first).toContainText("Tier 1");
  await expect(first.locator("td").nth(1)).toHaveText(/\d+-\d+/); // W-L
  await expect(first.getByText(/^Rank range #\d+( to #\d+)?$/)).toBeVisible(); // the rank range
  await expect(first.getByText(/^±\d+give or take \d+$/)).toBeVisible(); // the rating's give-or-take
  expect(await table.getByText(/^Tier \d+$/).count()).toBeGreaterThan(2);
  const wide = info.project.name === "desktop";
  for (const name of ["Record strength", "Opp. rating", "Best win", "Worst loss"]) {
    await expect(table.getByRole("columnheader", { name })).toBeVisible({ visible: wide });
  }
  if (wide) {
    await expect(first.locator("td").nth(3)).toHaveText(/^[+−]?\d/); // record strength
    await expect(first.locator("td").nth(5)).not.toBeEmpty(); // a best win (a link to the opponent's program page)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("a team on few games shows NR in place of a rank, last, on the sample rankings", async ({ page }) => {
  await page.goto("/rankings/sample");
  const nr = page.getByRole("table").getByRole("row").filter({ hasText: "Not ranked: fewer than 4 games" });
  await expect(nr).toHaveCount(1);
  await expect(nr.getByRole("cell").first()).toHaveText(/NR/);
  await expect(page.getByRole("table").getByRole("row").last()).toContainText("NR");
});

test("an arrow shows only where the rating moved more than the threshold", async ({ page }) => {
  await page.goto("/rankings");
  const table: { teams: RatingRow[] } = JSON.parse(readFileSync(path.join(__dirname, `../../../data/ratings/${CURRENT_SEASON}.json`), "utf8"));
  const big = table.teams.filter((t) => t.was != null && Math.abs(t.rating - t.was) > MOVE_THRESHOLD).length;
  const arrows = await page.getByRole("table").getByText(/^(up|down) \d+ since last week$/).count();
  expect(arrows).toBeGreaterThan(0);
  expect(arrows).toBeLessThanOrEqual(big); // never an arrow for a smaller move
});

test("a program page shows its rank range, record strength, strength of schedule, best win, worst loss and why it moved", async ({ page }) => {
  test.setTimeout(180_000); // the first program page compiles in the dev server
  await page.goto("/programs/jayton");
  const header = page.locator("header");
  await expect(header.getByText(/^Range #\d+( to #\d+)?$/)).toBeVisible();
  await expect(header.getByText(/^give or take \d+$/)).toBeVisible();
  const section = page.getByRole("region", { name: "Record and schedule" });
  await expect(section).toContainText("Record strength");
  await expect(section).toContainText("Opponents’ rating");
  await expect(section).toContainText(/typical top-25 UIL team/);
  await expect(section.getByRole("listitem").filter({ hasText: "Best win" }).getByText(/\d+-\d+/)).toBeVisible();
  await expect(section.getByRole("listitem").filter({ hasText: "Worst loss" })).toBeVisible();
  const why = page.getByRole("region", { name: "Why the rating moved" });
  await expect(why.getByRole("listitem").first()).toContainText(/(vs|at) .*, \d+-\d+, projected (margin [+-]\d+\+?|even)/);
  await expect(why.getByRole("listitem").first()).toContainText(/points (better|worse) than projected/);
  expect(await page.locator("main").innerText()).not.toMatch(/undefined|NaN|null/);
});

test("the scorecard on /rankings/how: said versus happened by season, phase and organization, with a plot and a table", async ({ page }) => {
  await page.goto("/rankings/how");
  const scorecard = page.getByRole("region", { name: "Said versus happened" });
  await expect(scorecard.getByRole("img")).toBeVisible();
  const table = scorecard.getByRole("table", { name: /chance the ratings gave, against how often the favorite won/ });
  await expect(table.getByRole("columnheader")).toHaveText(["Group", "Games", "Ratings said", "Favorite won"]);
  for (const label of ["2022", "2026", "Regular season", "Playoffs", "UIL", "TAPPS"]) await expect(table.getByRole("rowheader", { name: label, exact: true })).toBeVisible();
  for (const r of await table.locator("tbody tr").all()) {
    const cells = (await r.locator("th, td").allInnerTexts()).map((t) => t.trim());
    if (cells.length < 4) continue; // a group's title
    expect(Number(cells[1].replace(/,/g, "")), cells[0]).toBeGreaterThan(30);
    const [said, won] = [Number(cells[2].replace("%", "")), Number(cells[3].replace("%", ""))];
    expect(Math.abs(said - won), cells[0]).toBeLessThan(12); // honest within a loose margin, even for the smallest group
  }
  await scorecard.getByText("Regular season and playoffs, by band").click();
  const bands = scorecard.getByRole("table", { name: /by band of the favorite.s chance, regular season and playoffs/i });
  await expect(bands.getByRole("columnheader")).toHaveText(["Chance said", "Regular season", "Playoffs"]);
  await expect(bands.getByRole("row")).toHaveCount(7); // header and six bands
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});
