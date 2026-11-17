import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { firstLink, open, problems, type Problems } from "./phone-guard";

// The phone check of every page added in rounds 11 to 13 (ADR 0106), at 320 px, the narrowest phone still sold: nothing
// scrolls the page sideways and every link, button and control is 44 by 44 px (the guard phone.spec.ts runs at 375 and 390),
// plus what that check found: long school names wrap rather than clip, the heading levels never skip, a chart's labels stay
// inside its drawing, the short organization tab ("UIL") is a whole touch target, and the saved-copy bar holds its sentence.
// Light and dark share every rule that is not a color; contrast in both is axe-sweep.spec.ts and theme.spec.ts.

noLiveScores(test);
test.setTimeout(120_000);
test.use({ viewport: { width: 320, height: 700 } });
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "320px only");
  await page.route("**/api/me", (route) => route.fulfill({ json: { enabled: true, me: null } }));
});

async function sweep(page: Page, urls: string[]) {
  const found: Record<string, Problems> = {};
  for (const url of urls) {
    await open(page, url);
    const p = await problems(page);
    if (p.overflow > 0 || p.wide.length || p.small.length) found[url] = p;
  }
  expect(found).toEqual({});
}

/** Text a page cuts short with an ellipsis or a clamp (sideways only: a clamp's hidden second line is by design). */
const clipped = (page: Page, within: string) =>
  page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll(`${sel} *`)) {
      const cs = getComputedStyle(el);
      if (el.closest("nav[aria-label=Breadcrumb]")) continue; // the current page's crumb ends in an ellipsis by design
      const cuts = cs.textOverflow === "ellipsis" || /-webkit-box/.test(cs.display) || /hidden|clip/.test(cs.overflowX);
      if (cuts && el.clientWidth > 4 && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim() && el.children.length < 3)
        out.push(`${(el.textContent ?? "").trim().slice(0, 40)}: ${el.scrollWidth} in ${el.clientWidth}`);
    }
    return out;
  }, within);

const headingLevels = (page: Page) => page.evaluate(() => [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1])));

/** Every level is at most one deeper than the one before it, and the first is an h1. */
function ordered(levels: number[]) {
  expect(levels[0]).toBe(1);
  levels.forEach((l, i) => i && expect(l, `h${l} after h${levels[i - 1]}`).toBeLessThanOrEqual(levels[i - 1] + 1));
}

test("week recaps and the weeks index: no sideways scroll, every target 44px, team names whole", async ({ page }) => {
  await sweep(page, ["/weeks", "/weeks/2026/2", "/weeks/2026/2/tapps"]);
  await open(page, "/weeks/2026/2");
  expect(await clipped(page, "main")).toEqual([]);
  ordered(await headingLevels(page));
});

test("brackets and their round tabs: no sideways scroll, every target 44px, every tab and team name whole", async ({ page }) => {
  const bracket = await firstLink(page, "/playoffs", /^\/playoffs\/bracket\/(?!sample)[a-z0-9-]+$/);
  await sweep(page, ["/playoffs", "/playoffs/this-round", "/playoffs/tapps", bracket, "/playoffs/bracket/sample"]);
  await open(page, "/playoffs");
  ordered(await headingLevels(page));
  await open(page, "/playoffs/tapps");
  ordered(await headingLevels(page));
  expect(await clipped(page, "main")).toEqual([]);
  await open(page, bracket);
  expect(await clipped(page, "main")).toEqual([]);
  const tabs = page.getByRole("tab");
  const n = await tabs.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click(); // each round's cards
    expect((await problems(page)).overflow, `after opening tab ${i}`).toBeLessThanOrEqual(0);
    expect(await clipped(page, "[role=tabpanel]:not([hidden])"), `tab ${i}`).toEqual([]);
  }
});

test("a bracket's round tab shows a keyboard ring on every side", async ({ page }) => {
  await open(page, await firstLink(page, "/playoffs", /^\/playoffs\/bracket\/(?!sample)[a-z0-9-]+$/));
  await page.keyboard.press("Tab"); // keyboard use, so :focus-visible applies to a script's focus
  const tab = page.getByRole("tab").first();
  await tab.focus();
  const ring = await tab.evaluate((el) => {
    const cs = getComputedStyle(el);
    const bar = el.closest("[role=tablist]")!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    // The ring reaches `outlineOffset` plus its width beyond the tab (nothing when drawn inside); a scrolling bar clips whatever is outside it.
    const reach = Math.max(0, parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth));
    return { style: cs.outlineStyle, reach, room: Math.min(box.top - bar.top, bar.bottom - box.bottom) };
  });
  expect(ring.style).toBe("solid");
  expect(ring.reach).toBeLessThanOrEqual(ring.room + 0.5);
});

test("rankings and the program page's charts: nothing sideways, every target 44px, every chart label inside its drawing", async ({ page }) => {
  await sweep(page, ["/rankings", "/rankings/tapps", "/programs/jayton", "/programs/whiteface"]);
  for (const url of ["/programs/jayton", "/programs/whiteface"]) {
    await open(page, url);
    const charts = await page.evaluate(() =>
      [...document.querySelectorAll("main svg[role=img]")].map((svg) => {
        const width = (svg as SVGSVGElement).viewBox.baseVal.width;
        const k = svg.getBoundingClientRect().width / width;
        const text = [...svg.querySelectorAll("text")].map((t) => {
          const b = (t as SVGTextElement).getBBox();
          return { s: t.textContent ?? "", cut: b.x < -0.5 || b.x + b.width > width + 0.5, px: parseFloat(getComputedStyle(t).fontSize) * k };
        });
        return { cut: text.filter((t) => t.cut).map((t) => t.s), smallest: Math.min(...text.map((t) => t.px)) };
      }),
    );
    expect(charts.length, url).toBeGreaterThan(0);
    for (const c of charts) {
      expect(c.cut, `${url}: labels cut off by the drawing's edge`).toEqual([]);
      expect(c.smallest, `${url}: smallest chart text, in px at 320`).toBeGreaterThanOrEqual(12);
    }
  }
});

test("organization tabs: the short ones (UIL) are whole 44px targets on every page that has them", async ({ page }) => {
  await sweep(page, ["/rankings", "/results", "/weeks", "/leaders", "/records", "/standings"]);
  await open(page, "/weeks");
  const sizes = await page.getByRole("navigation", { name: "Organization" }).getByRole("link").evaluateAll((as) => as.map((a) => [a.textContent, a.getBoundingClientRect().width]));
  for (const [name, width] of sizes) expect(width as number, String(name)).toBeGreaterThanOrEqual(44);
});

test("series pages, season in review, scoring leaders: nothing sideways, every target 44px, names whole", async ({ page }) => {
  const urls = ["/series/jayton/knox-city", "/seasons", "/seasons/2026", "/seasons/2025", "/leaders", "/leaders/2025", "/leaders/2025/division-1", "/leaders/tapps"];
  await sweep(page, urls);
  for (const url of ["/seasons/2026", "/seasons/2025"]) {
    await open(page, url);
    expect(await clipped(page, "main"), url).toEqual([]);
    ordered(await headingLevels(page));
  }
  await open(page, "/leaders/2025");
  ordered(await headingLevels(page));
});

test("a program's season page: the series link is a whole 44px target", async ({ page }) => {
  await sweep(page, ["/programs/jayton/2025", "/programs/jayton/2024"]);
});

test("results for a paper, Copy results, game and calendar pages: nothing sideways, every target 44px", async ({ page }) => {
  await sweep(page, ["/results", "/results/2026/2", "/results/2026/2/tapps"]);
  await open(page, "/results/2026/2");
  const copy = page.getByRole("button", { name: /copy results/i });
  await expect(copy).toBeVisible();
  const box = (await copy.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // The print block is not on screen, in either theme.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), scheme).toBeLessThanOrEqual(0);
  }
  // "Add to calendar" on a program, a bracket and a game still to play.
  const game = await firstLink(page, "/playoffs", /^\/scores\/\d{4}-[a-z]/);
  await sweep(page, ["/programs/jayton", game]);
});

test("scores, tonight, the offline page and the 404 page: nothing sideways, every target 44px", async ({ page }) => {
  await sweep(page, ["/scores", "/scores/tonight", "/~offline"]);
  const missing = await page.goto("/no-such-page-with-a-very-long-address-the-christian-school-at-castle-hills-san-antonio");
  expect(missing?.status()).toBe(404);
  const p = await problems(page);
  expect(p.overflow).toBeLessThanOrEqual(0);
  expect(p.wide).toEqual([]);
  expect(p.small).toEqual([]);
  // Midweek, "Later" and "Next games" lead on screen (ADR 0103); either way the jump links are whole targets and nothing shifts.
  await open(page, "/scores");
  expect((await problems(page)).small).toEqual([]);
});

test("the saved-copy bar holds its whole sentence beside \"Checking...\" at 320 px", async ({ page, context }) => {
  test.skip(!process.env.CI, "the service worker runs only in a production build");
  await page.goto("/scores/tonight");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now through the worker, which keeps a copy
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => page.evaluate(async () => Boolean(await (await caches.open("saved-pages")).match("/scores/tonight")))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  const notice = page.locator('[data-saved-notice="saved"]');
  await expect(notice).toBeVisible();
  await notice.getByRole("button").evaluate((b) => void (b.textContent = "Checking...")); // the longest label, as it is while the signal is tried
  const fit = await notice.evaluate((bar) => ({ bar: bar.getBoundingClientRect().height, text: bar.querySelector("span")!.getBoundingClientRect().height }));
  expect(fit.text).toBeLessThanOrEqual(fit.bar);
  await context.setOffline(false);
});
