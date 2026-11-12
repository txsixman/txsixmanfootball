import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

// "My teams" on the home page: the programs this browser follows (lib/push.ts keeps the list in localStorage under
// "followed-programs"), each with its record, last result and next game, read from per-program files built with the site.

const SHOTS = path.join(__dirname, ".results", "shots");
const follow = (page: Page, slugs: string[]) =>
  page.addInitScript((list) => localStorage.setItem("followed-programs", JSON.stringify(list)), slugs);

test("a followed program shows its record, last result and next game, with no winner or betting words", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await follow(page, ["fort-bend-chargers", "jayton"]);
  await page.goto("/", { waitUntil: "networkidle" });

  const block = page.getByRole("region", { name: "My teams" });
  await expect(block).toBeVisible();
  const cards = block.getByRole("listitem").filter({ has: page.locator("a[href^='/programs/']") });
  await expect(cards).toHaveCount(2);

  for (const [name, slug] of [["Jayton", "jayton"], ["Fort Bend Chargers", "fort-bend-chargers"]]) {
    const card = cards.filter({ has: page.locator(`a[href='/programs/${slug}']`) });
    await expect(card.getByRole("link", { name: new RegExp(name) }).first()).toHaveAttribute("href", `/programs/${slug}`);
    await expect(card).toContainText(/\d+-\d+/); // the record
    await expect(card).toContainText("Last"); // a result row, with its score
  }
  // Jayton has a playoff game still to play: its projected margin and win probability, from the program page's own row.
  await expect(cards.filter({ has: page.locator("a[href='/programs/jayton']") })).toContainText(/Next[\s\S]*Projected: .* by .* · (>99|\d+)% win probability/);

  // ADR 0004 and the betting rule: no winner named, no spread, line or odds.
  const text = (await block.innerText()).replace(/win probability/gi, "");
  expect(text).not.toMatch(/\b(won|win|wins|winner|beat|beats|defeated|victory|spread|line|lines|odds|cover|covers)\b/i);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("#my-teams a")].filter((el) => el.getBoundingClientRect().height < 44).length,
    small: [...document.querySelectorAll("#my-teams *")].filter((el) => el.childElementCount === 0 && el.textContent?.trim() && parseFloat(getComputedStyle(el).fontSize) < 13).length,
  }));
  expect(m).toEqual({ overflow: 0, short: 0, small: 0 });
  expect(errors).toEqual([]);

  mkdirSync(SHOTS, { recursive: true });
  await block.screenshot({ path: path.join(SHOTS, `my-teams-${info.project.name}.png`) });
  await page.screenshot({ path: path.join(SHOTS, `my-teams-home-${info.project.name}.png`) });
});

test("a slow or missing answer for one followed program holds back no other", async ({ page }) => {
  await page.route("**/my-teams/slow-school", () => {}); // never answered
  await page.route("**/my-teams/gone-school", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await follow(page, ["slow-school", "gone-school", "jayton"]);
  await page.goto("/");
  const block = page.getByRole("region", { name: "My teams" });
  await expect(block.getByRole("link", { name: /^Jayton/ })).toBeVisible({ timeout: 20_000 }); // the block appears after hydration, which a cold dev server can take seconds over
  await expect(block.getByRole("listitem")).toHaveCount(1);
});

test("a followed program the site does not know alone shows no block", async ({ page }) => {
  await follow(page, ["no-such-school"]);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator("#my-teams")).toHaveCount(0);
});

test("nothing followed: no My teams block", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#my-teams")).toHaveCount(0);
});
