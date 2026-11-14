import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { EMBED_HEIGHT } from "../lib/embed-html";
import { skipReason, upcoming } from "./upcoming";

// The embeddable scoreboard (ADR 0023): /embed/programs/<slug> is the only page any site may frame, it ships no cookie and no
// script bundle, and every other address still refuses to be framed. Scores keep the program page's wording.
test.use({ serviceWorkers: "block" });
test.setTimeout(180_000); // the dev server compiles each route the first time it is asked

const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?)\b/i;
const SOURCE = /maxpreps|hudl|calpreps|sixmanfootball|dave campbell/i;
const WINNER = /\b(won|beat|defeated|winner)\b/i;
const embed = (slug: string) => `/embed/programs/${slug}`;

test("the embed has no X-Frame-Options, allows any frame ancestor, is noindex and sets its own CSP", async ({ request }) => {
  const res = await request.get(embed("jayton"));
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["x-frame-options"]).toBeUndefined();
  expect(h["content-security-policy"]).toContain("frame-ancestors *");
  expect(h["content-security-policy"]).toContain("default-src 'none'");
  expect(h["content-security-policy"]).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'; /);
  expect(h["content-security-policy"]).not.toContain("frame-ancestors 'none'");
  expect(h["x-robots-tag"]).toContain("noindex");
  expect(h["content-type"]).toContain("text/html");
  expect(await res.text()).toContain('<meta name="robots" content="noindex">');
});

test("on the public address the embed stays noindex while a program page is open to search engines", async ({ request }) => {
  const host = { host: "txsixmanfootball.com" };
  expect((await request.get(embed("jayton"), { headers: host })).headers()["x-robots-tag"]).toContain("noindex");
  expect((await request.get("/programs/jayton", { headers: host })).headers()["x-robots-tag"]).toBeUndefined();
});

for (const url of ["/", "/programs/jayton", "/scores", "/rankings", "/embed", "/embedded"]) {
  test(`${url} still refuses to be framed`, async ({ request }) => {
    const h = (await request.get(url, { failOnStatusCode: false })).headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff"); // the shared headers reach every route
  });
}

test("a logo file keeps its own, stricter Content-Security-Policy", async ({ request }) => {
  const h = (await request.get("/logos/small/jayton.webp")).headers();
  expect(h["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  expect(h["x-frame-options"]).toBe("DENY");
});

test("a page on another origin can frame the embed, and cannot frame any other page", async ({ page, baseURL }) => {
  // The host page is any page of this server; its frames use the other name of the same machine, which is another origin.
  const other = baseURL!.replace("localhost", "127.0.0.1");
  await page.goto("/robots.txt");
  await page.evaluate(
    ([a, b]) => {
      for (const [id, src] of [["e", a], ["p", b]]) {
        const f = document.createElement("iframe");
        f.id = id;
        f.src = src;
        f.width = "375";
        f.height = "480";
        document.body.append(f);
      }
    },
    [`${other}${embed("jayton")}`, `${other}/programs/jayton`],
  );
  const framed = page.frameLocator("#e");
  await expect(framed.getByRole("heading", { level: 1, name: "Jayton" })).toBeVisible({ timeout: 60_000 });
  await expect(framed.getByRole("link", { name: "Full schedule on TX Six-Man Football" })).toBeVisible();
  // The program page in the second frame is refused: the browser shows its own error page, never the site's.
  await expect.poll(() => page.frames().some((f) => f.url().startsWith("chrome-error:")), { timeout: 60_000 }).toBe(true);
  await expect(page.frameLocator("#p").getByRole("heading", { level: 1, name: "Jayton" })).toHaveCount(0);
  expect(new URL(page.frames().find((f) => f.url().includes("/embed/"))!.url()).origin).not.toBe(new URL(page.url()).origin);
});

async function open(page: Page, url: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto(url, { waitUntil: "networkidle" });
  expect(res?.status()).toBe(200);
  return errors;
}

const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = "rgb(255, 255, 255)";
const DARK = "rgb(13, 21, 35)";

test("?theme=dark and ?theme=light and ?theme=auto set the theme; anything else is ignored", async ({ page }) => {
  const errors = await open(page, `${embed("jayton")}?theme=dark`);
  expect(await theme(page)).toBe("dark");
  expect(await background(page)).toBe(DARK);
  await page.goto(`${embed("jayton")}?theme=light`);
  expect(await theme(page)).toBe("light");
  expect(await background(page)).toBe(LIGHT);
  await page.goto(`${embed("jayton")}?theme=auto`);
  expect(await theme(page)).toBe("auto");
  for (const bad of ["x", "%3Cscript%3Ealert(1)%3C%2Fscript%3E", "DARK", "dark%22%20onload%3D%22x", ""]) {
    await page.goto(`${embed("jayton")}?theme=${bad}`);
    expect(await theme(page), bad).toBeNull();
    expect(await background(page), bad).toBe(LIGHT);
  }
  expect(errors, "the CSP lets the one script run and blocks nothing else").toEqual([]);
});

test("with no ?theme the page follows the device; light and dark can be forced either way", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(embed("jayton"));
  expect(await background(page)).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(embed("jayton"));
  expect(await background(page)).toBe(DARK);
  await page.goto(`${embed("jayton")}?theme=light`);
  expect(await background(page)).toBe(LIGHT);
  await page.goto(`${embed("jayton")}?theme=auto`);
  expect(await background(page)).toBe(DARK);
});

test("record, three results and the next game, with no winner, betting or source words", async ({ page }) => {
  // A program with a game still to play, picked from the season's data (e2e/upcoming.ts); none in the offseason.
  const next = (await upcoming()).programs[0];
  if (!next) return test.skip(true, skipReason());
  await open(page, embed(next.slug));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(next.school);
  await expect(page.getByText(/^\d+-\d+(-\d+)?$/).first()).toBeVisible(); // the record, same figure as the program page
  await expect(page.locator(".rec")).toContainText("2026 record");
  await expect(page.getByRole("region", { name: "Latest results" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Next game" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("not confirmed", { exact: false })).toHaveCount(0); // a final is confirmed (ADR 0040)
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(WINNER);
  expect(text).not.toMatch(BETTING);
  expect(text).not.toMatch(SOURCE);
  // The page's own address is the one thing in it that holds "sixmanfootball".
  expect((await page.content()).replaceAll("txsixmanfootball.com", "")).not.toMatch(SOURCE);
  // The record is the program page's own.
  const record = (await page.locator(".rec b").innerText()).trim();
  await page.goto(`/programs/${next.slug}`);
  await expect(page.getByText(record, { exact: true }).first()).toBeVisible();
});

test("a forfeit shows the word, never 1-0 or 2-0", async ({ page }) => {
  await open(page, embed("avalon")); // forfeits in its games
  await expect(page.getByText("Forfeit", { exact: true }).first()).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b[12]-0\b/);
  expect(text).not.toMatch(WINNER);
});

test("a logo that is too big or too wide for the page draws a badge", async ({ page }) => {
  await open(page, embed("st-pauls-prep")); // its logo is a 46 KB SVG
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator(".badge")).toBeVisible();
  await open(page, embed("founders-christian-school-spring")); // a 3.5:1 wordmark: wider than the 288x96 copy fits
  await expect(page.locator("img")).toHaveCount(0);
  await open(page, embed("christ-the-king-diocesan-high-school-lubbock")); // a 16 KB SVG fits
  await expect(page.locator("img")).toHaveCount(1);
});

test("an unknown program is a 404", async ({ request }) => {
  expect((await request.get(embed("no-such-school"), { failOnStatusCode: false })).status()).toBe(404);
});

test("no cookie, no script file, only the one inline script", async ({ page, context }) => {
  const res = await page.goto(embed("jayton"), { waitUntil: "networkidle" });
  expect(res!.headers()["set-cookie"]).toBeUndefined();
  expect(await context.cookies()).toEqual([]);
  const scripts = await page.evaluate(() => [...document.querySelectorAll("script")].map((s) => ({ src: s.getAttribute("src"), text: s.textContent ?? "" })));
  expect(scripts).toHaveLength(1);
  expect(scripts[0].src).toBeNull();
  expect(scripts[0].text).toContain("data-theme");
  expect(await page.evaluate(() => document.querySelectorAll("link, iframe, form, a:not([href^='https://txsixmanfootball.com/'])").length)).toBe(0);
  const link = page.getByRole("link", { name: "Full schedule on TX Six-Man Football" });
  await expect(link).toHaveAttribute("href", "https://txsixmanfootball.com/programs/jayton");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener");
});

for (const slug of ["jayton", "avalon", "christ-the-king-diocesan-high-school-lubbock", "founders-christian-school-spring", "st-pauls-prep"]) {
  test(`${slug} at 375px: no sideways scroll, fits the iframe height, passes axe, under 30 KB`, async ({ page, request, baseURL }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const loaded: Promise<number>[] = [];
    page.on("response", (r) => r.url().startsWith(baseURL!) && loaded.push(r.body().then((b) => b.length).catch(() => 0)));
    await open(page, embed(slug));
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth - document.documentElement.clientWidth, tall: document.body.offsetHeight }));
    expect(m.wide).toBeLessThanOrEqual(0);
    expect(m.tall).toBeLessThanOrEqual(EMBED_HEIGHT);
    for (const scheme of ["light", "dark"] as const) {
      await page.goto(`${embed(slug)}?theme=${scheme}`);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => v.id), `${slug} ${scheme}`).toEqual([]);
    }
    // The page and its crest, in bytes, as sent.
    const html = (await (await request.get(embed(slug))).body()).length;
    await page.goto(embed(slug));
    const img = await page.locator("img").first().getAttribute("src", { timeout: 1000 }).catch(() => null); // a badge has no image
    const crest = img ? (await (await request.get(img)).body()).length : 0;
    expect(html + crest, `${slug}: ${html} HTML + ${crest} crest`).toBeLessThan(30_000);
    expect((await Promise.all(loaded)).length).toBeGreaterThan(0);
  });
}

test("every program's embed fits the iframe height at 375px and stays under 30 KB with its crest", async ({ page, request }) => {
  test.setTimeout(600_000);
  const slugs = [...new Set([...(await (await request.get("/programs")).text()).matchAll(/href="\/programs\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
  expect(slugs.length).toBeGreaterThan(250);
  await page.setViewportSize({ width: 375, height: 812 });
  const tall: string[] = [];
  const heavy: string[] = [];
  for (const slug of slugs) {
    const res = await request.get(embed(slug));
    const html = await res.text();
    const crest = /<img src="([^"]+)"/.exec(html)?.[1];
    const bytes = Buffer.byteLength(html) + (crest ? (await (await request.get(crest)).body()).length : 0);
    if (bytes >= 30_000) heavy.push(`${slug}: ${bytes}`);
    await page.setContent(html); // the page's own styles; no request leaves the test but the crest, which a missing origin leaves empty
    const h = await page.evaluate(() => document.body.offsetHeight);
    if (h > EMBED_HEIGHT) tall.push(`${slug}: ${h}`);
  }
  expect(heavy).toEqual([]);
  expect(tall).toEqual([]);
});
