import { expect, type Page } from "@playwright/test";

// What a phone user would trip on, measured on the page as it is now: shared by phone.spec.ts (375 and 390 px) and
// phone-320.spec.ts (the narrowest phone, rounds 11 to 13's pages). Exempt: a link inside a sentence (WCAG 2.5.8's inline
// exception), the skip link until it has focus, and a text box inside a label that is itself the 44px target.

export type Problems = { overflow: number; wide: string[]; small: string[] };

/** What a phone user would trip on, on the page as it is now. */
export async function problems(page: Page): Promise<Problems> {
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

export async function open(page: Page, url: string) {
  expect((await page.goto(url, { waitUntil: "networkidle" }))?.status(), url).toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

/** A link on `from` whose address matches `pattern`, so the test follows the data rather than naming a game. */
export async function firstLink(page: Page, from: string, pattern: RegExp, within = "main"): Promise<string> {
  await open(page, from);
  const hrefs = await page.locator(`${within} a[href]`).evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
  const href = hrefs.find((h) => pattern.test(h));
  expect(href, `a link matching ${pattern} on ${from}`).toBeTruthy();
  return href!;
}
