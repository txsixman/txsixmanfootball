import { expect, test } from "@playwright/test";

// A results week for a small-town paper or radio station (ADR 0102): a plain-text file, a "Copy results" button that copies the same
// text, and a print layout that is only that text. The 2025 UIL week 9 is a full regular-season week of real files (no team is named
// here); the checks read the page and the text and hold them against each other.
test.setTimeout(120_000); // the dev server compiles each route the first time it is asked

const WEEK = "/results/2025/9";
const TEXT = "/results/text/2025/9/uil";
const WORDS = /\b(wins?|won|winner|winning|leads?|leading|ahead|beat|beats|defeated|spreads?|odds|lines?|bets?|betting|picks?|maxpreps|sources?)\b/i;
const GAME = /^.+ \d+, .+ \d+$|^.+ vs .+, (forfeit \(.+\)|score reported)$/;
/** A game's line, not a district's heading ("UIL Division I, Region 2, District 5" has digits and a comma too). */
const isGame = (line: string) => GAME.test(line) && !/^(UIL|TAPPS|TAIAO|TCAF) .*District \d+$/.test(line);

test("a week's text file is plain text, kept out of search, one line a game, ending with the credit", async ({ request }) => {
  const res = await request.get(TEXT);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(res.headers()["x-robots-tag"]).toContain("noindex");
  const text = await res.text();
  const lines = text.split("\n");
  expect(lines[0]).toBe("UIL six-man football results, 2025 season, week 9");
  expect(lines[1]).toMatch(/^Games played [A-Z][a-z]{2} \d+ to [A-Z][a-z]{2} \d+, 2025$/);
  expect(text.endsWith("\nScores from txsixmanfootball.com\n")).toBe(true);
  expect(text).not.toMatch(WORDS);
  expect(lines.filter(isGame).length).toBeGreaterThan(10);
  // Away team first, "vs" and never "at" (ADR 0037); a section only when it holds games.
  expect(text).not.toMatch(/ at [A-Z]/);
  expect(lines.filter((l) => /^([A-Z-]+ )?GAMES$/.test(l)).length).toBeGreaterThan(0);
});

test("the text holds every game the page lists, and an address with no week or no organization is a 404", async ({ page, request }) => {
  await page.goto(WEEK);
  const listed = await page.locator("main section li").count();
  const text = await (await request.get(TEXT)).text();
  expect(text.split("\n").filter(isGame).length).toBe(listed);
  expect((await request.get("/results/text/2025/99/uil")).status()).toBe(404);
  expect((await request.get("/results/text/2025/9/all")).status()).toBe(404);
  // TAPPS has its own file, with only its games (ADR 0012): it is not UIL's.
  const tapps = await (await request.get("/results/text/2025/9/tapps")).text();
  expect(tapps.split("\n")[0]).toBe("TAPPS six-man football results, 2025 season, week 9");
  expect(tapps).not.toBe(text);
});

test("Copy results puts the file's text on the clipboard, at 44px, and moves nothing", async ({ page, context, request }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(WEEK);
  const button = page.getByRole("button", { name: "Copy results" });
  const link = page.getByRole("main").getByRole("link", { name: "View as text" });
  for (const target of [button, link]) {
    await expect(target).toBeVisible();
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.width).toBeGreaterThanOrEqual(43.5);
  }
  await expect(link).toHaveAttribute("href", TEXT);
  const status = page.locator("[data-copy-status]");
  const row = page.locator("main section li").first();
  const [rowBefore, heightBefore, statusBefore] = [await row.boundingBox(), await page.evaluate(() => document.documentElement.scrollHeight), await status.boundingBox()];
  await button.click();
  await expect(status).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await (await request.get(TEXT)).text());
  // The confirmation has a place of its own: the list, the page and the line itself keep their size and place.
  expect(await row.boundingBox()).toEqual(rowBefore);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(heightBefore);
  expect(await status.boundingBox()).toEqual(statusBefore);
  await expect(status).toHaveText("", { timeout: 6000 });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(heightBefore);
});

test("printing gives the text alone: no header, tabs, buttons, links or footer, names in full, one column", async ({ page, request }) => {
  await page.goto(WEEK);
  const block = page.locator("[data-results-print]");
  await expect(block).toBeHidden(); // on screen the text is only what the button copies and the file holds
  await page.emulateMedia({ media: "print" });
  await expect(block).toBeVisible();
  await expect(page.locator("header:visible")).toHaveCount(0);
  await expect(page.locator("footer:visible")).toHaveCount(0);
  await expect(page.locator("section[aria-labelledby=results]")).toBeHidden();
  const main = page.locator("main");
  await expect(main.getByRole("navigation")).toHaveCount(0); // hidden navigation leaves the accessibility tree
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.locator("a:visible")).toHaveCount(0);
  const pre = page.locator("#results-text");
  expect((await pre.innerText()).trimEnd()).toBe((await (await request.get(TEXT)).text()).trimEnd());
  const style = await pre.evaluate((el) => {
    const s = getComputedStyle(el);
    return { white: s.whiteSpace, columns: s.columnCount, color: s.color, wide: el.scrollWidth > el.clientWidth };
  });
  expect(style).toEqual({ white: "pre-wrap", columns: "auto", color: "rgb(0, 0, 0)", wide: false });
  await expect(pre).toContainText("Scores from txsixmanfootball.com");
});
