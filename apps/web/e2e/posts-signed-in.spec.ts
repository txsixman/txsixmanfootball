import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import path from "node:path";

// Fan posts for a signed-in fan (ADRs 0018, 0052, 0060, 0078): every posts page with its forms, on phone and desktop, passes axe;
// Report is on every other fan's post (it asks first; signed out, it is a sign-in link); the site refuses gambling talk before the
// database is asked; a paused account sees why and no form; the empty states of a board and of a game's comments; new comments
// that appear behind a button; the comment counts on the /scores cards. The database's own rules are tested in packages/db/test.
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
// noComments: list_comments answers an empty list. newComments: that many more comments (by "Late Fan") after the two usual ones,
// so a page that is open sees the total grow. countKeys: the game keys comment_counts was asked about, in order; the first
// gets 3 comments, the second 1, the rest none.
type Stub = { muted: boolean; calls: { rpc: string; args: Record<string, unknown> }[]; refuse: string | null; noComments: boolean; newComments: number; countKeys: string[] };
const fresh = (): Stub => ({ muted: false, calls: [], refuse: null, noComments: false, newComments: 0, countKeys: [] });
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
          case "list_comments": {
            const late = Array.from({ length: stub.newComments }, (_, i) => post(`ffffffff-0000-4000-8000-00000000${String(100 + i).padStart(4, "0")}`, "Late Fan", `Late comment ${i + 1}`));
            const all = stub.noComments ? [] : [...posts(), ...late];
            const offset = Number(args.p_offset ?? 0);
            const limit = Number(args.p_limit ?? 30);
            return json(all.slice(offset, offset + limit).map(({ joined: _joined, total: _total, ...p }) => ({ ...p, total: all.length })));
          }
          case "comment_counts": {
            const rows: { game_key: string; comments: number }[] = [];
            for (const key of (args.p_game_keys as string[] | undefined) ?? []) {
              const n = stub.countKeys.push(key) - 1;
              if (n === 0) rows.push({ game_key: key, comments: 3 });
              else if (n === 1) rows.push({ game_key: key, comments: 1 });
            }
            return json(rows);
          }
          case "fan_score_status":
            return json([{ reports: 1, confirmed: false, home_score: null, away_score: null, basis: null }]);
          case "forum_boards":
            return json([{ slug: "general", name: "General", description: "Anything about Texas six-man football.", threads: 1, last_post_at: "2026-11-08T18:00:00Z" }]);
          case "forum_threads":
            // The Playoffs board has no threads; every other board has the one.
            if (args.p_board === "playoffs") return json([]);
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

    // Report asks first: the tap sends nothing; Confirm sends the flag.
    await comments.getByRole("button", { name: `Report ${RIVAL}'s post` }).click();
    expect(called("flag_post")).toEqual([]);
    await comments.getByRole("button", { name: `Confirm report of ${RIVAL}'s post` }).click();
    await expect(comments.getByText("Reported. Thank you.")).toBeVisible();
    expect(called("flag_post").map((c) => c.args)).toEqual([{ p_post: THEIRS }]);

    // Gambling talk is refused by the site before the database is asked (ADR 0060).
    await page.getByLabel("Add a comment").fill("What are the odds on Friday?");
    await comments.getByRole("button", { name: "Post comment" }).click();
    await expect(comments.getByText("That cannot be posted. Gambling talk is not allowed.")).toBeVisible();
    expect(called("add_comment")).toEqual([]);

    // Too fast: the database's refusal, shown in words.
    stub.refuse = "rate_limited";
    await page.getByLabel("Add a comment").fill("Great defense tonight");
    await comments.getByRole("button", { name: "Post comment" }).click();
    await expect(comments.getByText("You've done that a lot in a short time. Wait a minute and try again. If you still see this, you've reached today's limit; try again tomorrow.")).toBeVisible();
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

  test("Report asks first: Cancel and Escape send nothing and focus goes back to Report; Confirm sends it", async ({ page }) => {
    const { played } = await games();
    await page.goto(played, { waitUntil: "networkidle" });
    const comments = page.getByRole("region", { name: "Comments" });
    await expect(comments.getByText("We will get you next year")).toBeVisible({ timeout: 20_000 });
    const report = comments.getByRole("button", { name: `Report ${RIVAL}'s post` });
    const group = comments.getByRole("group", { name: "Confirm report" });
    const confirm = group.getByRole("button", { name: `Confirm report of ${RIVAL}'s post` });
    await expect(group).toHaveCount(0);

    // Tapping Report opens the question, with focus on Confirm; nothing is sent.
    await report.click();
    await expect(group).toBeVisible();
    await expect(group.getByText("Report this post to the moderators?")).toBeVisible();
    await expect(confirm).toBeFocused();
    await expect(report).toHaveCount(0);
    await axeClean(page);

    // Cancel closes it and puts focus back on Report.
    await group.getByRole("button", { name: "Cancel" }).click();
    await expect(group).toHaveCount(0);
    await expect(report).toBeFocused();

    // So does Escape.
    await report.click();
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(group).toHaveCount(0);
    await expect(report).toBeFocused();
    expect(called("flag_post")).toEqual([]);

    // Confirm sends the flag and says so, with focus on the confirmation.
    await report.click();
    await confirm.click();
    const note = comments.getByRole("status").filter({ hasText: "Reported. Thank you." });
    await expect(note).toBeVisible();
    await expect(note).toBeFocused();
    await expect(group).toHaveCount(0);
    expect(called("flag_post").map((c) => c.args)).toEqual([{ p_post: THEIRS }]);
    await axeClean(page);
  });

  test("a game with no comments says so; Write a comment puts the cursor in the box; a paused account gets neither", async ({ page }) => {
    stub.noComments = true;
    const { played } = await games();
    await page.goto(played, { waitUntil: "networkidle" });
    const comments = page.getByRole("region", { name: "Comments" });
    await expect(comments.getByText("No comments yet. Be the first.")).toBeVisible({ timeout: 20_000 });
    await expect(comments.getByRole("heading", { level: 2, name: "Comments", exact: true })).toBeVisible();
    const write = comments.getByRole("button", { name: "Write a comment" });
    await expect(write).toBeVisible({ timeout: 20_000 });
    await axeClean(page);
    await write.click();
    await expect(page.getByLabel("Add a comment")).toBeFocused();

    stub.muted = true;
    await page.goto(played, { waitUntil: "networkidle" });
    await expect(page.getByText("Your account is paused from posting for now.").first()).toBeVisible({ timeout: 20_000 });
    await expect(comments.getByText("No comments yet. Be the first.")).toBeVisible();
    await expect(comments.getByRole("button", { name: "Write a comment" })).toHaveCount(0);
  });

  test("after a comment is posted the status reads Posted. and the box is empty and focused", async ({ page }) => {
    const { played } = await games();
    await page.goto(played, { waitUntil: "networkidle" });
    const comments = page.getByRole("region", { name: "Comments" });
    await expect(comments.getByText("We will get you next year")).toBeVisible({ timeout: 20_000 });
    const box = page.getByLabel("Add a comment");
    await box.fill("Great defense tonight");
    await comments.getByRole("button", { name: "Post comment" }).click();
    await expect(comments.getByText("Posted.")).toBeVisible();
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("");
    expect(called("add_comment").map((c) => c.args.p_body)).toEqual(["Great defense tonight"]);
    await axeClean(page);
  });

  test("new comments arrive behind a Show N new comments button, and the list moves only when it is tapped", async ({ page }) => {
    // A fake clock before the page loads: the minute check runs when the test says a minute has passed.
    await page.clock.install();
    const { played } = await games();
    await page.goto(played, { waitUntil: "networkidle" });
    const comments = page.getByRole("region", { name: "Comments" });
    await expect(comments.getByText("We will get you next year")).toBeVisible({ timeout: 20_000 });
    await expect(comments.getByRole("heading", { level: 2, name: "Comments (2)" })).toBeVisible();

    const before = called("list_comments").length;
    stub.newComments = 1;
    await page.clock.fastForward("01:01");
    await expect(comments.getByRole("button", { name: "Show 1 new comment", exact: true })).toBeVisible({ timeout: 20_000 });
    // The check read the first page again; the list and its count are as they were.
    const asked = called("list_comments").slice(before);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((c) => c.args.p_offset === 0)).toBe(true);
    await expect(comments.getByText("Late comment 1")).toHaveCount(0);
    await expect(comments.getByRole("heading", { level: 2, name: "Comments (2)" })).toBeVisible();

    // Another minute, another comment: the button counts both.
    stub.newComments = 2;
    await page.clock.fastForward("01:01");
    const two = comments.getByRole("button", { name: "Show 2 new comments", exact: true });
    await expect(two).toBeVisible({ timeout: 20_000 });
    await expect(comments.getByText("Late comment 1")).toHaveCount(0);
    await axeClean(page);

    // Tapped: they are in the list, the heading counts them, the button is gone.
    await two.click();
    await expect(comments.getByText("Late comment 1")).toBeVisible();
    await expect(comments.getByText("Late comment 2")).toBeVisible();
    await expect(comments.getByRole("heading", { level: 2, name: "Comments (4)" })).toBeVisible();
    await expect(comments.getByRole("button", { name: /Show \d+ new comments?/ })).toHaveCount(0);
    await expect(comments.getByRole("button", { name: "Show more comments" })).toHaveCount(0);
    await axeClean(page);
  });

  test("signed out, Sign in and Report in a game's comments come back to the comments", async ({ page, context }) => {
    await context.clearCookies();
    const { played } = await games();
    await page.goto(played, { waitUntil: "networkidle" });
    const comments = page.getByRole("region", { name: "Comments" });
    const back = `/sign-in?next=${encodeURIComponent(`${played}#comments`)}`;
    const report = comments.getByRole("link", { name: `Report ${RIVAL}'s post (sign in first)` });
    await expect(report).toBeVisible({ timeout: 20_000 });
    expect(await report.getAttribute("href")).toBe(back);
    const signIn = comments.getByRole("link", { name: "Sign in", exact: true });
    await expect(signIn).toBeVisible();
    expect(await signIn.getAttribute("href")).toBe(back);
    await expect(comments.getByRole("button", { name: /Report/ })).toHaveCount(0);
    await axeClean(page);
    expect(called("flag_post")).toEqual([]);
  });

  test("/scores: a card shows its comment count as plain text, from one request, and axe is clean", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/scores", { waitUntil: "networkidle" });
    const counts = page.locator("[data-comment-count]");
    await expect(counts).toHaveCount(2, { timeout: 20_000 });
    // The stub gave the first game it was asked about 3 comments and the second 1; the rest have none and show nothing.
    const [first, second] = stub.countKeys;
    const card = (key: string) => page.locator(`li[data-game="${key}"]`);
    await expect(card(first).locator("[data-comment-count]")).toHaveText("3 comments");
    await expect(card(first).locator("[data-comment-count]")).toHaveAttribute("data-comment-count", "3");
    await expect(card(second).locator("[data-comment-count]")).toHaveText("1 comment");
    await expect(card(second).locator("[data-comment-count]")).toHaveAttribute("data-comment-count", "1");
    // Inside the card's link, so it is text and not a link of its own.
    await expect(card(first).locator("a [data-comment-count]")).toHaveCount(1);
    expect(await counts.evaluateAll((els) => els.map((e) => `${e.tagName} ${e.querySelectorAll("a").length}`))).toEqual(["SPAN 0", "SPAN 0"]);
    await expect(page.locator("a a")).toHaveCount(0);

    // One request for the whole page (200 keys at most each), asking for every card once.
    const calls = called("comment_counts");
    const keys = calls.flatMap((c) => c.args.p_game_keys as string[]);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of calls) expect((c.args.p_game_keys as string[]).length).toBeLessThanOrEqual(200);
    expect(calls).toHaveLength(Math.ceil(keys.length / 200));
    const cards = await page.locator("li[data-game]").evaluateAll((els) => els.map((e) => e.getAttribute("data-game")));
    expect(cards).toEqual(expect.arrayContaining(keys));
    await axeClean(page);
    expect(errors).toEqual([]);
  });

  test("/playoffs/this-round: every game with a page links to its comments, named for the matchup, from one request", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/playoffs/this-round", { waitUntil: "networkidle" });
    // Rows the bracket only sets (data-built) have no game page and so no link.
    const rows = page.locator("main section li:not([data-built])");
    const n = await rows.count();
    const links = page.locator("main a[data-comment-count]");
    await expect(page.locator("main li[data-built] a[data-comment-count]")).toHaveCount(0);
    if (n === 0) {
      await expect(links).toHaveCount(0);
      return;
    }
    await expect(links).toHaveCount(n, { timeout: 20_000 });
    // The stub gave the first game it was asked about 3 comments and the second 1; the rest have none and say "Comments".
    const [first, second] = stub.countKeys;
    const link = (key: string) => page.locator(`main a[href="/scores/${key}#comments"]`);
    await expect(link(first)).toHaveText("3 comments");
    await expect(link(first)).toHaveAccessibleName(/^3 comments on .+ vs .+$/);
    if (second) await expect(link(second)).toHaveText("1 comment");
    for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) expect(href).toMatch(/^\/scores\/[a-z0-9-]+#comments$/);
    if (n > 2) {
      const plain = links.filter({ hasText: /^Comments$/ }).first();
      await expect(plain).toHaveAttribute("data-comment-count", "0");
      await expect(plain).toHaveAccessibleName(/^Comments on .+ vs .+$/);
    }
    await expect(page.locator("a a")).toHaveCount(0);
    const calls = called("comment_counts");
    expect(calls).toHaveLength(1);
    expect(new Set(calls[0].args.p_game_keys as string[]).size).toBe((calls[0].args.p_game_keys as string[]).length);
    await axeClean(page);
    expect(errors).toEqual([]);
  });

  test("the comment counts route: nonzero games only, valid keys only, 200 at most, cached 30 seconds", async ({ request }) => {
    const r = await request.get("/api/games/comment-counts?keys=aaaaaa-one,bbbbbb-two,cccccc-three,X,x,aaaaaa-one");
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("s-maxage=30");
    expect(await r.json()).toEqual({ counts: { "aaaaaa-one": 3, "bbbbbb-two": 1 } });
    // The database was asked once, with each valid key once and in order.
    expect(called("comment_counts").map((c) => c.args)).toEqual([{ p_game_keys: ["aaaaaa-one", "bbbbbb-two", "cccccc-three"] }]);

    stub.calls.length = 0;
    const many = Array.from({ length: 250 }, (_, i) => `game-${String(i).padStart(4, "0")}`);
    expect((await request.get(`/api/games/comment-counts?keys=${many.join(",")}`)).status()).toBe(200);
    expect((called("comment_counts")[0].args.p_game_keys as string[]).length).toBe(200);

    // Nothing valid to ask: an empty answer, and the database is not asked.
    stub.calls.length = 0;
    expect(await (await request.get("/api/games/comment-counts?keys=X,x")).json()).toEqual({ counts: {} });
    expect(await (await request.get("/api/games/comment-counts")).json()).toEqual({ counts: {} });
    expect(called("comment_counts")).toEqual([]);
  });

  test("the forums index gives every board one count line", async ({ page }) => {
    await page.goto("/forums", { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: /General/ })).toContainText("1 thread · last post Nov 8, 2026");
    // The four boards the database knows nothing of say so; none of the five has two lines or none.
    await expect(main.getByText("No posts yet")).toHaveCount(4);
    await expect(main.getByText(/^(No posts yet|\d+ threads? · last post .+)$/)).toHaveCount(5);
    await expect(page.getByText("Post counts are not available right now.")).toHaveCount(0);
    await axeClean(page);
  });

  test("an empty board, signed in: No posts yet with a link that moves the cursor to the Title field", async ({ page }) => {
    await page.goto("/forums/playoffs", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: "Playoffs" })).toBeVisible();
    const start = page.getByRole("link", { name: "start the first thread" });
    await expect(start).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("No posts yet — start the first thread.")).toBeVisible();
    expect(await start.getAttribute("href")).toBe("#thread-title");
    await expect(page.getByLabel("Title")).toBeVisible();
    await axeClean(page);
    await start.click();
    await expect(page.getByLabel("Title")).toBeFocused();
  });

  test("an empty board, signed out: one Sign in link in the empty line, and no second prompt", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/forums/playoffs", { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    const signIn = main.getByRole("link", { name: "Sign in", exact: true });
    await expect(signIn).toBeVisible({ timeout: 20_000 });
    await expect(main.getByText("No posts yet. Sign in to start the first thread.")).toBeVisible();
    expect(await signIn.getAttribute("href")).toBe("/sign-in?next=%2Fforums%2Fplayoffs");
    await expect(main.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(1);
    await expect(main.getByText("Sign in to start a thread.")).toHaveCount(0);
    await expect(page.getByLabel("Title")).toHaveCount(0);
    await axeClean(page);
  });

  test("the new-thread form shows a character counter for the first post", async ({ page }) => {
    await page.goto("/forums/general", { waitUntil: "networkidle" });
    await expect(page.getByLabel("First post")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("0 / 2000", { exact: true })).toBeVisible();
    await page.getByLabel("First post").fill("Great game");
    await expect(page.getByText("10 / 2000", { exact: true })).toBeVisible();
    await expect(page.getByText("0 / 2000", { exact: true })).toHaveCount(0);
  });
});
