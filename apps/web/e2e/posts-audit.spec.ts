import { test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { writeFileSync } from "node:fs";

// THROWAWAY (audit/posts-375 branch, never merged): full-page phone screenshots of every posting surface, signed out and
// signed in against a stand-in for Supabase. The screenshots land in e2e/.results and the branch's ci.yml uploads them always.
test.use({ serviceWorkers: "block" });
test.setTimeout(240_000);

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 0);
const USER = "bbbbbbbb-0000-4000-8000-000000000003";
const THREAD = "cccccccc-0000-4000-8000-000000000001";
const ME = "Bobcat Fan";
const RIVAL = "Rival Fan";
const LONG = "Whatabouttheplayoffbracketthisweekendwhoeverwinsthisonegoesallthewaytothestatechampionship ".repeat(3);

async function inWeb<T>(run: () => Promise<T>): Promise<T> {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await run();
  } finally {
    process.chdir(was);
  }
}
const games = () =>
  inWeb(async () => {
    const { loadAlignments } = await import("../lib/alignments");
    const { loadGames, loadSeasonResults } = await import("../lib/games");
    const played = (await loadSeasonResults(2025))[0];
    const unplayed = (await loadGames(await loadAlignments())).find((g) => g.state === "scheduled");
    return { played: played.href, unplayed: unplayed ? `/scores/${unplayed.id}` : played.href };
  });

type Stub = { empty: boolean; refuse: string | null };
const stub: Stub = { empty: false, refuse: null };
let server: Server | undefined;
const post = (id: string, author: string, body: string, total: number) => ({ id, author, body, created_at: "2026-11-08T18:00:00Z", edited: false, joined: "Jan 2026", total });
const posts = () => [post("eeeeeeee-0000-4000-8000-000000000001", ME, "Great game last night", 3), post("eeeeeeee-0000-4000-8000-000000000002", RIVAL, "We will get you next year", 3), post("eeeeeeee-0000-4000-8000-000000000003", RIVAL, LONG, 3)];
const jwt = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: USER, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
};
const user = { id: USER, aud: "authenticated", role: "authenticated", email: "fan@example.test", app_metadata: { provider: "google", providers: ["google"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

test.describe("posts audit screenshots", () => {
  test.skip(!STUB_PORT, "needs the stub");
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = req.url ?? "";
        const json = (v: unknown, status = 200) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(v)));
        const none = () => (res.writeHead(204), res.end());
        if (url.startsWith("/auth/v1/user")) return json(user);
        const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(url)?.[1];
        if (!rpc) return (res.writeHead(404), res.end());
        const writes = ["add_comment", "flag_post", "create_thread", "reply_to_thread", "edit_post", "submit_score_report"];
        if (stub.refuse && writes.includes(rpc)) return json({ code: "P0001", message: stub.refuse, details: null, hint: null }, 400);
        switch (rpc) {
          case "my_profile":
            return json([{ display_name: ME, created_at: "2026-01-15T18:00:00Z", muted_until: null, banned: false }]);
          case "my_account":
            return json([{ display_name: ME, joined_at: "2026-01-15T18:00:00Z", name_changed_at: null, next_name_change_at: null }]);
          case "my_follows":
          case "my_devices":
          case "my_push_mutes":
            return json([]);
          case "this_device":
            return json(null);
          case "email_my_settings":
            return json([{ eligible: true, kind: null, program_slug: null }]);
          case "my_activity":
            return json([{ kind: "comment", id: "x1", body_excerpt: "Great game last night", created_at: "2026-11-08T18:00:00Z", href: null }]);
          case "list_comments":
            return json(stub.empty ? [] : posts().map(({ joined: _j, ...p }) => p));
          case "fan_score_status":
            return json([{ reports: 0, confirmed: false, home_score: null, away_score: null, basis: null }]);
          case "forum_boards":
            return json(stub.empty ? [] : [{ slug: "general", name: "General", description: "x", threads: 1, last_post_at: "2026-11-08T18:00:00Z" }]);
          case "forum_threads":
            return json(stub.empty ? [] : [{ id: THREAD, title: "Friday night", author: RIVAL, created_at: "2026-11-08T18:00:00Z", last_post_at: "2026-11-08T18:00:00Z", replies: 2, total: 1 }]);
          case "forum_thread_info":
            return json([{ id: THREAD, board: "general", board_name: "General", title: "Friday night", total: 3 }]);
          case "forum_posts":
            return json(posts());
          case "add_comment":
          case "create_thread":
          case "reply_to_thread":
            return json("ffffffff-0000-4000-8000-000000000001");
          case "flag_post":
          case "edit_post":
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
    await new Promise<void>((ok) => (server ? (server.close(() => ok()), server.closeAllConnections()) : ok()));
  });

  async function signIn(page: Page, baseURL: string) {
    const session = { access_token: jwt(), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user };
    await page.context().addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: baseURL }]);
  }
  async function shot(page: Page, url: string, name: string) {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
    // Focus order: the first 25 tab stops inside main.
    const order: string[] = [];
    await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {});
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const d = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        return e && e.closest("main") ? `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.innerText ?? (e as HTMLInputElement).name ?? "").slice(0, 40).replace(/\s+/g, " ")}"` : null;
      });
      if (d) order.push(d);
      if (order.length >= 25) break;
    }
    await test.info().attach(`${name}-focus.txt`, { body: order.join("\n") });
    writeFileSync(test.info().outputPath(`${name}-focus.txt`), order.join("\n"));
  }

  test("signed out", async ({ page }) => {
    const { played, unplayed } = await games();
    for (const [u, n] of [["/forums", "out-forums"], ["/forums/playoffs", "out-board"], [`/forums/thread/${THREAD}`, "out-thread"], [played, "out-game"], [unplayed, "out-game-unplayed"], ["/sign-in?next=%2Fforums", "out-signin"], ["/scores", "out-scores"], ["/playoffs", "out-playoffs"], ["/playoffs/this-round", "out-this-round"]] as const) await shot(page, u, n);
    stub.empty = true;
    await shot(page, "/forums", "out-forums-empty");
    await shot(page, "/forums/playoffs", "out-board-empty");
    await shot(page, played, "out-game-empty");
    stub.empty = false;
  });

  test("signed in", async ({ page, baseURL }) => {
    await signIn(page, baseURL!);
    const { played } = await games();
    for (const [u, n] of [["/forums", "in-forums"], ["/forums/general", "in-board"], [`/forums/thread/${THREAD}`, "in-thread"], [played, "in-game"], ["/account", "in-account"]] as const) await shot(page, u, n);
    stub.empty = true;
    await shot(page, "/forums/playoffs", "in-board-empty");
    await shot(page, played, "in-game-empty");
    stub.empty = false;
    // Report, then the rate-limit refusal, on the game page.
    await page.goto(played, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Report ${RIVAL}'s post` }).first().click();
    await page.waitForTimeout(800);
    stub.refuse = "rate_limited";
    await page.getByLabel("Add a comment").fill("Great defense tonight");
    await page.getByRole("button", { name: "Post comment" }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: test.info().outputPath("in-game-report-ratelimit.png"), fullPage: true });
    stub.refuse = null;
  });
});
