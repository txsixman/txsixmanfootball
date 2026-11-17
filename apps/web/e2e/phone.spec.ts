import { expect, test } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { firstLink, open, problems, type Problems } from "./phone-guard";

// The pages fans open on game night, on a phone at the field: at 375 and 390 px wide, nothing scrolls sideways, and
// every link, button and control anywhere on the page (header and footer too) is at least 44 by 44 px. The other
// specs' checkPage looks at height only, inside <main>, and at 375 px; this is the wider guard (Nov 13, 2026 sweep).
// Exempt: a link inside a sentence (WCAG 2.5.8's inline exception), the skip link until it has focus (it is 44px
// then: audit-a11y.spec.ts), and a text box inside a label that is itself the 44px target.

noLiveScores(test);
test.setTimeout(120_000); // nine pages a test
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone widths only");
  // The header as the live site draws it: fan accounts on, nobody signed in, so "Sign in" ends the section strip. Without
  // this the test server (no FAN_SIGNIN) draws no account link, and a "Sign in" squeezed to 16px wide on every phone page
  // went unseen here (Nov 16, 2026).
  await page.route("**/api/me", (route) => route.fulfill({ json: { enabled: true, me: null } }));
});

for (const width of [375, 390]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 812 } });

    test("game-night pages: no sideways scroll, every target 44px", async ({ page }) => {
      const pages = ["/", "/scores", "/scores/tonight", "/playoffs", "/rankings", "/programs/jayton"];
      // A played game, a playoff game page and a bracket, as the site links them today.
      pages.push(await firstLink(page, "/programs/jayton", /^\/scores\/\d{4}-\d{2}-\d{2}-/));
      pages.push(await firstLink(page, "/scores", /^\/scores\/\d{4}-[a-z]/));
      pages.push(await firstLink(page, "/playoffs", /^\/playoffs\/bracket\//));
      const found: Record<string, Problems> = {};
      for (const url of pages) {
        await open(page, url);
        const p = await problems(page);
        if (p.overflow > 0 || p.wide.length || p.small.length) found[url] = p;
      }
      expect(found).toEqual({});
    });

    test("playoff-week and history pages: no sideways scroll, every target 44px", async ({ page }) => {
      // Added Nov 16, 2026: the round's games, State Championships (the list and one bracket's page), standings, records.
      const pages = ["/playoffs/this-round", "/championships", "/standings", "/records"];
      pages.push(await firstLink(page, "/playoffs", /^\/championships\/\d{4}\/[a-z]/));
      const found: Record<string, Problems> = {};
      for (const url of pages) {
        await open(page, url);
        const p = await problems(page);
        if (p.overflow > 0 || p.wide.length || p.small.length) found[url] = p;
      }
      expect(found).toEqual({});
    });
  });
}

test("the header's Sign in shows whole on a phone: the section strip scrolls rather than squeezing it", async ({ page }) => {
  await open(page, "/");
  const signIn = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign in" });
  await expect(signIn).toBeAttached();
  const box = await signIn.evaluate((el) => {
    const label = el.querySelector("span")!;
    return { width: el.getBoundingClientRect().width, cut: label.scrollWidth > label.clientWidth };
  });
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.cut).toBe(false);
});

test("a shared search link does not jump when its results land", async ({ page }) => {
  test.skip(!process.env.CI, "the search index exists only after a production build");
  // Layout shift as Chrome scores it, from before the page draws; 0.51 before the results box kept room (Nov 16, 2026).
  await page.addInitScript(() => {
    (window as unknown as { shift: number }).shift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { shift: number }).shift += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await open(page, "/search?q=jayton");
  await expect(page.getByRole("status")).toHaveText(/\d+ match(es)?\b/);
  await expect(page.locator('main a[href="/programs/jayton"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(0.1);
});

test("the guard catches what it is for: a short name link, a narrow button and a page wider than the phone", async ({ page }) => {
  await open(page, "/");
  await page.evaluate(() => {
    const main = document.querySelector("main")!;
    main.insertAdjacentHTML("afterbegin", '<div><a href="/programs/ira" style="display:inline-flex;min-height:44px">Ira</a><button style="height:30px">Go</button><div style="width:600px">wide</div></div>');
  });
  const p = await problems(page);
  expect(p.overflow).toBeGreaterThan(0);
  expect(p.wide.some((w) => w.includes('"wide"'))).toBe(true);
  expect(p.small.some((s) => s.startsWith('<a> "Ira"'))).toBe(true);
  expect(p.small.some((s) => s.startsWith('<button> "Go"'))).toBe(true);
});
