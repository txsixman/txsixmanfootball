import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Search (ADR 0090): teams, games and seasons are found as the letters are typed, from an index that travels with the page,
// so none of this needs the Pagefind index (only the weeks of results do, and those are in scores.spec.ts). What fans
// type: a town, a mascot, initials, a misspelling, two teams, a year. The box works from the keyboard, says what to try when
// nothing matches, and its shared links do not shift the page.

const box = (page: Page) => page.getByRole("searchbox", { name: "Search programs and games" });
const result = (page: Page, name: RegExp | string) => page.getByRole("main").getByRole("link", { name });

test("a plain visit puts the cursor in the box, and a team is found as it is typed", async ({ page }) => {
  await page.goto("/search");
  await expect(box(page)).toBeFocused();
  await page.keyboard.type("Jayt");
  await expect(result(page, /^Jayton/)).toHaveAttribute("href", "/programs/jayton");
  await expect(page.getByRole("status")).toHaveText(/^1 match/);
});

for (const [typed, name, href] of [
  ["Jaybirds", /^Jayton/, "/programs/jayton"], // a mascot
  ["Lubbock", /^Lubbock Titans/, "/programs/lubbock-titans"], // a town
  ["CHANT", /^Christian Homeschool Athletes of North Texas/, "/programs/christian-homeschool-athletes-of-north-texas-chant"], // an abbreviation
  ["White Face", /^Whiteface/, "/programs/whiteface"], // a misspelling
  ["Sherman Grayson Christian ISD", /^Sherman Grayson Christian School/, "/programs/sherman-grayson-christian-school"],
  ["jayton whiteface", /^Jayton vs Whiteface/, "/matchup?a=jayton&b=whiteface"], // two teams
  ["2024 jayton", /^Jayton, 2024 season/, "/programs/jayton/2024"], // a year
] as const) {
  test(`typing ${JSON.stringify(typed)} finds ${href}`, async ({ page }) => {
    await page.goto("/search");
    await box(page).fill(typed);
    await expect(result(page, name).first()).toHaveAttribute("href", href);
  });
}

test("each result says its league and place, so schools of one name are told apart", async ({ page }) => {
  await page.goto("/search?q=lubbock");
  const items = page.getByRole("list", { name: "Teams, games and seasons" }).getByRole("listitem");
  await expect(items.first()).toBeVisible(); // the results land after the page has drawn
  const lines = await items.allInnerTexts();
  expect(lines.some((l) => /TAIAO/.test(l)) && lines.some((l) => /Lubbock\s+·.*TAPPS Division III/.test(l.replace(/\n/g, " ")))).toBe(true);
});

test("from the keyboard: Down enters the list, Up and Down walk it, Up from the top returns to the box, Enter opens the first", async ({ page }) => {
  await page.goto("/search");
  await box(page).fill("christian");
  const list = page.getByRole("list", { name: "Teams, games and seasons" });
  await expect(list.getByRole("link").first()).toBeVisible();
  await box(page).press("ArrowDown");
  await expect(list.getByRole("link").nth(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("link").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(box(page)).toBeFocused();
  await box(page).press("Escape");
  await expect(box(page)).toHaveValue("");
  await expect(page.getByRole("status")).toHaveText("Type at least two letters.");

  await box(page).fill("Jayton");
  await expect(result(page, /^Jayton/)).toBeVisible();
  await box(page).press("Enter");
  await expect(page).toHaveURL(/\/programs\/jayton$/);
});

test("the address follows the search, so the link can be shared", async ({ page }) => {
  await page.goto("/search");
  await box(page).fill("white face");
  await expect(page).toHaveURL(/\/search\?q=white%20face$/);
  await page.reload();
  await expect(box(page)).toHaveValue("white face");
  await expect(result(page, /^Whiteface/)).toBeVisible();
});

test("a list longer than the limit says so, and a search with no match says what to try", async ({ page }) => {
  await page.goto("/search");
  await box(page).fill("UIL");
  await expect(page.getByRole("status")).toHaveText(/^Showing the first 20 of \d+ programs/);
  await box(page).fill("xyzzy");
  const empty = page.getByRole("main").getByText("Nothing matches");
  await expect(empty).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Try a town (Lubbock), a mascot (Jaybirds)");
  await expect(page.getByRole("link", { name: "Browse every program" })).toHaveAttribute("href", "/programs");
  // A near miss offers the name it was close to, and the button runs that search.
  await box(page).fill("wxxtxface");
  await page.getByRole("button", { name: "Whiteface" }).click();
  await expect(box(page)).toHaveValue("Whiteface");
  await expect(result(page, /^Whiteface/)).toBeVisible();
});

test("results and the empty state pass axe, fit a phone and keep 44 px targets", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const q of ["christian", "jayton whiteface", "xyzzy"]) {
    await page.goto(`/search?q=${encodeURIComponent(q)}`);
    await expect(page.getByRole("status")).not.toHaveText("Type at least two letters.");
    await page.waitForTimeout(400); // the weeks come a moment later; the page is checked as it settles
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "best-practice"]).analyze();
    expect(axe.violations.map((v) => `${q}: ${v.id}`)).toEqual([]);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll("main a[href], main button, main input")].filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent?.trim() || el.id),
    }));
    expect(m.overflow, q).toBeLessThanOrEqual(0);
    expect(m.small, q).toEqual([]);
  }
});

// Layout shift as Chrome scores it, from before the page draws. A shared link's results arrive after the page has drawn:
// the box keeps room for them (0.51 before, Nov 16, 2026; ADR 0090 keeps it under 0.1 with the index in the page).
test("shared search links do not jump when their results land", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "the phone is where the footer sits just below the screen");
  await page.addInitScript(() => {
    (window as unknown as { shift: number }).shift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { shift: number }).shift += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  for (const q of ["jayton", "jayton whiteface", "christian", "2024 jayton", "xyzzy"]) {
    await page.goto(`/search?q=${encodeURIComponent(q)}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("status")).not.toHaveText("Type at least two letters.");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { shift: number }).shift), q).toBeLessThan(0.1);
  }
});

test("a week of results is found with a sentence, not words run together (production build, which has the Pagefind index)", async ({ page }) => {
  test.skip(!process.env.CI, "the search index exists only after a production build");
  await page.goto("/search");
  // What the search box does for the weeks: Pagefind's excerpts for a team's name.
  const excerpts = await page.evaluate(async () => {
    const index = "/pagefind/pagefind.js"; // in a variable, so neither the compiler nor the bundler looks for the file
    const pagefind = await import(/* webpackIgnore: true */ index);
    const { results } = await pagefind.search("jayton");
    const data = await Promise.all(results.slice(0, 40).map((r: { data: () => Promise<{ url: string; excerpt: string }> }) => r.data()));
    return data.filter((d) => !d.url.startsWith("/programs/")).map((d) => d.excerpt);
  });
  expect(excerpts.length).toBeGreaterThan(0);
  for (const e of excerpts) {
    // A letter touching a highlighted word is a name joined to the one beside it ("OakwoodJayton") or a crest's initials before it ("OJayton").
    expect(e).not.toMatch(/[A-Za-z]<mark>|<\/mark>[A-Za-z]/);
    // The game, said once in words: "Oakwood vs Jayton, 8 to 54." (read without the highlight's <mark> tags).
    expect(e.replace(/<\/?mark>/g, "")).toMatch(/[A-Za-z.'&-]+(?: [A-Za-z.'&-]+)* vs (?:[A-Za-z.'&-]+ )*[A-Za-z.'&-]+, (?:\d+ to \d+|forfeit|no score)\./);
  }
});
