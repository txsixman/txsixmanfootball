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

const final = (season: number, champion: string, runnerUp: string) => ({ season, champion, runnerUp });

test("otherNames: mergers with their year and finals, UIL spellings with the years of their school's finals, and an alias of a merged school goes to the program it became", () => {
  const lineage = [merger("O'Brien", "Knox City", 1976), merger("Mozelle", "Valera Panther Creek", 1986)];
  const aliases = { "Gail Borden County": "Borden County", Mozella: "Mozelle" };
  const finals = [final(1972, "O'Brien", "Jarrell"), final(1983, "Roscoe Highland", "Mozelle"), final(1997, "Borden County", "Valera Panther Creek"), final(2008, "Borden County", "Woodson")];
  expect(otherNames("knox-city", lineage, aliases)).toEqual([{ name: "O'Brien", note: "merged into this program in 1976" }]);
  expect(otherNames("knox-city", lineage, aliases, { finals })).toEqual([{ name: "O'Brien", note: "merged into this program in 1976, State Championships 1972" }]);
  expect(otherNames("borden-county", lineage, aliases, { finals })).toEqual([{ name: "Gail Borden County", note: "in State Championship records between 1997 and 2008" }]);
  expect(otherNames("borden-county", lineage, aliases)).toEqual([{ name: "Gail Borden County", note: "in State Championships" }]);
  expect(otherNames("valera-panther-creek", lineage, aliases, { finals }).map((n) => `${n.name}: ${n.note}`)).toEqual([
    "Mozelle: merged into this program in 1986, State Championships 1983",
    "Mozella: in State Championships 1983",
  ]);
  expect(otherNames("jayton", lineage, aliases)).toEqual([]);
  expect(otherNames("knox-city", [{ ...lineage[0], event: "rename" }], {})).toEqual([{ name: "O'Brien", note: "rename in 1976" }]);
});

test("otherNames: a name links only when its program has a page, and a program that merged away names its successor", () => {
  const lineage = [merger("Wellman", "Wellman-Union", 1997)];
  expect(otherNames("wellman-union", lineage, {}, { programs: new Set(["wellman-union"]) })).toEqual([{ name: "Wellman", note: "merged into this program in 1997" }]);
  expect(otherNames("wellman-union", lineage, {}, { programs: new Set(["wellman"]) })).toEqual([{ name: "Wellman", note: "merged into this program in 1997", slug: "wellman" }]);
  expect(otherNames("wellman", lineage, {}, { programs: new Set(["wellman-union"]) })).toEqual([{ name: "Wellman-Union", note: "this school merged into it in 1997", slug: "wellman-union" }]);
  expect(otherNames("wellman", lineage, {})).toEqual([{ name: "Wellman-Union", note: "this school merged into it in 1997" }]);
});

test("a merged-in school shows on its program's page, with its merger year and the seasons it played a State Championship", async ({ page }) => {
  await page.goto("/programs/knox-city");
  const section = page.getByRole("region", { name: "Other names" });
  await expect(section).toContainText("O'Brien");
  await expect(section).toContainText("merged into this program in 1976, State Championships 1972");
  await expect(section.getByRole("link")).toHaveCount(0);
  await shot(page, "program-knox-city.png");
  await page.goto("/programs/wellman-union");
  await expect(page.getByRole("region", { name: "Other names" })).toContainText(/Wellman.*merged into this program in 1997, State Championships 1987/s);
});

test("a UIL spelling shows on its program's page with the years of the school's finals", async ({ page }) => {
  await page.goto("/programs/borden-county");
  const section = page.getByRole("region", { name: "Other names" });
  await expect(section).toContainText(/Gail Borden County.*in State Championship records between 1997 and 20\d\d/s);
  await page.goto("/programs/valera-panther-creek");
  const valera = page.getByRole("region", { name: "Other names" });
  await expect(valera).toContainText(/Mozelle.*merged into this program in 1986, State Championships 1983/s);
  await expect(valera).toContainText(/Mozella.*in State Championships 1983/s);
  await expect(valera).not.toContainText("http");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
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
  await expect(page.getByRole("heading", { name: "How well it projects games" })).toBeVisible();
  await shot(page, "rankings-how.png");
});
