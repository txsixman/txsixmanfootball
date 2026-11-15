import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { unsubscribeUrl } from "../lib/email/unsubscribe";

// Email alerts (ADR 0053): the opt-in block on /account, and the signed one-click unsubscribe.
//
// Two sets. The first runs anywhere, with no Supabase project (CI): the unsubscribe page and route fail closed and say the
// same thing for every bad link, and nothing leaks. The second needs a server that can sign a fan in, so the test starts a
// stand-in for Supabase's API on E2E_STUB_PORT and the site under test is started pointing at it:
//   E2E_PORT=3063 E2E_STUB_PORT=54999 FAN_SIGNIN=on EMAIL_ALERTS=on EMAIL_UNSUBSCRIBE_SECRET=<32+ characters> \
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54999 NEXT_PUBLIC_SUPABASE_ANON_KEY=stub \
//   apps/web/node_modules/.bin/playwright test -c apps/web/playwright.config.ts e2e/email-alerts.spec.ts
// (One dev server at a time on this Mac: take the lock named in the agent rules first.)
test.use({ serviceWorkers: "block" });

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
const BETTING = /\b(spread|spreads|odds|betting|wager|parlay)\b/i;
const USER = "bbbbbbbb-0000-4000-8000-000000000001";
const SECRET = process.env.EMAIL_UNSUBSCRIBE_SECRET ?? "";
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 0);

test.describe("unsubscribe, with no sign-in and nothing configured", () => {
  test.skip(STUB_PORT > 0, "the stub-backed set below runs instead");

  test("a link that does not verify shows one plain message, with no way to unsubscribe, and passes axe", async ({ page }) => {
    const res = await page.goto(`/account/email/unsubscribe?u=${USER}&k=game_alerts&s=nope`);
    expect(res?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.getByRole("heading", { level: 1, name: "Unsubscribe" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("did not work");
    await expect(page.getByRole("button")).toHaveCount(0);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(BETTING);
    expect(text).not.toMatch(/@/);
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  });

  test("the route changes nothing on a GET, refuses a bad POST the same way whatever the id, and sets no cache", async ({ request }) => {
    const get = await request.get(`/api/email/unsubscribe?u=${USER}&k=game_alerts&s=nope`, { maxRedirects: 0 });
    expect(get.status()).toBe(303);
    expect(get.headers().location).toContain("/account/email/unsubscribe?u=");
    const a = await request.post(`/api/email/unsubscribe?u=${USER}&k=game_alerts&s=nope`, { form: { "List-Unsubscribe": "One-Click" } });
    const b = await request.post("/api/email/unsubscribe?u=nobody&k=game_alerts&s=nope", { form: { "List-Unsubscribe": "One-Click" } });
    // 400 where the site is set up, 503 where it is not: never different for different ids.
    expect([400, 503]).toContain(a.status());
    expect(b.status()).toBe(a.status());
    expect(await a.json()).toEqual(await b.json());
    expect(a.headers()["cache-control"]).toContain("no-store");
  });

  test("the unsubscribed page is plain and passes axe", async ({ page }) => {
    await page.goto("/account/email/unsubscribed");
    await expect(page.getByRole("heading", { level: 1, name: "Unsubscribed" })).toBeVisible();
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  });
});

// ---- the stand-in for Supabase ------------------------------------------------------------------------------------------
type Stub = { eligible: boolean; follows: string[]; optins: string[]; saved: string[][]; unsubscribed: { p_user: string; p_kind: string }[] };
const stub: Stub = { eligible: true, follows: ["jayton", "guthrie"], optins: [], saved: [], unsubscribed: [] };
let server: Server | undefined;

const jwt = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: USER, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
};
const user = { id: USER, aud: "authenticated", role: "authenticated", email: "fan@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

test.describe("with a signed-in fan (a stand-in for Supabase)", () => {
  test.skip(!STUB_PORT || !SECRET || process.env.FAN_SIGNIN !== "on" || process.env.EMAIL_ALERTS !== "on", "needs the stub server and the settings in this file's header");

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = req.url ?? "";
        const json = (v: unknown, status = 200) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(v)));
        const args = body ? JSON.parse(body) : {};
        if (url.startsWith("/auth/v1/user")) return json(user);
        const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(url)?.[1];
        if (rpc === "my_profile") return json([{ display_name: "Bobcat Fan", created_at: "2026-01-01T00:00:00Z", muted_until: null, banned: false }]);
        if (rpc === "my_follows") return json(stub.follows.map((program_slug) => ({ program_slug, created_at: "2026-01-01T00:00:00Z" })));
        if (rpc === "email_my_settings") {
          const rows = stub.optins.map((program_slug) => ({ eligible: stub.eligible, kind: "game_alerts", program_slug }));
          return json(rows.length ? rows : [{ eligible: stub.eligible, kind: null, program_slug: null }]);
        }
        if (rpc === "email_set_optins") return (stub.saved.push(args.p_slugs), (stub.optins = args.p_slugs), res.writeHead(204), res.end());
        if (rpc === "email_unsubscribe") return (stub.unsubscribed.push(args), res.writeHead(204), res.end());
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((ok) => server!.listen(STUB_PORT, "127.0.0.1", ok));
  });
  test.afterAll(async () => {
    await new Promise<void>((ok) => (server ? server.close(() => ok()) : ok()));
  });
  test.beforeEach(async ({ context, baseURL }) => {
    Object.assign(stub, { eligible: true, follows: ["jayton", "guthrie"], optins: [], saved: [], unsubscribed: [] });
    const session = { access_token: jwt(), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user };
    await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: baseURL! }]);
  });

  test("email alerts start off, save for all followed teams or chosen ones, and turn off", async ({ page }) => {
    await page.goto("/account");
    const block = page.getByRole("region", { name: "Email alerts" });
    await expect(block).toBeVisible();
    await expect(block.getByRole("checkbox", { checked: true })).toHaveCount(0); // never on by default
    await expect(block.getByRole("checkbox", { name: "Jayton" })).toBeVisible({ timeout: 20_000 }); // named from the team's own file
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    expect(await block.innerText()).not.toMatch(BETTING);

    await block.getByRole("checkbox", { name: "All the teams I follow" }).check();
    await expect(block.getByRole("checkbox", { name: "Jayton" })).toBeDisabled();
    await block.getByRole("button", { name: "Save email alerts" }).click();
    await expect(block.getByText("Saved.")).toBeVisible();
    expect(stub.saved).toEqual([["*"]]);

    await block.getByRole("checkbox", { name: "All the teams I follow" }).uncheck();
    await block.getByRole("checkbox", { name: "Jayton" }).check();
    await block.getByRole("button", { name: "Save email alerts" }).click();
    await expect.poll(() => stub.saved.length).toBe(2);
    expect(stub.saved[1]).toEqual(["jayton"]);

    await page.reload();
    await expect(page.getByRole("region", { name: "Email alerts" }).getByRole("checkbox", { name: "Jayton" })).toBeChecked();
    await expect(page.getByRole("region", { name: "Email alerts" }).getByRole("checkbox", { name: "Guthrie" })).not.toBeChecked();
    await page.getByRole("region", { name: "Email alerts" }).getByRole("checkbox", { name: "Jayton" }).uncheck();
    await page.getByRole("region", { name: "Email alerts" }).getByRole("button", { name: "Save email alerts" }).click();
    await expect.poll(() => stub.saved.length).toBe(3);
    expect(stub.saved[2]).toEqual([]);
  });

  test("an account that is not eligible, and one that follows no one, get a plain note and no form", async ({ page }) => {
    stub.eligible = false;
    await page.goto("/account");
    const block = page.getByRole("region", { name: "Email alerts" });
    await expect(block).toContainText("not available for this account");
    await expect(block.getByRole("checkbox")).toHaveCount(0);
    stub.eligible = true;
    stub.follows = [];
    await page.reload();
    await expect(block).toContainText("Follow a team");
    await expect(block.getByRole("checkbox")).toHaveCount(0);
  });

  test("a good link unsubscribes with one click and with a POST, a bad one does nothing, and nobody is named", async ({ page, request, baseURL }) => {
    const link = (path?: string) => unsubscribeUrl(baseURL!, SECRET, USER, "game_alerts", path);
    await page.goto(link("/account/email/unsubscribe"));
    await expect(page.getByRole("button", { name: "Stop these emails" })).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/@|fan@|Bobcat/);
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    expect(stub.unsubscribed).toEqual([]); // opening the page changed nothing
    await page.getByRole("button", { name: "Stop these emails" }).click();
    await expect(page).toHaveURL(/\/account\/email\/unsubscribed$/);
    expect(stub.unsubscribed).toEqual([{ p_user: USER, p_kind: "game_alerts" }]);

    const oneClick = await request.post(link(), { form: { "List-Unsubscribe": "One-Click" } });
    expect([oneClick.status(), await oneClick.json()]).toEqual([200, { ok: true }]);
    expect(stub.unsubscribed).toHaveLength(2); // again is harmless
    const bad = await request.post(link().replace(/s=[^&]+/, "s=forged"), { form: { "List-Unsubscribe": "One-Click" } });
    expect(bad.status()).toBe(400);
    expect(stub.unsubscribed).toHaveLength(2);
  });
});
