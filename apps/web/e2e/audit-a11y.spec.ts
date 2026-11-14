import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { noLiveScores } from "./live-route";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { demoGames } from "../lib/demo-games";

// No live-score request reaches the network (e2e/live-route.ts).
noLiveScores(test);

// Accessibility and phone-use fixes from the pages audit (Group 3 items 2 to 8, Group 4 item 5), the forfeit wording on
// the game page, the latest-season redirects and the program page's section order.

const SHOTS = path.join(__dirname, ".results", "shots");
const LATEST = Math.max(...readdirSync(path.join(__dirname, "../../../data/ratings")).flatMap((f) => (/^\d{4}\.json$/.test(f) ? [Number(f.slice(0, 4))] : [])));

// Same checks as the other specs' checkPage: status, no console errors, axe, 44px targets, no horizontal overflow.
async function checkPage(page: Page, url: string, stem: string) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response?.status(), url).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${stem}-fold.png`) });
  await page.screenshot({ path: path.join(SHOTS, `${stem}-full.png`), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id), url).toEqual([]);
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    short: [...document.querySelectorAll("main a, main button, main input")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height < 44 && !el.matches("input");
    }).length,
  }));
  expect(m, url).toEqual({ overflow: 0, short: 0 });
  expect(errors).toEqual([]);
}

test("header: the current section is marked, and a skip link leads to the page", async ({ page }) => {
  const current = () => page.getByRole("navigation", { name: "Main" }).locator("[aria-current=page]");
  await page.goto("/rankings");
  await expect(current()).toHaveText("Rankings");
  await expect(current()).toHaveCount(1);
  await page.goto("/rankings/tapps");
  await expect(current()).toHaveText("Rankings");
  await page.goto("/");
  await expect(current()).toHaveCount(0);
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toHaveAttribute("href", "#main");
  await expect(page.locator("main#main")).toHaveCount(1);
  // It is the first thing a keyboard reaches, and shows itself at 44px when it has focus.
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("header: a game page marks Scores as the current section", async ({ page }) => {
  await page.goto("/scores/g1");
  await expect(page.getByRole("navigation", { name: "Main" }).locator("[aria-current=page]")).toHaveText("Scores");
});

test("header and game pages pass on this screen size", async ({ page }, info) => {
  await checkPage(page, "/scores/g1", `a11y-game-sample-${info.project.name}`);
  await checkPage(page, "/records", `a11y-records-${info.project.name}`);
});

test("the rank trend's labels are readable: drawn at 13px or more wherever it is seen", async ({ page }) => {
  await page.goto("/programs/jayton");
  const sizes = await page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>("figure svg[role=img]")!;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    return [...svg.querySelectorAll("text")].map((t) => parseFloat(getComputedStyle(t).fontSize) * scale);
  });
  expect(sizes.length).toBeGreaterThanOrEqual(3);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(13);
});

test("body copy is at least 13px; only the 12px uppercase eyebrow labels stay small", async ({ page }) => {
  const small = (url: string) =>
    page.goto(url).then(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("main *")]
          .filter((el) => {
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
            if (!hasText || el.tagName.toLowerCase() === "style" || el.closest("[aria-hidden=true]") || el.closest(".sr-only")) return false;
            const cs = getComputedStyle(el);
            const size = parseFloat(cs.fontSize);
            const eyebrow = size >= 12 && cs.textTransform === "uppercase" && /tracking-(widest|wider)/.test(el.className);
            return size < 13 && !eyebrow;
          })
          .map((el) => `${el.tagName} ${el.className} "${el.textContent!.trim().slice(0, 30)}"`),
      ),
    );
  const sample = demoGames.find((g) => g.state === "postponed")?.id ?? "g1";
  for (const url of ["/scores", "/scores/sample", `/scores/${sample}`, "/rankings", "/rankings/sample", "/programs/jayton", "/championships", "/records", "/standings"]) {
    expect(await small(url), url).toEqual([]);
  }
});

test("records: every figure says what it counts to a screen reader", async ({ page }) => {
  await page.goto("/records");
  for (const [board, unit] of [
    ["Most points in a game", "points"],
    ["Most points by both teams", "points combined"],
    ["Biggest surprises", "chance to win before the game"],
    ["Longest winning runs", "wins in a row"],
    ["Unbeaten seasons", "record"],
  ]) {
    const rows = page.getByRole("region", { name: board }).getByRole("listitem");
    expect(await rows.count(), board).toBeGreaterThan(0);
    for (const row of await rows.all()) await expect(row.locator(".sr-only").last(), board).toHaveText(unit);
  }
});

test("jump links: a section with no games is plain text, not a dead link", async ({ page }) => {
  await page.goto("/scores");
  const jump = page.getByRole("navigation", { name: "Jump to" });
  // Every link in the bar goes to a section that is on the page.
  const hrefs = await jump.getByRole("link").evaluateAll((els) => els.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) await expect(page.locator(href), href).toHaveCount(1);
  // And one with 0 games is not a link at all.
  await expect(jump.getByText(/^Live/)).toHaveText(/Live\s*0/);
  await expect(jump.getByRole("link", { name: /^Live/ })).toHaveCount(0);
  // Searching a name that matches nothing leaves no link at all.
  await page.getByRole("searchbox", { name: "Find a team" }).fill("zzzz");
  await expect(jump.getByRole("link")).toHaveCount(0);
});

test("standings: the point difference column has a name, and a district link lands clear of the top edge", async ({ page }) => {
  await page.goto("/standings");
  await expect(page.getByRole("columnheader", { name: "Point difference" }).first()).toBeVisible();
  await expect(page.locator("main abbr")).toHaveCount(0);
  const margin = await page.locator("main h2").first().evaluate((h) => parseFloat(getComputedStyle(h).scrollMarginTop));
  expect(margin).toBeGreaterThan(0);
});

test("a real game page shows each school's crest and links to its program", async ({ page }, info) => {
  await page.goto("/scores");
  const href = (await page.locator("[data-game] a").first().getAttribute("href"))!;
  await checkPage(page, href, `a11y-game-real-${info.project.name}`);
  const score = page.getByRole("region", { name: "Score" });
  const links = score.getByRole("link");
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("href", /^\/programs\/[a-z0-9-]+$/);
    // The name is the link text; the crest beside it is decoration (a logo, or the school's initials in its colors).
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // The invented sample schools have no program page, so they keep the plain badge and no link.
  await page.goto("/scores/g1");
  await expect(page.getByRole("region", { name: "Score" }).getByRole("link")).toHaveCount(0);
});

test("a forfeit never shows the recorded 1-0 or 2-0 as a score on the game page (ADR 0004)", async ({ page }) => {
  const forfeit = demoGames.find((g) => /forfeit/i.test(g.endReason ?? ""))!;
  await page.goto(`/scores/${forfeit.id}`);
  await expect(page.getByText("Forfeit. No score was played.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/Recorded|not a played score/);
  await expect(page.locator("main")).not.toContainText(/\b[0-2]\s*[–-]\s*[0-2]\b/);
});

test(`the latest season (${LATEST}) redirects to its bare address, for every organization`, async ({ request }) => {
  const redirects: [string, string][] = [
    [`/results/${LATEST}`, "/results"],
    [`/results/${LATEST}/tapps`, "/results/tapps"],
    [`/results/${LATEST}/taiao`, "/results/taiao"],
    [`/rankings/season/${LATEST}`, "/rankings"],
    [`/rankings/season/${LATEST}/tapps`, "/rankings/tapps"],
    [`/rankings/season/${LATEST}/tcaf`, "/rankings/tcaf"],
  ];
  for (const [from, to] of redirects) {
    const r = await request.get(from, { maxRedirects: 0 });
    expect(r.status(), from).toBe(307);
    expect(new URL(r.headers().location, "http://x").pathname, from).toBe(to);
  }
  // A week of the latest season and an older season are pages of their own.
  expect((await request.get(`/results/${LATEST}/1`, { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get(`/results/${LATEST - 1}`, { maxRedirects: 0 })).status()).toBe(200);
  expect((await request.get(`/rankings/season/${LATEST - 1}`, { maxRedirects: 0 })).status()).toBe(200);
});

test("a program page leads with this season's games, right after the next and latest game and the alerts", async ({ page }) => {
  await page.goto("/programs/jayton");
  const order = await page.evaluate(() => {
    const parts: [string, Element | null][] = [
      ["strip", document.querySelector('[aria-label="Next and latest game"]')],
      ["alerts", document.getElementById("alerts")],
      ["games", document.getElementById("games")],
      ["seasons", document.getElementById("seasons")],
      ["rivals", document.getElementById("rivals")],
      ["finals", document.getElementById("finals")],
    ];
    const found = parts.filter((p): p is [string, Element] => p[1] !== null);
    found.sort((x, y) => (x[1].compareDocumentPosition(y[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return found.map(([name]) => name);
  });
  expect(order.slice(0, 3)).toEqual(["strip", "alerts", "games"]);
  expect(order).toContain("seasons");
});

test("the program page passes on this screen size, with the games section first", async ({ page }, info) => {
  await checkPage(page, "/programs/jayton", `a11y-program-${info.project.name}`);
});

test("an edge-to-edge page starts right under the header, covering none of it", async ({ page }) => {
  for (const url of ["/scores", "/programs/jayton"]) {
    await page.goto(url);
    const gap = await page.evaluate(() => {
      const header = document.querySelector("body header")!.getBoundingClientRect();
      const sheet = document.querySelector("main")!.firstElementChild!.getBoundingClientRect();
      return Math.round(sheet.top - header.bottom);
    });
    expect(gap, url).toBe(0);
  }
});
