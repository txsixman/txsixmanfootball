import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { layoutTree } from "../lib/bracket-layout";
import { bracketHref, loadBrackets } from "../lib/brackets";
import { noLiveScores } from "./live-route";

// The bracket drawn (ADR 0049): the whole tree on a wide screen, one round at a time on a phone, a team's path lit on a
// tap, a game's page on a tap, and the images to download. The data changes every week, so what to expect comes from the
// same data the pages are built from.
noLiveScores(test);

/** The loaders read ../../data from the working directory; the tests run from the repo root (as e2e/upcoming.ts does). */
async function brackets() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return (await loadBrackets()).map((b) => ({ b, whole: b.tree.length > 1 && layoutTree(b.tree).placed.length === b.tree.length }));
  } finally {
    process.chdir(was);
  }
}

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
const tree = (page: Page) => page.locator("[data-tree-scroll]");
const rounds = (page: Page) => page.locator("[data-rounds]");

/** Nothing in a box is cut short: every piece of text inside its box, none wider or taller than its own space. */
async function nothingCut(page: Page) {
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-box]")].filter((b) => b.offsetParent).flatMap((box) => {
      const r = box.getBoundingClientRect();
      return [...box.querySelectorAll<HTMLElement>("p, span, button")].filter((el) => {
        const e = el.getBoundingClientRect();
        const out = e.left < r.left - 1 || e.right > r.right + 1 || e.top < r.top - 1 || e.bottom > r.bottom + 1;
        return out || el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      }).map((el) => `${box.dataset.box}: ${el.textContent}`);
    }),
  );
  expect(cut).toEqual([]);
}

async function noProblems(page: Page) {
  await nothingCut(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.height < 44 || r.width < 44);
    }).map((el) => el.outerHTML.slice(0, 80)),
  }));
  expect(m).toEqual({ overflow: 0, short: [] });
  expect(await page.locator("[data-tree-print]").innerText()).not.toMatch(BETTING);
}

test("every bracket of the season: a tree when its games connect to one final, rounds otherwise, every box drawn", async ({ page }, info) => {
  test.setTimeout(150_000); // every bracket page of the season, one after another
  for (const { b, whole } of await brackets()) {
    await page.goto(bracketHref(b.name));
    const shown = info.project.name === "desktop" && whole ? tree(page) : rounds(page);
    await expect(shown, b.name).toBeVisible();
    await expect(shown.locator("[data-box]"), b.name).toHaveCount(b.tree.length);
    await nothingCut(page);
    if (!whole) await expect(tree(page), `${b.name} has no tree`).toHaveCount(0);
  }
});

test.describe("desktop", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "wide screens open on the tree"));

  test("UIL Division I: the final in the middle, its semifinals either side, regions labeled beside the boxes, nothing wider than the page", async ({ page }) => {
    const { b } = (await brackets()).find((x) => x.b.name === "UIL Division I")!;
    await page.goto(bracketHref(b.name));
    const box = async (id: string) => (await tree(page).locator(`[data-box="${id}"]`).boundingBox())!;
    const [left, final, right] = [await box("G29"), await box("G31"), await box("G30")];
    expect(left.x).toBeLessThan(final.x);
    expect(right.x).toBeGreaterThan(final.x);
    expect(Math.abs(left.y - final.y)).toBeLessThan(1);
    // Each region's label wholly inside the drawing, in a gutter of its own beside the outer boxes, under none of them.
    const drawing = (await tree(page).locator(":scope > div").boundingBox())!;
    const [outerLeft, outerRight] = [await box("G1"), await box("G9")];
    for (const r of ["Region 1", "Region 2", "Region 3", "Region 4"]) {
      const label = (await tree(page).getByText(r, { exact: true }).boundingBox())!;
      expect(label.x, r).toBeGreaterThanOrEqual(drawing.x);
      expect(label.x + label.width, r).toBeLessThanOrEqual(drawing.x + drawing.width);
      if (r === "Region 1" || r === "Region 2") expect(label.x + label.width, r).toBeLessThanOrEqual(outerLeft.x);
      else expect(label.x, r).toBeGreaterThanOrEqual(outerRight.x + outerRight.width);
    }
    await expect(tree(page).locator("svg path")).toHaveCount(30);
    await noProblems(page);
  });

  test("tapping a team lights its games and the road ahead; tapping again clears it", async ({ page }) => {
    const { b } = (await brackets()).find((x) => x.whole)!;
    await page.goto(bracketHref(b.name));
    const team = tree(page).locator("[data-box] button[aria-pressed]").first();
    const name = (await team.getAttribute("title"))!;
    await team.click();
    await expect(team).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(`${name}’s path is lit.`)).toBeVisible();
    // Its own boxes stay full strength; some others dim; the final is on its road unless it is already out.
    const dimmed = await tree(page).locator("[data-box].opacity-40").count();
    expect(dimmed).toBeGreaterThan(0);
    await expect(tree(page).locator("[data-box]", { has: page.locator(`button[title="${name}"]`) }).first()).not.toHaveClass(/opacity-40/);
    await team.click();
    await expect(tree(page).locator("[data-box].opacity-40")).toHaveCount(0);
  });

  test("a listed game's box opens its game page", async ({ page }) => {
    const { b } = (await brackets()).find((x) => x.whole && x.b.tree.some((n) => n.game))!;
    await page.goto(bracketHref(b.name));
    const link = tree(page).locator("[data-box] > a[href^='/scores/']").first();
    const href = (await link.getAttribute("href"))!;
    await link.click({ position: { x: 20, y: 6 } }); // the code line, above the team buttons
    await expect(page).toHaveURL(href, { timeout: 30_000 }); // a dev server builds the game page on first request
  });

  test("fit to screen shrinks a tree wider than the window to the frame", async ({ page }) => {
    const { b } = (await brackets()).find((x) => x.b.name === "UIL Division I")!;
    await page.goto(bracketHref(b.name));
    const frame = tree(page);
    expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Fit to screen" }).click();
    expect(await frame.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Full size" })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("phone", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "phones open one round at a time"));

  test("one round at a time: the round bar stays on top and jumps to a round; the whole bracket fits the screen", async ({ page }) => {
    const { b } = (await brackets()).find((x) => x.b.name === "UIL Division I")!;
    await page.goto(bracketHref(b.name));
    await expect(tree(page)).toBeHidden();
    const bar = rounds(page).getByRole("navigation");
    await expect(bar.locator("[aria-current=true]")).toHaveText(/Bi-district/i);
    await bar.getByRole("button", { name: /^Area$/i }).click();
    await expect(bar.locator("[aria-current=true]")).toHaveText(/Area/i);
    await expect.poll(async () => (await rounds(page).getByRole("group", { name: "Area" }).boundingBox())!.x).toBeLessThan(40);
    // The bar is held at the top while the round scrolls under it.
    const top = (await bar.boundingBox())!.y;
    await page.evaluate((y) => window.scrollTo(0, y), top + 800);
    await expect.poll(async () => (await bar.boundingBox())!.y).toBeLessThan(2);
    await noProblems(page);

    await page.getByRole("button", { name: "Whole bracket" }).click();
    await expect(tree(page)).toBeVisible();
    await expect(rounds(page)).toBeHidden();
    expect(await tree(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });
});

test("the images to download: a share-size and a full-size picture of each bracket", async ({ request }, info) => {
  test.skip(info.project.name !== "desktop", "the same files for every screen: checked once");
  test.setTimeout(180_000); // a dev server draws each image on first request
  for (const { b, whole } of await brackets()) {
    for (const size of ["share", ...(whole ? ["full"] : [])]) {
      const res = await request.get(`${bracketHref(b.name)}/image/${size}.png`);
      expect(res.status(), `${b.name} ${size}`).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/png");
      const png = await res.body();
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      if (size === "share") expect([w, h]).toEqual([1200, 630]);
      else expect(w).toBeGreaterThan(600);
    }
  }
});

test("the sample bracket: invented schools, every kind of box, no problems on either screen", async ({ page }) => {
  await page.goto("/playoffs/bracket/sample");
  const shown = page.locator("[data-tree-print]");
  for (const state of ["final", "disputed", "upcoming", "open", "bye"]) await expect(shown.locator(`[data-state=${state}]`).first()).toBeAttached();
  await expect(shown.getByText("Forfeit").first()).toBeAttached();
  await expect(shown.getByText("Final · Disputed").first()).toBeAttached();
  await noProblems(page);
});
