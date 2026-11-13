import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";

// The pages fans open on game night, on a phone at the field: at 375 and 390 px wide, nothing scrolls sideways, and
// every link, button and control anywhere on the page (header and footer too) is at least 44 by 44 px. The other
// specs' checkPage looks at height only, inside <main>, and at 375 px; this is the wider guard (Nov 13, 2026 sweep).
// Exempt: a link inside a sentence (WCAG 2.5.8's inline exception), the skip link until it has focus (it is 44px
// then: audit-a11y.spec.ts), and a text box inside a label that is itself the 44px target.

noLiveScores(test);
test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "phone widths only"));

type Problems = { overflow: number; wide: string[]; small: string[] };

/** What a phone user would trip on, on the page as it is now. */
async function problems(page: Page): Promise<Problems> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const name = (el: Element) => `<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
    const scrolls = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true;
      return false;
    };
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1 && !scrolls(el);
      })
      .map((el) => `${name(el)} reaches ${Math.round(el.getBoundingClientRect().right)}px`);
    const inSentence = (el: Element) =>
      el.tagName === "A" && getComputedStyle(el).display === "inline" && (el.parentElement?.textContent ?? "").trim() !== (el.textContent ?? "").trim();
    const skipLink = (el: Element) => el.matches("a[href='#main']") && document.activeElement !== el;
    const box = (el: Element) => {
      const label = el.matches("input, select, textarea") ? el.closest("label") : null;
      return (label ?? el).getBoundingClientRect();
    };
    const small = [...document.querySelectorAll("a[href], button, select, summary, [role=button], input:not([type=hidden])")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !inSentence(el) && !skipLink(el);
      })
      .filter((el) => {
        const r = box(el);
        return r.width < 44 || r.height < 44;
      })
      .map((el) => `${name(el)} ${Math.round(box(el).width)}x${Math.round(box(el).height)}`);
    return { overflow: document.documentElement.scrollWidth - vw, wide: wide.slice(0, 10), small: [...new Set(small)].slice(0, 20) };
  });
}

async function open(page: Page, url: string) {
  expect((await page.goto(url, { waitUntil: "networkidle" }))?.status(), url).toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

/** A link on `from` whose address matches `pattern`, so the test follows the data rather than naming a game. */
async function firstLink(page: Page, from: string, pattern: RegExp, within = "main"): Promise<string> {
  await open(page, from);
  const hrefs = await page.locator(`${within} a[href]`).evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => pattern.test(h));
  expect(href, `a link matching ${pattern} on ${from}`).toBeTruthy();
  return href!;
}

for (const width of [375, 390]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 812 } });

    test("game-night pages: no sideways scroll, every target 44px", async ({ page }) => {
      const pages = ["/", "/scores", "/playoffs", "/rankings", "/programs/jayton"];
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
  });
}

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
