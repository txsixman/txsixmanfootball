import { expect, test } from "@playwright/test";
import path from "node:path";
import type { Alignment } from "../lib/alignments";
import { loadFinals, titleCounts } from "../lib/champions";
import type { SeasonResult } from "../lib/games";
import { parseCsv, PlayoffRow, GAME_COLUMNS } from "../lib/data-schemas";
import { projectionParts, projectionText } from "../lib/projection";
import { signed } from "../lib/signed";
import { slugify } from "../lib/slug";

// Data and lib fixes from the pages audit: sources stay out of the browser (ADR 0010), one season constant, the same
// round names on every page, titles counted by program, district records without playoff games, honest rounding.

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

test("a CSV row with a comma inside a team name is refused, not shifted a column", () => {
  const header = GAME_COLUMNS.join(",");
  const row = "I,season,2026-09-04,Jayton, TX,Cedar Gap,true,40,12,regulation,,https://example.com/a,";
  expect(() => parseCsv("games.csv", `${header}\n${row}`, GAME_COLUMNS, PlayoffRow)).toThrow(/fields, expected/);
});

test("signed() never prints a signed zero", () => {
  expect([0.04, -0.04, 0, -0.0001].map(signed)).toEqual(["0.0", "0.0", "0.0", "0.0"]);
  expect([1.26, -2, 0.05, -0.05].map(signed)).toEqual(["+1.3", "−2.0", "+0.1", "−0.1"]);
});

test("a projected margin that rounds to nothing says so instead of claiming a one-point win", () => {
  expect(projectionText({ favorite: "Jayton", margin: 0.4, winProbability: 0.51 })).toBe("Jayton by less than 1 · 51% win probability");
  expect(projectionText({ favorite: "Jayton", margin: 12, winProbability: 0.74 })).toBe("Jayton by 12 · 74% win probability");
  expect(projectionParts({ favorite: "Jayton", margin: 12, winProbability: 0.74 })).toEqual({ margin: "Jayton by 12", chance: "74% win probability" });
});

test("most state titles count a merged school under the program it became", () => {
  const final = (season: number, champion: string) => ({
    season, conference: "1A", division: "", champion, runnerUp: "Other", championScore: 1, runnerUpScore: 0, scoreNote: "", notes: "",
  });
  const finals = [final(1980, "Old Town"), final(1981, "New Town"), final(1982, "Old Town"), final(1983, "Solo High")];
  const counts = titleCounts(finals, new Map([[slugify("Old Town"), "New Town"]]));
  expect(counts).toEqual([
    { school: "New Town", titles: 3, last: 1982 },
    { school: "Solo High", titles: 1, last: 1983 },
  ]);
});

test("on the real finals every title is counted once and under a program that exists today", async () => {
  const [finals, successors] = await inWeb(async () => {
    const { loadLineage, successorOf } = await import("../lib/lineage");
    return [await loadFinals(), successorOf(await loadLineage())] as const;
  });
  expect(finals.length).toBeGreaterThan(50);
  const counts = titleCounts(finals, successors);
  expect(counts.reduce((n, c) => n + c.titles, 0)).toBe(finals.length);
  expect(counts.filter((c) => successors.has(slugify(c.school)))).toEqual([]);
});

test("district records leave out playoff games; overall records and points keep them; a forfeit scores no points", async () => {
  const { standingsFrom } = await import("../lib/standings");
  const { gameKey } = await import("../lib/games");
  const school = (name: string, district: string): Alignment => ({
    league: "UIL", division: "I", region: "1", district, school: name, sourceUrl: "x", span: "2026-28", slug: slugify(name),
  });
  const alignments = [school("Cedar Gap", "1"), school("Dry Wash", "1"), school("Elk Flat", "1"), school("Far Mesa", "2")];
  const game = (date: string, home: string, away: string, homeScore: number, awayScore: number, forfeit = false) =>
    ({ id: `${date}-${away}-at-${home}`, href: `/scores/${date}-${away}-at-${home}`, date, status: date, home, away, homeScore, awayScore, forfeit }) satisfies SeasonResult;
  const results = [
    game("2026-10-02", "Cedar Gap", "Dry Wash", 40, 12), // district game
    game("2026-10-09", "Elk Flat", "Dry Wash", 1, 0, true), // district forfeit: counts, no points
    game("2026-10-16", "Cedar Gap", "Far Mesa", 30, 6), // different districts: never a district game
    game("2026-11-06", "Dry Wash", "Cedar Gap", 50, 8), // playoff rematch of two district teams
  ];
  const playoffs = new Set([gameKey("2026-11-06", "Cedar Gap", "Dry Wash")]);
  const [d1] = standingsFrom(alignments, results, playoffs);
  const row = (name: string) => d1.rows.find((r) => r.school.school === name)!;
  expect(row("Cedar Gap").district).toEqual({ won: 1, lost: 0, tied: 0 });
  expect(row("Cedar Gap").overall).toEqual({ won: 2, lost: 1, tied: 0 });
  expect(row("Dry Wash").district).toEqual({ won: 0, lost: 2, tied: 0 });
  expect(row("Dry Wash").overall).toEqual({ won: 1, lost: 2, tied: 0 });
  expect(row("Dry Wash").pointsFor).toBe(12 + 50); // the forfeit's recorded 0 adds nothing
  expect(row("Elk Flat").pointsFor).toBe(0);
  // The same results with no playoff keys count the rematch as a district game, so the exclusion is what the test sees.
  expect(standingsFrom(alignments, results, new Set())[0].rows.find((r) => r.school.school === "Cedar Gap")!.district).toEqual({ won: 1, lost: 1, tied: 0 });
});

test("no source URL reaches the browser on Programs (ADR 0010)", async ({ request }) => {
  const html = await (await request.get("/programs")).text();
  expect(html).toContain("Find a school");
  for (const field of ["mascotSource", "colorsSource", "retrievedOn", "sourceUrl", "source_url"]) expect(html, field).not.toContain(field);
  expect(html).not.toMatch(/"page":"https?:/);
});

test("Scores names rounds the way Playoffs does", async ({ page }) => {
  await page.goto("/scores");
  const text = (await page.locator("main").textContent()) ?? ""; // not innerText: the labels are uppercased by CSS
  expect(text).not.toMatch(/Round-1/);
  expect(text).toMatch(/UIL DI{1,2} · (Bi-district|Area|Regional|Semifinal|State final|Quarterfinal)/);
});

test("Standings says what its district and overall records count", async ({ page }) => {
  await page.goto("/standings");
  await expect(page.getByText(/District records count regular-season games only; overall records include playoff games/)).toBeVisible();
});

test("the rankings explainer shows what the ratings expected next to what happened", async ({ page }) => {
  await page.goto("/rankings/how");
  const table = page.getByRole("table", { name: /favorite won, by its win probability/ });
  await expect(table.getByRole("columnheader")).toHaveText(["Win probability", "Games", "Ratings said", "Favorite won"]);
  const first = (await table.getByRole("row").nth(1).getByRole("cell").allInnerTexts()).map((t) => t.trim());
  expect(first.every((t) => /^\d+%$|^[\d,]+$/.test(t))).toBe(true);
});

test("reigning champions on Home never print a missing score", async ({ page }) => {
  await page.goto("/");
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/null|undefined|NaN/);
  expect(text).toMatch(/\d+-\d+ over /);
});

test("the season label on Scores and a program page comes from one constant", async ({ page }) => {
  test.setTimeout(180_000); // the first program page compiles in the dev server
  const { CURRENT_SEASON } = await import("../lib/season");
  await page.goto("/scores");
  await expect(page.getByText(`${CURRENT_SEASON} playoffs`).first()).toBeVisible();
  await page.goto("/programs/jayton");
  await expect(page.getByRole("heading", { name: `${CURRENT_SEASON} games` })).toBeVisible();
});
