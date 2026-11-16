import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";

// The Account Center on /account (ADR 0058): the six sections and their nav, the display-name change and its 30-day rule, this
// browser's push alerts and the linked devices, sign out of all devices, download my data, and My activity (only while posts are on).
//
// Two sets. The first runs anywhere fan sign-in is on (CI's signin configs): the account routes refuse a signed-out caller.
// The second needs a server that can sign a fan in, so the test starts a stand-in for Supabase's API on E2E_STUB_PORT and the site
// under test is started pointing at it (CI's signin-stub config sets all of these before the build):
//   E2E_PORT=3064 E2E_STUB_PORT=54999 FAN_SIGNIN=on FAN_POSTS=on EMAIL_ALERTS=on \
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54999 NEXT_PUBLIC_SUPABASE_ANON_KEY=stub \
//   apps/web/node_modules/.bin/playwright test -c apps/web/playwright.config.ts --workers=1 e2e/account-center.spec.ts
// (email-alerts.spec.ts binds the same stub port, so the two run one after the other: --workers=1.)
test.use({ serviceWorkers: "block" });

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
const BETTING = /\b(spread|spreads|odds|betting|wager|parlay)\b/i;
const USER = "bbbbbbbb-0000-4000-8000-000000000002";
const EMAIL = "fan@example.test";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/e2e-account-center-endpoint";
const D1 = "dddddddd-0000-4000-8000-000000000001"; // this browser's device
const D2 = "dddddddd-0000-4000-8000-000000000002";
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 0);
const FAN_ON = process.env.FAN_SIGNIN === "on";
const POSTS = FAN_ON && process.env.FAN_POSTS === "on";
// A birth year (2007 to 2013, or any 19xx) as a stand-alone number: the page never shows one. (Dates here are 2025 and later.)
const BIRTH_YEAR = /\b(19\d\d|200\d|201[0-3])\b/;

test.describe("the account routes, signed out", () => {
  test.skip(!FAN_ON || STUB_PORT > 0, "needs fan sign-in on; with the stub the signed-in set below runs instead");

  test("the export, this-device and push-mute routes need a session and a same-site POST", async ({ request, baseURL }) => {
    const exported = await request.get("/api/account/export");
    expect(exported.status()).toBe(401);
    expect(exported.headers()["cache-control"]).toContain("no-store");
    const post = (path: string, headers: Record<string, string>, data: unknown) => request.post(path, { headers, data });
    const body = { endpoint: ENDPOINT, slug: "jayton", muted: true };
    expect((await post("/api/account/push-mute", {}, body)).status()).toBe(403); // no Origin
    expect((await post("/api/account/push-mute", { origin: "https://evil.example.com" }, body)).status()).toBe(403);
    expect((await post("/api/account/push-mute", { origin: baseURL! }, { ...body, slug: "Not A Slug" })).status()).toBe(400);
    expect((await post("/api/account/push-mute", { origin: baseURL! }, body)).status()).toBe(401); // right origin, no session
    expect((await post("/api/account/this-device", { origin: baseURL! }, { endpoint: "http://not-https.example.com/x" })).status()).toBe(400);
    expect((await post("/api/account/this-device", { origin: baseURL! }, { endpoint: ENDPOINT })).status()).toBe(401);
  });

  test("signed out, /account sends you to sign-in", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  });
});

// ---- the stand-in for Supabase ------------------------------------------------------------------------------------------
type Device = { id: string; label: string; linked_at: string; last_used_at: string };
type Stub = {
  account: { display_name: string; joined_at: string; name_changed_at: string | null; next_name_change_at: string | null };
  rename: "ok" | "too_soon" | "taken" | "bad";
  renames: string[];
  follows: string[];
  optins: string[];
  eligible: boolean;
  devices: Device[];
  thisDeviceId: string | null;
  muted: string[];
  muteCalls: { p_slug: string; p_muted: boolean }[];
  removed: string[];
  failRemoveAll: boolean;
  activity: { kind: string; id: string; body_excerpt: string; created_at: string; href: string | null }[];
  calls: string[];
  saved: { kind: string; slugs: string[] }[];
};
const fresh = (): Stub => ({
  account: { display_name: "Bobcat Fan", joined_at: "2026-01-15T18:00:00Z", name_changed_at: null, next_name_change_at: null },
  rename: "ok",
  renames: [],
  follows: ["jayton", "guthrie"],
  optins: [],
  eligible: true,
  devices: [
    { id: D1, label: "Chrome on iPhone", linked_at: "2026-11-01T18:00:00Z", last_used_at: "2026-11-10T18:00:00Z" },
    { id: D2, label: "Safari on Mac", linked_at: "2026-10-01T18:00:00Z", last_used_at: "2026-10-05T18:00:00Z" },
  ],
  thisDeviceId: null,
  muted: [],
  muteCalls: [],
  removed: [],
  failRemoveAll: false,
  activity: [
    { kind: "comment", id: "a1", body_excerpt: "Great game last night", created_at: "2026-11-08T18:00:00Z", href: "/scores/2026-11-07-jayton-at-guthrie" },
    { kind: "score_report", id: "a2", body_excerpt: "Reported 42 to 14", created_at: "2026-11-07T18:00:00Z", href: null },
  ],
  calls: [],
  saved: [],
});
const stub: Stub = fresh();
let server: Server | undefined;

const jwt = () => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: USER, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
};
const user = { id: USER, aud: "authenticated", role: "authenticated", email: EMAIL, app_metadata: { provider: "google", providers: ["google"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

/** What export_my_data answers (migration 0026): everything but the email and providers, which the route adds from Auth. */
const exportDoc = () => ({
  exported_at: "2026-11-15T12:00:00Z",
  account: { display_name: stub.account.display_name, joined_at: stub.account.joined_at, name_changed_at: stub.account.name_changed_at, birth_year: "Stored to check your age at sign-up and for email alerts. It is never shown to anyone and is not included in this file." },
  follows: stub.follows.map((program) => ({ program, followed_at: "2026-02-01T00:00:00Z" })),
  devices: stub.devices.map((d) => ({ label: d.label, linked_at: d.linked_at, last_used_at: d.last_used_at, muted_teams: stub.muted })),
  email_settings: stub.optins.map((team) => ({ kind: "game_alerts", team, since: "2026-03-01T00:00:00Z" })),
  comments: [{ game: "2026-11-07-jayton-at-guthrie", text: "Great game last night", posted_at: "2026-11-08T18:00:00Z", edited_at: null, hidden: false }],
  forum_threads: [],
  forum_replies: [],
  score_reports: [{ game: "2026-11-07-jayton-at-guthrie", home_score: 42, away_score: 14, reported_at: "2026-11-07T18:00:00Z" }],
});

/** A stand-in for the browser's push machinery (no service worker runs here): one subscription, with the endpoint the stub knows. */
const fakePush = (page: Page, subscribed = true) =>
  page.addInitScript(
    ({ endpoint, subscribed }) => {
      let sub: object | null = subscribed
        ? { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }), unsubscribe: async () => ((sub = null), true) }
        : null;
      const registration = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
      Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => ({}), ready: Promise.resolve(registration), getRegistration: async () => registration } });
      Object.defineProperty(window, "Notification", { value: { permission: "granted", requestPermission: async () => "granted" } });
    },
    { endpoint: ENDPOINT, subscribed },
  );

/** Wait until the page's own script has finished asking about this browser and the team names have come (so axe sees the settled page). */
const settled = async (page: Page) => {
  await expect(page.getByRole("link", { name: "Jayton" }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Push alerts are (on|off) in this browser\.|This browser cannot show push alerts/).first()).toBeVisible({ timeout: 20_000 });
};

test.describe("with a signed-in fan (a stand-in for Supabase)", () => {
  test.skip(!STUB_PORT || !FAN_ON || process.env.EMAIL_ALERTS !== "on", "needs the stub server and the settings in this file's header");
  test.setTimeout(60_000); // a production build answering a signed-in page, a script that asks twice, and reloads

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = req.url ?? "";
        const json = (v: unknown, status = 200) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(v)));
        const none = () => (res.writeHead(204), res.end());
        const args = body ? JSON.parse(body) : {};
        if (url.startsWith("/auth/v1/user")) return json(user);
        if (url.startsWith("/auth/v1/logout")) return (stub.calls.push(`logout:${new URL(url, "http://stub").searchParams.get("scope")}`), none());
        const rpc = /\/rest\/v1\/rpc\/(\w+)/.exec(url)?.[1];
        if (!rpc) return (res.writeHead(404), res.end());
        stub.calls.push(rpc);
        switch (rpc) {
          case "my_profile":
            return json([{ display_name: stub.account.display_name, created_at: stub.account.joined_at, muted_until: null, banned: false }]);
          case "my_account":
            return json([stub.account]);
          case "my_follows":
            return json(stub.follows.map((program_slug) => ({ program_slug, created_at: "2026-02-01T00:00:00Z" })));
          case "unfollow_program":
            return ((stub.follows = stub.follows.filter((s) => s !== args.p_slug)), none());
          case "email_my_settings": {
            const rows = stub.optins.map((program_slug) => ({ eligible: stub.eligible, kind: "game_alerts", program_slug }));
            return json(rows.length ? rows : [{ eligible: stub.eligible, kind: null, program_slug: null }]);
          }
          case "email_set_optins":
            return (stub.saved.push({ kind: args.p_kind, slugs: args.p_slugs }), args.p_kind === "game_alerts" && (stub.optins = args.p_slugs), none());
          case "change_display_name":
            stub.renames.push(args.p_name);
            if (stub.rename === "too_soon") return json({ code: "55000", message: "change_display_name: name_too_soon", details: "2026-12-14 18:00:00.123456+00", hint: null }, 400);
            if (stub.rename === "taken") return json({ code: "23505", message: "change_display_name: name_taken", details: null, hint: null }, 409);
            if (stub.rename === "bad") return json({ code: "23514", message: "change_display_name: name_reserved", details: null, hint: null }, 400);
            stub.account = { ...stub.account, display_name: args.p_name, name_changed_at: "2026-11-15T12:00:00Z", next_name_change_at: "2026-12-15T12:00:00Z" };
            return json("2026-12-15T12:00:00+00:00");
          case "my_devices":
            return json(stub.devices);
          case "this_device":
            return json(args.p_endpoint === ENDPOINT ? stub.thisDeviceId : null);
          case "my_push_mutes":
            return json(args.p_endpoint === ENDPOINT && stub.thisDeviceId ? stub.muted : []);
          case "set_push_mute":
            stub.muteCalls.push({ p_slug: args.p_slug, p_muted: args.p_muted });
            stub.muted = args.p_muted ? [...new Set([...stub.muted, args.p_slug])] : stub.muted.filter((s) => s !== args.p_slug);
            return json(stub.muted);
          case "remove_my_device":
            stub.removed.push(args.p_id);
            stub.devices = stub.devices.filter((d) => d.id !== args.p_id);
            if (args.p_id === stub.thisDeviceId) stub.thisDeviceId = null;
            return none();
          case "remove_all_my_devices": {
            if (stub.failRemoveAll) return json({ code: "XX000", message: "boom", details: null, hint: null }, 500);
            const n = stub.devices.length;
            stub.devices = [];
            return json(n);
          }
          case "export_my_data":
            return json(exportDoc());
          case "my_activity":
            return json(stub.activity);
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

  test("every section renders with its heading, in order, with no skipped heading level, and passes axe", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await settled(page);
    // My activity sits second while posts are on (right after Profile), and is absent while they are off.
    const sections = [
      ["profile", "Profile"],
      ...(POSTS ? [["activity", "My activity"]] : []),
      ["teams", "My teams"],
      ["alerts", "Alerts and devices"],
      ["security", "Sign-in and security"],
      ["data", "Privacy and data"],
    ];
    const titles = sections.map(([, title]) => title);
    await expect(page.locator("main").getByRole("heading", { level: 2 })).toHaveText(titles);
    const nav = page.getByRole("navigation", { name: "Account sections" });
    await expect(nav.getByRole("link")).toHaveText(titles);
    for (const [i, [id]] of sections.entries()) await expect(nav.getByRole("link").nth(i)).toHaveAttribute("href", `#${id}`);
    // No heading level is skipped: each heading is at most one level below the one before it.
    const levels = await page.locator("main h1, main h2, main h3, main h4").evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => i > 0 && expect(level, `heading ${i}`).toBeLessThanOrEqual(levels[i - 1] + 1));

    // Profile: the name and date joined; the own email only under Sign-in and security; never a birth year.
    const profile = page.locator("#profile");
    await expect(profile).toContainText("Bobcat Fan");
    await expect(profile).toContainText("January 15, 2026");
    await expect(profile.getByLabel("Change display name")).toBeEnabled();
    const security = page.locator("#security");
    await expect(security).toContainText(EMAIL);
    await expect(security).toContainText("Google");
    await expect(security.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(security.getByRole("button", { name: "Sign out of all devices" })).toBeVisible();
    const data = page.locator("#data");
    await expect(data.getByRole("link", { name: "Download my data" })).toHaveAttribute("href", "/api/account/export");
    await expect(data.getByRole("link", { name: "Download my data" })).toHaveAttribute("download", "txsixmanfootball-my-data.json");
    await expect(data.getByRole("button", { name: "Delete my account" })).toBeVisible();
    await expect(data).toContainText("linked browsers, email alert settings and sign-in");
    await expect(data.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(data.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    // My teams: each followed team with its page and Unfollow.
    await expect(page.locator("#teams").getByRole("link", { name: "Jayton" })).toHaveAttribute("href", "/programs/jayton");
    await expect(page.locator("#teams").getByRole("button", { name: "Unfollow Jayton" })).toBeVisible();
    // Alerts and devices: this browser, the linked browsers (labels only), the email block.
    await expect(page.locator("#alerts").getByRole("listitem").filter({ hasText: "Chrome on iPhone" })).toContainText("Linked November 1, 2026");
    await expect(page.locator("#alerts").getByRole("listitem").filter({ hasText: "Chrome on iPhone" })).toContainText("Last used November 10, 2026");
    await expect(page.getByRole("region", { name: "Email alerts" })).toBeVisible();

    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);

    const main = await page.locator("main").innerText();
    expect(main).not.toMatch(BETTING);
    expect(main).not.toMatch(/birth/i);
    expect(main).not.toMatch(BIRTH_YEAR);
    expect(main.split(EMAIL)).toHaveLength(2); // the email appears once
    expect(await page.content()).not.toContain(ENDPOINT);
    // No sideways scroll on a phone, signed in. This is the only place the header's account link is checked with a name in it:
    // its screen-reader label is absolutely positioned and escaped the nav's scroll strip until the nav was made `relative`.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });

  test("the nav anchors scroll to their sections; sticky from the md breakpoint, a plain jump list on a phone", async ({ page }) => {
    await page.goto("/account");
    await settled(page);
    const nav = page.getByRole("navigation", { name: "Account sections" });
    const wide = (page.viewportSize()?.width ?? 0) >= 768;
    expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe(wide ? "sticky" : "static");
    for (const [name, id] of [["My teams", "teams"], ["Alerts and devices", "alerts"], ["Sign-in and security", "security"], ["Privacy and data", "data"], ["Profile", "profile"]] as const) {
      await nav.getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`/account#${id}$`));
      await expect(page.locator(`#${id}-title`)).toBeInViewport();
    }
    // Every link is a comfortable tap target.
    for (const link of await nav.getByRole("link").all()) expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });

  test("a name changed in the last 30 days disables the form and says when it opens", async ({ page }) => {
    stub.account.name_changed_at = "2026-11-14T18:00:00Z";
    stub.account.next_name_change_at = "2026-12-14T18:00:00Z";
    await page.goto("/account");
    const profile = page.locator("#profile");
    await expect(profile.getByText("You can change it again on December 14, 2026.")).toBeVisible();
    await expect(profile.getByLabel("Change display name")).toBeDisabled();
    await expect(profile.getByRole("button", { name: "Save display name" })).toBeDisabled();
  });

  test("a rename the database refuses for the clock shows the date; a taken or reserved name shows its own message; a good one saves", async ({ page }) => {
    await page.goto("/account");
    const profile = page.locator("#profile");
    const field = profile.getByLabel("Change display name");
    await expect(profile.getByRole("button", { name: "Save display name" })).toBeDisabled(); // nothing changed yet

    stub.rename = "too_soon"; // the 30-day rule, raised by the database as 55000 with the date in DETAIL
    await field.fill("Another Name");
    await profile.getByRole("button", { name: "Save display name" }).click();
    await expect(profile.getByText("You can change it again on December 14, 2026.")).toBeVisible();
    await expect(field).toBeDisabled();

    await page.reload(); // the page's own copy still allows a change (the stub's clock row did not move)
    stub.rename = "taken";
    await field.fill("Taken Name");
    await profile.getByRole("button", { name: "Save display name" }).click();
    await expect(profile.getByText("That name is taken. Pick another.")).toBeVisible();
    stub.rename = "bad";
    await profile.getByRole("button", { name: "Save display name" }).click();
    await expect(profile.getByText("Pick a different name. That one is reserved.")).toBeVisible();
    expect(stub.renames).toEqual(["Another Name", "Taken Name", "Taken Name"]);

    stub.rename = "ok";
    await field.fill("Bobcat Two");
    await profile.getByRole("button", { name: "Save display name" }).click();
    await expect(profile.getByText("Saved.")).toBeVisible();
    await expect(profile.getByText("You can change it again on December 15, 2026.")).toBeVisible();
    await expect(profile.locator("dd").first()).toHaveText("Bobcat Two"); // the page re-read the account
    expect(stub.renames.at(-1)).toBe("Bobcat Two");
  });

  test("sign out of all devices asks first, removes every device, then signs out everywhere, then lands on the home page", async ({ page }) => {
    await page.goto("/account");
    const security = page.locator("#security");
    await security.getByRole("button", { name: "Sign out of all devices" }).click();
    await expect(security.getByText("Sign out of every device?")).toBeVisible();
    expect(stub.calls).not.toContain("remove_all_my_devices"); // asking changed nothing
    await security.getByRole("button", { name: "Yes, sign out everywhere" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    expect(stub.calls.filter((c) => c === "remove_all_my_devices" || c.startsWith("logout"))).toEqual(["remove_all_my_devices", "logout:global"]);
    expect(stub.devices).toEqual([]);
  });

  test("if the devices cannot be removed, nothing is signed out and the person is told", async ({ page }) => {
    stub.failRemoveAll = true;
    await page.goto("/account");
    const security = page.locator("#security");
    await security.getByRole("button", { name: "Sign out of all devices" }).click();
    await security.getByRole("button", { name: "Yes, sign out everywhere" }).click();
    await expect(security.getByText("Could not sign you out of every device right now.")).toBeVisible();
    await expect(page).toHaveURL(/\/account$/);
    expect(stub.calls.filter((c) => c.startsWith("logout"))).toEqual([]);
  });

  test("download my data: an attachment, never cached, with the profile, follows, devices, email settings and posts, and no birth year, endpoint or token", async ({ page }) => {
    stub.optins = ["jayton"];
    const res = await page.request.get("/api/account/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toBe('attachment; filename="txsixmanfootball-my-data.json"');
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["content-type"]).toContain("application/json");
    const text = await res.text();
    const doc = JSON.parse(text) as Record<string, unknown> & { account: Record<string, unknown> };
    for (const key of ["account", "follows", "devices", "email_settings", "comments", "forum_threads", "forum_replies", "score_reports"]) expect(doc, key).toHaveProperty(key);
    expect(doc.account).toMatchObject({ display_name: "Bobcat Fan", email: EMAIL, sign_in_providers: ["google"] });
    expect(doc.follows).toEqual([expect.objectContaining({ program: "jayton" }), expect.objectContaining({ program: "guthrie" })]);
    expect(doc.devices).toHaveLength(2);
    expect(doc.email_settings).toEqual([expect.objectContaining({ kind: "game_alerts", team: "jayton" })]);
    // The birth year is only a sentence saying it is kept and not included; no endpoint, key or token is in the file.
    expect(String(doc.account.birth_year)).toMatch(/not included in this file/);
    expect(String(doc.account.birth_year)).not.toMatch(/\d{4}/);
    expect(text).not.toMatch(/birthYear|birth_year":\s*\d/);
    expect(text).not.toMatch(/endpoint|p256dh|"auth"|token|fcm\.googleapis|https?:\/\//i);
    expect(text).not.toContain(ENDPOINT);
  });

  test("this browser: its push state, the devices list marks it, removing another device calls remove_my_device, and the row goes", async ({ page }) => {
    stub.thisDeviceId = D1;
    await fakePush(page);
    await page.goto("/account");
    const alerts = page.locator("#alerts");
    await expect(alerts.getByText("Push alerts are on in this browser.")).toBeVisible({ timeout: 20_000 });
    const mine = alerts.getByRole("listitem").filter({ hasText: "Chrome on iPhone" });
    const other = alerts.getByRole("listitem").filter({ hasText: "Safari on Mac" });
    await expect(mine).toContainText("This browser");
    await expect(other).not.toContainText("This browser");
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    expect(await page.content()).not.toContain(ENDPOINT); // the endpoint never reaches the page's markup

    await other.getByRole("button", { name: "Remove Safari on Mac" }).click();
    await expect(alerts.getByText("Removed Safari on Mac.")).toBeVisible();
    await expect(alerts.getByRole("listitem").filter({ hasText: "Safari on Mac" })).toHaveCount(0);
    expect(stub.removed).toEqual([D2]);
    await expect(mine).toBeVisible();
  });

  test("Turn off removes this browser's linked device, then the browser's own subscription", async ({ page }) => {
    stub.thisDeviceId = D1;
    await fakePush(page);
    await page.goto("/account");
    const alerts = page.locator("#alerts");
    await alerts.getByRole("button", { name: /Turn off push alerts here/ }).click();
    await expect(alerts.getByText("Push alerts are off in this browser.")).toBeVisible();
    expect(stub.removed).toEqual([D1]);
    await expect(alerts.getByRole("button", { name: /Turn on push alerts here/ })).toBeVisible();
    await expect(page.locator("#teams").getByRole("checkbox", { name: /Push alerts on this browser/ })).toHaveCount(0); // nothing to mute any more
  });

  test("per-team push: shown only for a browser linked to the account, it mutes one team here, and the choice is still there after a reload", async ({ page }) => {
    // A browser with a subscription that is not this account's: no push toggles.
    await fakePush(page);
    await page.goto("/account");
    await expect(page.getByText("Push alerts are off in this browser.").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#teams").getByRole("checkbox", { name: /Push alerts on this browser/ })).toHaveCount(0);

    stub.thisDeviceId = D1;
    await page.reload();
    const teams = page.locator("#teams");
    const jayton = teams.getByRole("checkbox", { name: "Push alerts on this browser for Jayton" });
    await expect(jayton).toBeChecked({ timeout: 20_000 });
    await expect(teams.getByRole("checkbox", { name: "Push alerts on this browser for Guthrie" })).toBeChecked();
    await jayton.uncheck();
    await expect(teams.getByText("Push alerts off for Jayton on this browser.")).toBeVisible();
    expect(stub.muteCalls).toEqual([{ p_slug: "jayton", p_muted: true }]);
    await expect(jayton).not.toBeChecked();
    await page.reload();
    await expect(teams.getByRole("checkbox", { name: "Push alerts on this browser for Jayton" })).not.toBeChecked({ timeout: 20_000 });
    await expect(teams.getByRole("checkbox", { name: "Push alerts on this browser for Guthrie" })).toBeChecked();
    await teams.getByRole("checkbox", { name: "Push alerts on this browser for Jayton" }).check();
    await expect.poll(() => stub.muteCalls.at(-1)).toEqual({ p_slug: "jayton", p_muted: false });
  });

  test("per-team email: starts off, saves at once for one team, and 'all the teams' covers every team", async ({ page }) => {
    await page.goto("/account");
    const teams = page.locator("#teams");
    const jayton = teams.getByRole("checkbox", { name: "Email alerts for Jayton" });
    await expect(jayton).toBeVisible({ timeout: 20_000 });
    await expect(teams.getByRole("checkbox", { checked: true })).toHaveCount(0); // never on by default
    await jayton.check();
    await expect(teams.getByText("Email alerts on for Jayton.")).toBeVisible();
    expect(stub.saved).toEqual([{ kind: "game_alerts", slugs: ["jayton"] }]);
    await expect(jayton).toBeChecked();

    const all = page.getByRole("region", { name: "Email alerts" }).getByRole("checkbox", { name: "All the teams I follow" });
    await all.check();
    await expect.poll(() => stub.saved.at(-1)).toEqual({ kind: "game_alerts", slugs: ["*"] });
    await expect(jayton).toBeDisabled(); // the page re-read the choice: every team is on, one by one has nothing to change
    await expect(teams.getByRole("checkbox", { name: "Email alerts for Guthrie" })).toBeChecked();
    await all.uncheck();
    await expect.poll(() => stub.saved.at(-1)).toEqual({ kind: "game_alerts", slugs: [] });
    await expect(jayton).toBeEnabled();
    await expect(teams.getByRole("checkbox", { checked: true })).toHaveCount(0);
  });

  test("an account that may not opt in, and one that follows no one, get a plain note and no email toggles", async ({ page }) => {
    stub.eligible = false;
    await page.goto("/account");
    await expect(page.locator("#teams")).toContainText("Email alerts are not available for this account.");
    await expect(page.locator("#teams").getByRole("checkbox", { name: /Email alerts/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Email alerts" })).toContainText("not available for this account");
    stub.eligible = true;
    stub.follows = [];
    await page.reload();
    await expect(page.locator("#teams")).toContainText("You are not following any teams yet.");
    await expect(page.getByRole("region", { name: "Email alerts" })).toContainText("Follow a team");
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  });

  test("Unfollow calls the account's unfollow and the team's row goes", async ({ page }) => {
    await page.goto("/account");
    const teams = page.locator("#teams");
    await teams.getByRole("button", { name: "Unfollow Jayton" }).click();
    await expect(teams.getByText("Unfollowed Jayton.")).toBeVisible();
    await expect(teams.getByRole("link", { name: "Jayton" })).toHaveCount(0);
    await expect(teams.getByRole("link", { name: "Guthrie" })).toBeVisible();
    expect(stub.follows).toEqual(["guthrie"]);
  });

  test("My activity is there while posts are on, with a link where the post has a page, and absent (and never asked for) while posts are off", async ({ page }) => {
    await page.goto("/account");
    await settled(page);
    const nav = page.getByRole("navigation", { name: "Account sections" });
    if (!POSTS) {
      await expect(page.locator("#activity")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2, name: "My activity" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "My activity" })).toHaveCount(0);
      expect(stub.calls).not.toContain("my_activity");
      return;
    }
    const activity = page.locator("#activity");
    await expect(page.getByRole("heading", { level: 2, name: "My activity" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "My activity" })).toHaveAttribute("href", "#activity");
    await expect(activity).toContainText("Comment");
    await expect(activity).toContainText("November 8, 2026");
    await expect(activity.getByRole("link", { name: "Great game last night" })).toHaveAttribute("href", "/scores/2026-11-07-jayton-at-guthrie");
    await expect(activity).toContainText("Reported 42 to 14");
    await expect(activity.getByRole("link", { name: "Reported 42 to 14" })).toHaveCount(0); // its game has no page: no link
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  });
});
