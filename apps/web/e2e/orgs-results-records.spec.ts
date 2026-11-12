import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ORG_TABS } from "./independent";

// Results and Records, one organization at a time (ADR 0012).

const SEED = path.join(__dirname, "../../../data/seed");
const SHOTS = path.join(__dirname, ".results", "shots");

/** The schools an alignment file lists (school is the fifth column). */
const schools = (dir: string, league: string) =>
  new Set(
    readFileSync(path.join(SEED, dir, "alignments.csv"), "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.split(","))
      .filter((c) => c[0] === league)
      .map((c) => c[4]),
  );
const TAPPS = schools("tapps-2026-28", "TAPPS");
const UIL = schools("uil-2026-28", "UIL");
const TCAF = schools("private-2026", "TCAF");

// Same checks as the other specs' checkPage: status, no console errors, axe, 44px targets, no horizontal overflow.
async function checkPage(page: Page, url: string, stem: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response?.status(), url).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${stem}-full.png`), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button, main input")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44 && !el.matches("input");
    }).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0 });
  expect(errors).toEqual([]);
}

/** The text lines of each list item: team names are the non-numeric ones. */
const lines = (items: string[]) => items.map((t) => t.split("\n").map((l) => l.trim()).filter(Boolean));

test("Results has an organization tab row, UIL first, and every organization's page passes", async ({ page }, info) => {
  await checkPage(page, "/results", `results-uil-${info.project.name}`);
  const orgs = page.getByRole("navigation", { name: "Organization" });
  await expect(orgs.getByRole("link")).toHaveText(ORG_TABS);
  await expect(orgs.locator("[aria-current=page]")).toHaveText("UIL");
  await expect(page.getByText(/^UIL · 2026 season · Week \d+ · \d+ games$/)).toBeVisible();
  for (const org of ["tapps", "taiao", "tcaf"]) {
    await checkPage(page, `/results/${org}`, `results-${org}-${info.project.name}`);
    await expect(orgs.locator("[aria-current=page]")).toHaveText(org.toUpperCase());
    await expect(page.getByText(new RegExp(`^${org.toUpperCase()} · 2026 season · Week \\d+ · \\d+ games$`))).toBeVisible();
  }
  await checkPage(page, "/results/2025/9/tapps", `results-tapps-2025-9-${info.project.name}`);
  await checkPage(page, "/results/2024/taiao", `results-taiao-2024-${info.project.name}`);
  // UIL is the page without an organization; it has no address of its own, and no page mixes organizations.
  expect((await page.goto("/results/uil"))?.status()).toBe(404);
  expect((await page.goto("/results/all"))?.status()).toBe(404);
});

test("a TAPPS results week lists only games with a TAPPS team", async ({ page }) => {
  await page.goto("/results/2025/9/tapps");
  const games = lines(await page.locator("main section li").allInnerTexts());
  expect(games.length).toBeGreaterThan(3);
  for (const g of games) expect(g.some((l) => TAPPS.has(l)), g.join(" | ")).toBe(true);
  // The same week under UIL lists only games with a UIL team.
  await page.goto("/results/2025/9");
  const uil = lines(await page.locator("main section li").allInnerTexts());
  expect(uil.length).toBeGreaterThan(10);
  for (const g of uil) expect(g.some((l) => UIL.has(l)), g.join(" | ")).toBe(true);
  await expect(page.getByText(/won|beat|defeated/i)).toHaveCount(0);
});

test("switching week, season or organization keeps the rest", async ({ page }) => {
  await page.goto("/results/2025/9/tapps");
  await page.getByRole("navigation", { name: "Week" }).getByRole("link", { name: "Week 8", exact: false }).click();
  await expect(page).toHaveURL(/\/results\/2025\/8\/tapps$/, { timeout: 20_000 });
  await page.getByRole("navigation", { name: "Organization" }).getByRole("link", { name: "TAIAO" }).click();
  await expect(page).toHaveURL(/\/results\/2025\/8\/taiao$/, { timeout: 20_000 });
  await page.getByRole("navigation", { name: "Season" }).getByRole("link", { name: "2024" }).click();
  await expect(page).toHaveURL(/\/results\/2024\/taiao$/, { timeout: 20_000 });
  await page.getByRole("navigation", { name: "Organization" }).getByRole("link", { name: "UIL" }).click();
  await expect(page).toHaveURL(/\/results\/2024\/\d+$/, { timeout: 20_000 }); // a season's page opens on its last week; the week stays
  // The latest season is the organization's bare address.
  await page.getByRole("navigation", { name: "Season" }).getByRole("link", { name: "2026" }).click();
  await expect(page).toHaveURL(/\/results$/, { timeout: 20_000 });
  await page.getByRole("navigation", { name: "Organization" }).getByRole("link", { name: "TAPPS" }).click();
  await expect(page).toHaveURL(/\/results\/2026\/\d+\/tapps$/, { timeout: 20_000 });
  await page.getByRole("navigation", { name: "Season" }).getByRole("link", { name: "2025" }).click();
  await expect(page).toHaveURL(/\/results\/2025\/tapps$/, { timeout: 20_000 });
});

test("a week with none of an organization's games is an empty page, not a 404", async ({ page }) => {
  // Find one from the files: a week (Monday to Sunday, week 1 holding the season's first game) of 2025 with no TCAF game.
  const rows = readFileSync(path.join(SEED, "maxpreps-2025/games.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const monday = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return Math.floor((d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000) / (7 * 86_400_000));
  };
  const first = Math.min(...rows.map((r) => monday(r[2])));
  const weeks = new Set(rows.map((r) => monday(r[2]) - first + 1));
  const withTcaf = new Set(rows.filter((r) => TCAF.has(r[3]) || TCAF.has(r[4])).map((r) => monday(r[2]) - first + 1));
  const empty = [...weeks].find((w) => !withTcaf.has(w));
  expect(empty, "2025 has a week with no TCAF game").toBeDefined();
  const res = await page.goto(`/results/2025/${empty}/tcaf`);
  expect(res?.status()).toBe(200);
  await expect(page.getByText("No TCAF games this week.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Week" }).getByRole("link")).not.toHaveCount(0);
  await expect(page.getByText(/^TCAF · 2025 season · Week \d+ · 0 games$/)).toBeVisible();
});

test("Records has an organization tab row and every organization's page passes", async ({ page }, info) => {
  await checkPage(page, "/records", `records-uil-${info.project.name}`);
  const orgs = page.getByRole("navigation", { name: "Organization" });
  await expect(orgs.getByRole("link")).toHaveText(ORG_TABS);
  await expect(orgs.locator("[aria-current=page]")).toHaveText("UIL");
  for (const org of ["tapps", "taiao", "tcaf"]) {
    await checkPage(page, `/records/${org}`, `records-${org}-${info.project.name}`);
    await expect(orgs.locator("[aria-current=page]")).toHaveText(org.toUpperCase());
    await expect(page.getByRole("region", { name: "Most points in a game" })).toBeVisible();
  }
  expect((await page.goto("/records/uil"))?.status()).toBe(404);
});

test("team records name only teams in the organization", async ({ page }) => {
  // The text of each list item without the crests' initials (aria-hidden badges), which are not team names.
  const texts = (board: string) =>
    page.getByRole("region", { name: board }).getByRole("listitem").evaluateAll((els) =>
      els.map((el) => {
        const crests = [...el.querySelectorAll<HTMLElement>("[aria-hidden='true']")];
        crests.forEach((n) => n.style.setProperty("display", "none"));
        const text = (el as HTMLElement).innerText; // layout-aware, so the lines keep their breaks
        crests.forEach((n) => n.style.removeProperty("display"));
        return text;
      }),
    );
  const teams = async (board: string) => lines(await texts(board)).map((l) => l.filter((x) => !/^\d/.test(x))[0]);
  await page.goto("/records/tapps");
  for (const board of ["Most points in a game", "Longest winning runs", "Unbeaten seasons"]) {
    const names = await teams(board);
    expect(names.length, board).toBeGreaterThan(0);
    for (const n of names) expect(TAPPS.has(n), `${board}: ${n}`).toBe(true);
  }
  // A game's record may name the opponent, but at least one side is a TAPPS team.
  const combined = lines(await texts("Most points by both teams"));
  for (const g of combined) expect(g.some((l) => TAPPS.has(l)), g.join(" | ")).toBe(true);
  await page.goto("/records");
  for (const board of ["Most points in a game", "Longest winning runs", "Unbeaten seasons"]) {
    for (const n of await teams(board)) expect(UIL.has(n), `UIL ${board}: ${n}`).toBe(true);
  }
});

test("new routes preview their own card", async ({ page, request }) => {
  test.setTimeout(180_000); // the dev server draws each card on first request
  for (const [url, card] of [
    ["/results/tapps", "/results/card/tapps/opengraph-image"],
    ["/results/2025/9/taiao", "/results/card/taiao/opengraph-image"],
    ["/results/2025/9", "/results/opengraph-image"],
    ["/records/tapps", "/records/tapps/opengraph-image"],
    ["/records/tcaf", "/records/tcaf/opengraph-image"],
  ]) {
    await page.goto(url);
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image, url).toContain(card);
    expect(await page.locator('meta[property="og:image"]').count(), url).toBe(1);
    const res = await request.get(new URL(image!).pathname + new URL(image!).search);
    expect(res.status(), url).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
});
