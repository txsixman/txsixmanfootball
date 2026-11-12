import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { otherNames, type Lineage } from "../lib/lineage";

// Plan Phase 1 item 3: a program page lists the schools that merged into it and UIL's older spellings of its name,
// and nothing when there are none. Also the backtest section on /rankings/how. No source is named (ADR 0010).

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

const merger = (predecessor: string, successor: string, season: number): Lineage => ({ predecessor, successor, event: "consolidation", season });

test("otherNames: mergers with their year, UIL spellings, and an alias of a merged school goes to the program it became", () => {
  const lineage = [merger("O'Brien", "Knox City", 1976), merger("Mozelle", "Valera Panther Creek", 1986)];
  const aliases = { "Gail Borden County": "Borden County", Mozella: "Mozelle" };
  expect(otherNames("knox-city", lineage, aliases)).toEqual([{ name: "O'Brien", note: "merged in 1976" }]);
  expect(otherNames("borden-county", lineage, aliases)).toEqual([{ name: "Gail Borden County", note: "as listed in state final records" }]);
  expect(otherNames("valera-panther-creek", lineage, aliases).map((n) => n.name)).toEqual(["Mozelle", "Mozella"]);
  expect(otherNames("jayton", lineage, aliases)).toEqual([]);
  expect(otherNames("knox-city", [{ ...lineage[0], event: "rename" }], {})).toEqual([{ name: "O'Brien", note: "rename in 1976" }]);
});

test("a merged-in school shows on its program's page", async ({ page }) => {
  await page.goto("/programs/knox-city");
  const section = page.getByRole("region", { name: "Other names" });
  await expect(section).toContainText("O'Brien");
  await expect(section).toContainText("merged in 1976");
  await expect(section.getByRole("link")).toHaveCount(0);
  await shot(page, "program-knox-city.png");
});

test("a UIL spelling shows on its program's page", async ({ page }) => {
  await page.goto("/programs/borden-county");
  const section = page.getByRole("region", { name: "Other names" });
  await expect(section).toContainText("Gail Borden County");
  await expect(section).toContainText("as listed in state final records");
  await page.goto("/programs/valera-panther-creek");
  await expect(page.getByRole("region", { name: "Other names" })).toContainText(/Mozelle.*merged in 1986/s);
  await expect(page.getByRole("region", { name: "Other names" })).toContainText("Mozella");
});

test("a program with no other names shows no section", async ({ page }) => {
  await page.goto("/programs/jayton");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other names" })).toHaveCount(0);
});

test("/rankings/how shows how well the ratings predict, by season, without scrolling the page", async ({ page }) => {
  await page.goto("/rankings/how");
  await expect(page.getByRole("heading", { name: "How well the ratings predict" })).toBeVisible();
  const section = page.locator("section#backtest, section[aria-labelledby=backtest]");
  await expect(section).toContainText("only from the games before it");
  for (const caption of [/Share of games where the team with the higher projected margin won/, /Average number of points between the projected margin/]) {
    const table = section.getByRole("table", { name: caption });
    await expect(table.getByRole("row")).toHaveCount(8); // header, 2021 to 2026, 2022 to 2026
    await expect(table.getByRole("row").last()).toContainText("2022 to 2026");
  }
  await expect(section).toContainText("a simple win-loss rating (Elo)");
  await expect(section).toContainText("last season’s final rating");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // The existing track-record table stays.
  await expect(page.getByRole("heading", { name: "How well it picks games" })).toBeVisible();
  await shot(page, "rankings-how.png");
});
