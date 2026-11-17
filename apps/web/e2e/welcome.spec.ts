import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";

// The landing page (/welcome, ADR 0086) and the home page's first-visit link to it. Fan accounts are answered by a stub of
// /api/me, so the page is checked with them off (the build) and on (the line that appears after load).

noLiveScores(test);

const me = (page: Page, enabled: boolean) =>
  page.route("**/api/me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ enabled, me: null }) }));

const BANNED = /\b(spreads?|odds|lines?|bets?|betting|picks?|underdogs?|favou?rites?|locks?|winner|maxpreps|hudl|calpreps)\b/i;

test("the landing page says what the site is and sends a visitor on, at phone width with nothing sideways", async ({ page }) => {
  await me(page, false);
  await page.goto("/welcome", { waitUntil: "networkidle" });
  const main = page.locator("main");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Every team\. Every game\./i);
  await expect(main.getByRole("link", { name: "Find your team" }).first()).toHaveAttribute("href", "/search");
  await expect(main.getByRole("link", { name: "Tonight’s scores" })).toHaveAttribute("href", "/scores/tonight");
  // The live line is the round being played, tonight's games, or the season's count, from the data.
  await expect(main.locator("section").first()).toContainText(/playoffs this round: [\d,]+ games?|Tonight, .*: [\d,]+ games?|season: [\d,]+ games? on record/);

  // What's here: each card a link to its section.
  const here = page.getByRole("region", { name: "What’s here" });
  for (const href of ["/scores", "/rankings", "/playoffs", "/programs", "/championships", "#alerts"]) await expect(here.locator(`a[href='${href}']`)).toHaveCount(1);
  await expect(here).not.toContainText("fan account", { ignoreCase: true }); // accounts off: not promised

  // The numbers: four, each a count from the data.
  const numbers = page.getByRole("region", { name: "By the numbers" });
  await expect(numbers.locator("dd")).toHaveCount(4);
  for (const n of await numbers.locator("dd").allInnerTexts()) expect(n).toMatch(/^\d[\d,]*$/);

  // Alerts: the steps, and the iPhone's Home Screen first.
  const alerts = page.getByRole("region", { name: "Get alerts for your team" });
  await expect(alerts.getByRole("listitem")).toHaveCount(3);
  await expect(alerts).toContainText("Add to Home Screen");

  // The State Championship is never "the final"; no betting word, no source.
  const text = await main.innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(/\bstate finals?\b|\bthe finals?\b/i);

  // Metadata: canonical, title, description, share card and JSON-LD.
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", /\/welcome$/);
  await expect(page).toHaveTitle(/start here/i);
  await expect(page.locator("meta[name=description]")).toHaveAttribute("content", /^Every Texas six-man football team and game/);
  await expect(page.locator("meta[property='og:image']").first()).toHaveAttribute("content", /\/welcome\/opengraph-image/);
  const ld = (await page.locator("script[type='application/ld+json']").allTextContents()).map((t) => JSON.parse(t));
  expect(ld.find((d) => d["@type"] === "AboutPage")?.url).toMatch(/\/welcome$/);

  // The share card draws.
  const card = await page.request.get((await page.locator("meta[property='og:image']").first().getAttribute("content"))!.replace(/^https?:\/\/[^/]+/, ""));
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toContain("image/png");

  // At a phone's width nothing scrolls sideways, and every link and button in main is at least 44 px tall.
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: [...document.querySelectorAll("main a[href], main button")].filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent?.trim()),
  }));
  expect(m.overflow).toBeLessThanOrEqual(0);
  expect(m.small).toEqual([]);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("Find your team opens a search with the cursor already in the box", async ({ page }) => {
  await me(page, false);
  await page.goto("/welcome", { waitUntil: "networkidle" });
  await page.getByRole("main").getByRole("link", { name: "Find your team" }).first().click();
  await expect(page).toHaveURL(/\/search$/);
  const box = page.getByRole("searchbox", { name: "Search programs and games" });
  await expect(box).toBeFocused();
  await page.keyboard.type("white face");
  await expect(page.getByRole("main").getByRole("link", { name: /^Whiteface/ })).toHaveAttribute("href", "/programs/whiteface");
});

test("with fan accounts on, the follow card says what an account adds", async ({ page }) => {
  await me(page, true);
  await page.goto("/welcome", { waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "What’s here" })).toContainText("A free fan account adds game comments");
});

test("the footer links to the landing page", async ({ page }) => {
  await page.goto("/programs");
  await expect(page.getByRole("contentinfo").getByRole("navigation", { name: "About this site" }).getByRole("link", { name: "New here?" })).toHaveAttribute("href", "/welcome");
});

test.describe("the home page's New here link", () => {
  const link = (page: Page) => page.locator("main").getByRole("link", { name: "New here? Start here" });

  test("a first visit sees it; the next visit does not", async ({ page }) => {
    await page.goto("/");
    await expect(link(page)).toBeVisible();
    await expect(link(page)).toHaveAttribute("href", "/welcome");
    await page.reload();
    await expect(link(page)).toBeHidden();
  });

  test("dismissed, it is gone and stays gone", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Hide the New here link" }).click();
    await expect(link(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("welcome-seen"))).toBe("1");
  });

  test("a browser that follows a team never sees it", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("followed-programs", JSON.stringify(["jayton"])));
    await page.goto("/");
    await expect(link(page)).toBeHidden();
  });

  test("a returning visit: hidden before it paints, so nothing on the home page moves", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("welcome-seen", "1"));
    await page.goto("/", { waitUntil: "networkidle" });
    // Hidden before it paints: no layout shift at all on a returning visit.
    const shift = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) total += e.value;
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 500);
        }),
    );
    expect(shift).toBeLessThan(0.01);
    await expect(link(page)).toBeHidden();
  });
});
