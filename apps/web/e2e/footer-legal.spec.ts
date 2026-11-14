import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The site footer links the privacy and terms pages from every page, and the two pages answer 200 whether fan accounts are
// off (FAN_SIGNIN unset: the default) or on (CI's launch checks run this file both ways). With accounts off they say
// nothing about accounts, a birth year or posting; with them on they say all of it.
const ON = process.env.FAN_SIGNIN === "on";
const BETTING = /\b(spread|spreads|odds|betting|wager|parlay)\b/i;

const axe = (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  return (include ? builder.include(include) : builder).analyze();
};

test.setTimeout(120_000); // the first visit to a page compiles it under `next dev`

test.describe("footer legal links", () => {
  for (const path of ["/", "/rankings", "/programs/jayton"]) {
    test(`${path}: Privacy and Terms are in the footer, at least 44 by 44, and pass axe`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const footer = page.getByRole("contentinfo");
      const nav = footer.getByRole("navigation", { name: "About this site" });
      for (const [name, href] of [["Privacy", "/privacy"], ["Terms", "/terms"]]) {
        const link = nav.getByRole("link", { name, exact: true });
        await expect(link).toHaveAttribute("href", href);
        const box = await link.boundingBox();
        expect(box?.width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(box?.height, `${name} height`).toBeGreaterThanOrEqual(44);
      }
      // The footer fits the viewport: nothing in it reaches past the right edge.
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
      expect((await axe(page, "footer")).violations.map((v) => v.id)).toEqual([]);
    });
  }

  for (const [name, path] of [["Privacy", "/privacy"], ["Terms", "/terms"]]) {
    test(`${name} from the footer opens a page that reads right with fan accounts ${ON ? "on" : "off"}, and passes axe`, async ({ page }) => {
      await page.goto("/rankings");
      await page.getByRole("contentinfo").getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(BETTING);
      // The two things every visitor has, with or without accounts.
      if (name === "Privacy") expect(text).toMatch(/page views/i);
      else expect(text).toMatch(/chances to win are estimates/i);
      if (ON) expect(text).toMatch(/13 or older/);
      else expect(text).not.toMatch(/birth year|display name|your account|13 or older|sign-in|posting|\bposts?\b/i);
      await page.evaluate(() => document.fonts.ready);
      expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    });
  }

  test("the pages answer 200 either way", async ({ request }) => {
    for (const path of ["/privacy", "/terms"]) expect((await request.get(path)).status(), path).toBe(200);
  });
});
