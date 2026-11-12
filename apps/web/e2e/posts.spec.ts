import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Fan posts (ADR 0018) are behind the server switch FAN_SIGNIN="on" (lib/auth/config.ts). Default, off: nothing exists. With
// FAN_SIGNIN=on set for the test server, signed out: a game page shows its comments read-only with a sign-in prompt, there is no form to
// write or report anything, and the forums render and pass axe. The test server has no Supabase settings, so these are the
// pages exactly as a visitor with no session sees them.

async function inWeb<T>(run: () => Promise<T>): Promise<T> {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await run();
  } finally {
    process.chdir(was);
  }
}

let cached: Promise<{ played: string; unplayed: string }> | undefined;
const games = () =>
  (cached ??= inWeb(async () => {
    const { loadAlignments } = await import("../lib/alignments");
    const { loadGames, loadSeasonResults } = await import("../lib/games");
    const played = (await loadSeasonResults(2025))[0];
    const unplayed = (await loadGames(await loadAlignments())).find((g) => g.state === "scheduled");
    if (!unplayed) throw new Error("no unplayed bracket game in the data to test the report block on");
    return { played: played.href, unplayed: `/scores/${unplayed.id}` };
  }));

async function axeClean(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
}

test.setTimeout(120_000);

const on = process.env.FAN_SIGNIN === "on";

// ---- switch off (the default): fan posting does not exist ---------------------------------------------------------

test.describe("FAN_SIGNIN not on", () => {
  test.skip(on, "the test server has FAN_SIGNIN=on");

  test("game pages show no comments and no score-report form", async ({ page }) => {
    const { played, unplayed } = await games();
    for (const url of [played, unplayed]) {
      await page.goto(url, { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("region", { name: /Comments/ })).toHaveCount(0);
      await expect(page.getByRole("region", { name: /report/i })).toHaveCount(0);
      await expect(page.getByLabel("Add a comment")).toHaveCount(0);
      await expect(page.getByRole("spinbutton")).toHaveCount(0);
      await axeClean(page);
    }
  });

  test("the forums and every fan route are 404", async ({ request }) => {
    for (const url of ["/forums", "/forums/general", "/forums/thread/aaaaaaaa-0000-4000-8000-000000000001"]) {
      expect((await request.get(url)).status(), url).toBe(404);
    }
    for (const url of ["/api/fan/me", "/api/games/2026-bi-district-beta-at-alpha/comments", "/api/games/2026-bi-district-beta-at-alpha/score-report"]) {
      expect((await request.get(url)).status(), url).toBe(404);
    }
    const json = { "Content-Type": "application/json" };
    for (const url of ["/api/fan/comments", "/api/fan/reports", "/api/fan/threads", "/api/fan/replies", "/api/fan/posts/aaaaaaaa-0000-4000-8000-000000000001/flag"]) {
      expect((await request.post(url, { headers: json, data: {} })).status(), url).toBe(404);
    }
    expect((await request.patch("/api/fan/posts/aaaaaaaa-0000-4000-8000-000000000001", { headers: json, data: { body: "x" } })).status()).toBe(404);
  });
});

// ---- switch on: the signed-out view ---------------------------------------------------------------------------------
test.describe("FAN_SIGNIN on", () => {
  test.skip(!on, "needs FAN_SIGNIN=on on the test server");


  test("signed out, a game page shows its comments read-only with a sign-in prompt", async ({ page }) => {
    const { played } = await games();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(played, { waitUntil: "networkidle" });
    const comments = page.getByRole("region", { name: "Comments" });
    await expect(comments).toBeVisible();
    await expect(comments.getByText("No comments yet.")).toBeVisible();
    const signIn = comments.getByRole("link", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    expect(await signIn.getAttribute("href")).toBe(`/sign-in?next=${encodeURIComponent(played)}`);
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
    await expect(comments.getByRole("button", { name: /post|flag|edit/i })).toHaveCount(0);
    await expect(page.getByRole("region", { name: /report/i })).toHaveCount(0);
    await axeClean(page);
    expect(errors).toEqual([]);
  });

  test("signed out, a game with no score yet shows the report block without any form", async ({ page }) => {
    const { unplayed } = await games();
    await page.goto(unplayed, { waitUntil: "networkidle" });
    const block = page.getByRole("region", { name: "Fan score reports" });
    await expect(block).toBeVisible();
    await expect(block.getByText("No score is confirmed yet.")).toBeVisible();
    await expect(block.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /report/i })).toHaveCount(0);
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
    await axeClean(page);
  });

  test("the comment read is public, names only what a page shows, and is never cached", async ({ request }) => {
    const r = await request.get("/api/games/2025-09-05-alpha-at-beta/comments");
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toBe("no-store");
    expect(await r.json()).toEqual({ comments: [], total: 0 });
    expect((await request.get("/api/games/..%2Fetc/comments")).status()).toBe(200);
    const report = await request.get("/api/games/2026-bi-district-beta-at-alpha/score-report");
    expect(report.headers()["cache-control"]).toBe("no-store");
    expect(await report.json()).toEqual({ reports: 0, confirmed: false });
  });

  test("the posting API refuses a signed-out visitor, a cross-site write and a non-JSON write", async ({ request }) => {
    const post = (url: string, headers: Record<string, string>, data = "{}") => request.post(url, { headers, data });
    const json = { "Content-Type": "application/json" };
    for (const url of ["/api/fan/comments", "/api/fan/reports", "/api/fan/posts/aaaaaaaa-0000-4000-8000-000000000001/flag"]) {
      expect((await post(url, json)).status(), url).toBe(401);
      expect((await post(url, { ...json, Origin: "https://evil.test" })).status(), url).toBe(403);
      expect((await post(url, { "Content-Type": "text/plain" })).status(), url).toBe(403);
    }
    const me = await request.get("/api/fan/me");
    expect(await me.json()).toEqual({ signedIn: false });
    expect(me.headers()["cache-control"]).toContain("no-store");
    expect(me.headers()["x-robots-tag"]).toContain("noindex");
  });

  test("the forums render for a visitor and pass axe: boards, a board's threads, and no way to post", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const response = await page.goto("/forums", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { level: 1, name: "Forums" })).toBeVisible();
    const boards = page.getByRole("main").getByRole("link").filter({ hasText: /General|UIL Division I|UIL Division II|Private schools|Playoffs/ });
    await expect(boards).toHaveCount(5);
    await axeClean(page);
    await boards.first().click();
    await expect(page).toHaveURL(/\/forums\/general$/);
    await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /start thread|post/i })).toHaveCount(0);
    await axeClean(page);
    expect((await page.request.get("/forums/no-such-board")).status()).toBe(404);
    expect((await page.request.get("/forums/thread/not-a-uuid")).status()).toBe(404);
    expect(errors).toEqual([]);
  });

  test("the forum writes refuse a signed-out visitor", async ({ request }) => {
    const json = { "Content-Type": "application/json" };
    expect((await request.post("/api/fan/threads", { headers: json, data: { board: "general", title: "t", body: "b" } })).status()).toBe(401);
    expect((await request.post("/api/fan/replies", { headers: json, data: { threadId: "aaaaaaaa-0000-4000-8000-000000000001", body: "b" } })).status()).toBe(401);
    expect((await request.post("/api/fan/threads", { headers: json, data: { board: "nope", title: "t", body: "b" } })).status()).toBe(401);
  });
});
