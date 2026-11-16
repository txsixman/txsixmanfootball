import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { noLiveScores } from "./live-route";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// The whole axe rule set (WCAG 2.0 and 2.1 A and AA, plus best practices) on one page of each kind, at phone width, in light
// and in dark (ADR 0081). Serious and critical findings fail; the lesser ones are listed in the failure message only when one
// of those fails too. The contrast-only sweep over more pages is theme.spec.ts, and the page tests run axe on their own pages.
test.use({ viewport: { width: 375, height: 812 } });

const PAGES = [
  "/",
  "/welcome",
  "/scores",
  "/scores/sample",
  "/scores/g1",
  "/scores/tonight",
  "/scores/2026-11-06-earth-springlake-at-whitharral",
  "/playoffs",
  "/playoffs/this-round",
  "/playoffs/season/2025",
  "/playoffs/bracket/uil-division-i",
  "/playoffs/bracket/tapps-division-i",
  "/weeks",
  "/weeks/2026/2",
  "/results",
  "/results/2026/1",
  "/rankings",
  "/rankings/week/4",
  "/rankings/sample",
  "/standings",
  "/standings/district/uil-division-i-district-1",
  "/programs",
  "/programs/jayton",
  "/programs/ira/2025",
  "/series/jayton/knox-city",
  "/championships",
  "/championships/2025",
  "/seasons/2025",
  "/records",
  "/search?q=jayton",
  "/sign-in",
  "/no-such-page",
];

for (const url of PAGES) {
  test(`axe finds nothing serious or critical, in light and dark: ${url}`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "checked once, at 375px");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const response = await page.goto(url, { waitUntil: "networkidle" });
      expect(response?.status(), url).toBe(url === "/no-such-page" ? 404 : 200);
      await page.evaluate(() => document.fonts.ready);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
      const found = axe.violations.flatMap((v) => v.nodes.map((n) => `${v.impact} ${v.id}: ${n.target.join(" ")}`));
      const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.length ? found : [], `${url} (${scheme})`).toEqual([]);
    }
  });
}
