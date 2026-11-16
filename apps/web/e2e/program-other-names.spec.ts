import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { countingRows, otherNames, successorOf, type Lineage } from "../lib/lineage";

// Plan Phase 1 item 3 (ADR 0072): a program page lists the schools it was formed from, what it became, and its other
// names (UIL's and names.csv's spellings), and nothing when there are none. Also the backtest section on /rankings/how. No source is named (ADR 0010).

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

const merger = (predecessor: string, successor: string, season: number, event: Lineage["event"] = "consolidation"): Lineage => ({ predecessor, successor, event, season });

const final = (season: number, champion: string, runnerUp: string) => ({ season, champion, runnerUp });

test("otherNames: mergers and renames with their year and finals, UIL spellings with the years of their school's finals, and an alias of a merged school goes to the program it became", () => {
  const lineage = [merger("O'Brien", "Knox City", 1976), merger("Mozelle", "Valera Panther Creek", 1986, "rename")];
  const aliases = { "Gail Borden County": "Borden County", Mozella: "Mozelle" };
  const finals = [final(1972, "O'Brien", "Jarrell"), final(1983, "Roscoe Highland", "Mozelle"), final(1997, "Borden County", "Valera Panther Creek"), final(2008, "Borden County", "Woodson")];
  expect(otherNames("knox-city", lineage, aliases)).toEqual([{ name: "O'Brien", note: "merged into this program in 1976", group: "formed" }]);
  expect(otherNames("knox-city", lineage, aliases, { finals })).toEqual([{ name: "O'Brien", note: "merged into this program in 1976, State Championships 1972", group: "formed" }]);
  expect(otherNames("borden-county", lineage, aliases, { finals })).toEqual([{ name: "Gail Borden County", note: "in State Championship records between 1997 and 2008", group: "name" }]);
  expect(otherNames("borden-county", lineage, aliases)).toEqual([{ name: "Gail Borden County", note: "in State Championships", group: "name" }]);
  expect(otherNames("valera-panther-creek", lineage, aliases, { finals }).map((n) => `${n.group} ${n.name}: ${n.note}`)).toEqual([
    "formed Mozelle: renamed in 1986, State Championships 1983",
    "name Mozella: in State Championships 1983",
  ]);
  expect(otherNames("jayton", lineage, aliases)).toEqual([]);
});

test("otherNames: an annexation and a split say what joined, and a split's or annexation's finals stay under its own name", () => {
  const lineage = [merger("Old Glory", "Aspermont", 1985, "annexation"), merger("Hobbs", "Roby", 1990, "split"), merger("Hobbs", "Rotan", 1990, "split"), merger("McCauley", "Roby", 1990)];
  expect(otherNames("aspermont", lineage, {}).map((n) => n.note)).toEqual(["its district joined this program's in 1985"]);
  expect(otherNames("roby", lineage, {}).map((n) => `${n.name}: ${n.note}`)).toEqual(["Hobbs: part of its district joined this program's in 1990", "McCauley: merged into this program in 1990"]);
  // Two consolidation rows from one school are a split too.
  expect(otherNames("b", [merger("A", "B", 1990), merger("A", "C", 1990)], {})[0].note).toBe("part of its district joined this program's in 1990");
  expect(countingRows(lineage).map((l) => l.predecessor)).toEqual(["McCauley"]);
  expect(countingRows([merger("A", "B", 1990), merger("A", "C", 1990), merger("D", "B", 1991, "rename")]).map((l) => l.predecessor)).toEqual(["D"]);
  expect([...successorOf(lineage)]).toEqual([["mccauley", "Roby"]]);
});

test("otherNames: names.csv spellings and former names, and a name links only when its program has a page", () => {
  const names = [
    { name: "Welman", program: "Wellman-Union", kind: "spelling" as const },
    { name: "Old Academy", program: "Wellman-Union", kind: "former" as const, until: 2019 },
    { name: "Older Academy", program: "Wellman-Union", kind: "former" as const },
  ];
  const lineage = [merger("Wellman", "Wellman-Union", 1997)];
  expect(otherNames("wellman-union", lineage, {}, { names, programs: new Set(["wellman-union"]) })).toEqual([
    { name: "Wellman", note: "merged into this program in 1997", group: "formed" },
    { name: "Welman", note: "an older spelling", group: "name" },
    { name: "Old Academy", note: "former name, through 2019", group: "name" },
    { name: "Older Academy", note: "former name", group: "name" },
  ]);
  expect(otherNames("wellman-union", lineage, {}, { programs: new Set(["wellman"]) })[0]).toEqual({ name: "Wellman", note: "merged into this program in 1997", group: "formed", slug: "wellman" });
  expect(otherNames("wellman", lineage, {}, { programs: new Set(["wellman-union"]) })).toEqual([{ name: "Wellman-Union", note: "this school merged into it in 1997", group: "became", slug: "wellman-union" }]);
  expect(otherNames("wellman", lineage, {})).toEqual([{ name: "Wellman-Union", note: "this school merged into it in 1997", group: "became" }]);
});

test("a merged-in school shows on its program's page under Formed from, with its merger year and the seasons it played a State Championship", async ({ page }) => {
  await page.goto("/programs/knox-city");
  const section = page.getByRole("region", { name: "Other names" });
  await expect(section.getByRole("heading", { name: "Formed from" })).toBeVisible();
  await expect(section).toContainText("O'Brien");
  await expect(section).toContainText("merged into this program in 1976, State Championships 1972");
  await expect(section.getByRole("link")).toHaveCount(0);
  await shot(page, "program-knox-city.png");
  await page.goto("/programs/wellman-union");
  const wellman = page.getByRole("region", { name: "Other names" });
  await expect(wellman).toContainText(/Wellman.*merged into this program in 1997, State Championships 1987/s);
  await expect(wellman).toContainText(/Union.*merged into this program in 1997/s);
  await expect(wellman.getByRole("heading", { name: "Also known as" })).toBeVisible();
  await expect(wellman).toContainText(/Welman.*an older spelling/s);
});

test("a district split among programs and a merger both show on the program, each with its year", async ({ page }) => {
  await page.goto("/programs/roby");
  const section = page.getByRole("region", { name: "Other names" });
  await expect(section).toContainText(/McCauley.*merged into this program in 1990/s);
  await expect(section).toContainText(/Hobbs.*part of its district joined this program's in 1990/s);
  await expect(section).not.toContainText("tea.texas.gov");
  await expect(section).not.toContainText("TEA");
});

test("a rename and a UIL spelling show on the program's page with the years of the school's finals", async ({ page }) => {
  await page.goto("/programs/borden-county");
  const section = page.getByRole("region", { name: "Other names" });
  await expect(section).toContainText(/Gail Borden County.*in State Championship records between 1997 and 20\d\d/s);
  await page.goto("/programs/valera-panther-creek");
  const valera = page.getByRole("region", { name: "Other names" });
  await expect(valera).toContainText(/Mozelle.*renamed in 1986, State Championships 1983/s);
  await expect(valera).toContainText(/Talpa Centennial.*merged into this program in 1986/s);
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
    await expect(table.getByRole("row")).toHaveCount(11); // header, 2018 to 2026, 2022 to 2026
    await expect(table.getByRole("row").last()).toContainText("2022 to 2026");
  }
  await expect(section).toContainText("a simple win-loss rating (Elo)");
  await expect(section).toContainText("last season’s final rating");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // The existing track-record table stays.
  await expect(page.getByRole("heading", { name: "How well it projects games" })).toBeVisible();
  await shot(page, "rankings-how.png");
});
