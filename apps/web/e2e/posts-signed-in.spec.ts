import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import path from "node:path";

// Fan posts for a signed-in fan (ADRs 0018, 0052, 0059): every posts page with its forms, on phone and desktop, passes axe;
// Report is on every other fan's post (and, signed out, is a sign-in link); the site refuses gambling talk before the database
// is asked; a paused account sees why and no form. The database's own rules are tested in packages/db/test.
//
// It needs a server that can sign a fan in, so the test starts a stand-in for Supabase's API on E2E_STUB_PORT and the site under
// test is started pointing at it (CI's web-launch signin-stub config sets all of these before the build):
//   E2E_PORT=3064 E2E_STUB_PORT=54999 FAN_SIGNIN=on FAN_POSTS=on EMAIL_ALERTS=on \
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54999 NEXT_PUBLIC_SUPABASE_ANON_KEY=stub \
//   apps/web/node_modules/.bin/playwright test -c apps/web/playwright.config.ts --workers=1 e2e/posts-signed-in.spec.ts
// (account-center.spec.ts and email-alerts.spec.ts bind the same stub port, so they run one after the other: --workers=1.)
test.use({ serviceWorkers: "block" });
test.setTimeout(90_000);

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 0);
const POSTS = process.env.FAN_SIGNIN === "on" && process.env.FAN_POSTS === "on";
const USER = "bbbbbbbb-0000-4000-8000-000000000003";
const THREAD = "cccccccc-0000-4000-8000-000000000001";
const MINE = "eeeeeeee-0000-4000-8000-000000000001";
const THEIRS = "eeeeeeee-0000-4000-8000-000000000002";
const ME = "Bobcat Fan";
const RIVAL = "Rival Fan";
const BETTING = /\b(spreads?|odds|betting|wagers?|parlays?)\b/i;

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
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

// ---- the stand-in for Supabase ------------------------------------------------------------------------------------------
type Stub = { muted: boolean; calls: { rpc: string; args: Record<string, unknown> }[]; refuse: string | null };
const fresh = (): Stub => ({ muted: false, calls: [], refuse: null });
const stub: Stub = fresh();
let server: Server | undefined;

const post = (id: string, author: string, body: string) => ({ id, author, body, created_at: "2026-11-08T18:00:00Z", edited: false, joined: "Jan 2026", total: 2 });
const posts = () => [post(MINE, ME, "Great game last night"), post(THEIRS, RIVAL, "We will get you next year")];

const jwt = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: USER, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
};
const user = { id: USER, aud: "authenticated", role: "authenticated", email: "fan@example.test", app_metadata: { provider: "google", providers: ["google"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

test.describe("posts for a signed-in fan (a stand-in for Supabase)", () => {
  test.skip(!STUB_PORT || !POSTS, "needs the stub server, FAN_SIGNIN=on and FAN_POSTS=on (this file's header)");

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = req.url ?? "";
        const json = (v: unknown, status = 200) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(v)));
        const none = () => (res.writeHead(204), res.end());
        const args = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        if (url.startsWith("/auth/v1/user")) return json(user);
        const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(url)?.[1];
        if (!rpc) return (res.writeHead(404), res.end());
        stub.calls.push({ rpc, args });
        const writes = ["add_comment", "flag_post", "create_thread", "reply_to_thread", "edit_post", "submit_score_report"];
        if (stub.refuse && writes.includes(rpc)) return json({ code: "P0001", message: stub.refuse, details: null, hint: null }, 400);
        switch (rpc) {
          case "my_profile":
            return json([{ display_name: ME, created_at: "2026-01-15T18:00:00Z", muted_until: stub.muted ? "2099-01-01T00:00:00Z" : null, banned: false }]);
          case "my_follows":
            return json([]);
          case "list_comments":
            return json(posts().map(({ joined: _joined, ...p }) => p));
          case "fan_score_status":
            return json([{ reports: 1, confirmed: false, home_score: null, away_score: null, basis: null }]);
          case "forum_boards":
            return json([{ slug: "general", name: "General", description: "Anything about Texas six-man football.", threads: 1, last_post_at: "2026-11-08T18:00:00Z" }]);
          case "forum_threads":
            return json([{ id: THREAD, title: "Friday night", author: RIVAL, created_at: "2026-11-08T18:00:00Z", last_post_at: "2026-11-08T18:00:00Z", replies: 1, total: 1 }]);
          case "forum_thread_info":
            return json([{ id: THREAD, board: "general", board_name: "General", title: "Friday night", total: 2 }]);
          case "forum_posts":
            return json(posts());
          case "add_comment":
          case "create_thread":
          case "reply_to_thread":
            return json("ffffffff-0000-4000-8000-000000000001");
          case "flag_post":
          case "edit_post":
          case "submit_score_report":
            return none();
          default:
            res.writeHead(404);
            return res.end();
        }
      });
    });
    await new Promise<void>((ok) => server!.listen(STUB_PORT, "127.0.0.1", ok));
  });
  test.afterAll(async () => {
    await new Promise<void>((ok) => {
      if (!server) return ok();
      server.close(() => ok());
      server.closeAllConnections();
    });
  });
  test.beforeEach(async ({ context, baseURL }) => {
    Object.assign(stub, fresh());
    const session = { access_token: jwt(), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user };
    await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: baseURL! }]);
  });
  const called = (rpc: string) => stub.calls.filter((c) => c.rpc === rpc);

  test("a game page: comments with Edit on mine and Report on others', the comment box, and axe", async ({ page }) => {
    const { played } = await games();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(played, { waitUntil: "networkidle" });
    const comments = page.getByRole("region", { name: "Comments" });
    await expect(comments.getByText("We will get you next year")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Add a comment")).toBeVisible();
    await expect(comments.getByRole("button", { name: "Edit" })).toHaveCount(1);
    await expect(comments.getByRole("button", { name: `Report ${ME}'s post` })).toHaveCount(0);
    await axeClean(page);

    await comments.getByRole("button", { name: `Report ${RIVAL}'s post` }).click();
    await expect(comments.getByText("Reported. Thank you.")).toBeVisible();
    expect(called("flag_post").map((c) => c.args)).toEqual([{ p_post: THEIRS }]);

    // Gambling talk is refused by the site before the database is asked (ADR 0059).
    await page.getByLabel("Add a comment").fill("What are the odds on Friday?");
    await comments.getByRole("button", { name: "Post comment" }).click();
    await expect(comments.getByText("That cannot be posted. Gambling talk is not allowed.")).toBeVisible();
    expect(called("add_comment")).toEqual([]);

    // Too fast: the database's refusal, shown in words.
    stub.refuse = "rate_limited";
    await page.getByLabel("Add a comment").fill("Great defense tonight");
    await comments.getByRole("button", { name: "Post comment" }).click();
    await expect(comments.getByText("You are doing that too fast. Try again in a few minutes.")).toBeVisible();
    expect(called("add_comment").map((c) => c.args.p_body)).toEqual(["Great defense tonight"]);
    await axeClean(page);
    expect(await page.locator("main").innerText()).not.toMatch(BETTING);
    expect(errors).toEqual([]);
  });

  test("a game with no score yet: the report block for a signed-in fan passes axe", async ({ page }) => {
    const { unplayed } = await games();
    await page.goto(unplayed, { waitUntil: "networkidle" });
    const block = page.getByRole("region", { name: "Fan score reports" });
    await expect(block.getByText("1 report received.")).toBeVisible({ timeout: 20_000 });
    // The form opens on the game's day; before it, one sentence says so. Either way, no sign-in prompt.
    await expect(block.getByRole("button", { name: "Report final score" }).or(block.getByText("Score reports open on the day of the game."))).toBeVisible();
    await expect(block.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await axeClean(page);
  });

  test("the forums signed in: a board with the new-thread form, a thread with Report and the reply box, and axe on each", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/forums", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Forums" })).toBeVisible();
    await axeClean(page);

    await page.goto("/forums/general", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: /Friday night/ })).toBeVisible();
    await expect(page.getByLabel("Title")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("First post")).toBeVisible();
    await axeClean(page);
    await page.getByLabel("Title").fill("Best odds this week");
    await page.getByLabel("First post").fill("Who wins?");
    await page.getByRole("button", { name: "Start thread" }).click();
    await expect(page.getByText("That cannot be posted. Gambling talk is not allowed.")).toBeVisible();
    expect(called("create_thread")).toEqual([]);

    await page.goto(`/forums/thread/${THREAD}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Friday night" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Report ${RIVAL}'s post` })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Reply")).toBeVisible();
    await axeClean(page);
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Edit your post")).toBeVisible();
    await axeClean(page);
    expect(errors).toEqual([]);
  });

  test("a paused account sees why on every posts page and gets no form", async ({ page }) => {
    stub.muted = true;
    const { played } = await games();
    for (const url of [played, "/forums/general", `/forums/thread/${THREAD}`]) {
      await page.goto(url, { waitUntil: "networkidle" });
      await expect(page.getByText("Your account is paused from posting for now.").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Report .*'s post/ })).toHaveCount(0);
      await axeClean(page);
    }
  });

  test("signed out, Report on a post is a link to sign in that comes back here", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto(`/forums/thread/${THREAD}`, { waitUntil: "networkidle" });
    const report = page.getByRole("link", { name: `Report ${RIVAL}'s post (sign in first)` });
    await expect(report).toBeVisible({ timeout: 20_000 });
    expect(await report.getAttribute("href")).toBe(`/sign-in?next=${encodeURIComponent(`/forums/thread/${THREAD}`)}`);
    // Signed out, even my own post (by name) has no Edit: nothing tells the page who wrote it.
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await axeClean(page);
    expect(called("flag_post")).toEqual([]);
  });
});
