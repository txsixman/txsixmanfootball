import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Fan accounts (ADR 0018). FAN_SIGNIN decides what the server does, so the tests come in two sets: with it unset (the
// default, and CI) fan accounts are off and the site is as it was; with FAN_SIGNIN=on on the server under test they are on:
//   E2E_PORT=3072 FAN_SIGNIN=on apps/web/node_modules/.bin/playwright test -c apps/web/playwright.config.ts e2e/accounts.spec.ts
// The browser-side tests answer /api/me with a stub, so they run either way. No Supabase project is configured here, so
// every real call to the account routes answers as "signed out".
const ON = process.env.FAN_SIGNIN === "on";
const me = (answer: { displayName: string | null; follows: string[]; admin?: boolean } | null) => ({ enabled: true, me: answer });

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
const BETTING = /\b(spread|spreads|odds|betting|wager|parlay)\b/i;

test.describe("fan accounts off (FAN_SIGNIN unset: the default)", () => {
  test.skip(ON, "FAN_SIGNIN=on on this server");

  test("/account and /account/welcome go nowhere, and /sign-in is only the existing-account email form", async ({ page }) => {
    for (const path of ["/account", "/account/welcome"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    }
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/13|birth year|display name|terms|privacy|new here|account/i);
    await expect(page.getByRole("link", { name: /^(Privacy|Terms)$/ })).toHaveCount(0);
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  });

  test("the header has no Sign in link and the Follow button offers no sign-in", async ({ page }) => {
    const asked = page.waitForResponse((r) => r.url().endsWith("/api/me"), { timeout: 20_000 });
    await page.goto("/programs/jayton");
    expect(await (await asked).json()).toEqual({ enabled: false, me: null });
    await page.waitForTimeout(500);
    await expect(page.getByRole("link", { name: /Sign in/ })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" })).toHaveCount(0);
  });

  test("the privacy, terms and under-13 pages do not exist while fan accounts are off", async ({ request }) => {
    for (const path of ["/privacy", "/terms", "/account/too-young"]) expect((await request.get(path)).status(), path).toBe(404);
  });

  test("the account routes answer null and 404 without asking anyone", async ({ request, baseURL }) => {
    const answer = await request.get("/api/me");
    expect(await answer.json()).toEqual({ enabled: false, me: null });
    // From an admin page the route still answers (with no session cookie, still nobody).
    const fromAdmin = await request.get("/api/me", { headers: { referer: `${baseURL}/admin` } });
    expect(await fromAdmin.json()).toEqual({ enabled: false, me: null });
    const write = await request.post("/api/follows", { headers: { origin: baseURL! }, data: { op: "follow", slug: "jayton" } });
    expect(write.status()).toBe(404);
  });
});

test.describe("fan accounts on (FAN_SIGNIN=on)", () => {
  test.skip(!ON, "run against a server started with FAN_SIGNIN=on");

  test("signed out, /account and /account/welcome send you to sign-in", async ({ page }) => {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await page.goto("/account/welcome");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fwelcome$/);
  });

  test("the sign-in page offers Google, and the email link to existing accounts only until FAN_EMAIL_SIGNIN is on; links the terms; passes axe", async ({ page }) => {
    await page.goto("/sign-in");
    // No Supabase project is configured in tests, so the Google button (which needs one) is absent; its server action is covered by unit tests.
    const summary = page.getByText("I already have an account: email me a link");
    await expect(summary).toBeVisible();
    await expect(page.getByLabel("Email")).toBeHidden();
    await summary.click();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(page.getByText("You must be 13 or older.")).toBeVisible();
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  });

  test("signed out, the header says Sign in, and a program page nudges to sign in", async ({ page }) => {
    await page.goto("/programs/jayton");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    await expect(page.getByRole("link", { name: "Sign in to follow on every device" })).toBeVisible();
  });

  test("the follow route refuses a foreign or malformed write, and a signed-out one", async ({ request, baseURL }) => {
    const answer = await request.get("/api/me");
    expect(await answer.json()).toEqual({ enabled: true, me: null });
    expect(answer.headers()["cache-control"]).toContain("no-store");
    const post = (headers: Record<string, string>, data: unknown) => request.post("/api/follows", { headers, data });
    expect((await post({}, { op: "follow", slug: "jayton" })).status()).toBe(403); // no Origin
    expect((await post({ origin: "https://evil.example.com" }, { op: "follow", slug: "jayton" })).status()).toBe(403);
    expect((await post({ origin: baseURL! }, { op: "follow", slug: "Not A Slug" })).status()).toBe(400);
    expect((await post({ origin: baseURL! }, { op: "import", slugs: Array.from({ length: 101 }, (_, i) => `s${i}`) })).status()).toBe(400);
    expect((await post({ origin: baseURL! }, { op: "follow", slug: "jayton" })).status()).toBe(401); // right origin, no session
    expect((await request.post("/api/follows", { headers: { origin: baseURL!, "content-type": "text/plain" }, data: "x" })).status()).toBe(415);
  });
});

test("the under-13 page is plain and passes axe", async ({ page }) => {
  test.skip(!ON, "with accounts off the page does not exist (see the off set)");
  await page.goto("/account/too-young");
  await expect(page.getByRole("heading", { level: 1, name: "You must be 13 or older" })).toBeVisible();
  await expect(page.getByText("Nothing about you was kept")).toBeVisible();
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
});

for (const [path, heading] of [["/privacy", "Privacy"], ["/terms", "Terms"]] as const) {
  test(`${path} renders, says what it must, names no data source, and passes axe`, async ({ page }, info) => {
    test.skip(!ON, "with accounts off the page does not exist (see the off set)");
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).toContain("DMCA agent registration pending; send notices to contact@txsixmanfootball.com");
    await expect(page.getByRole("link", { name: "contact@txsixmanfootball.com" }).first()).toHaveAttribute("href", "mailto:contact@txsixmanfootball.com");
    expect(text).toContain("13 or older");
    expect(text).toMatch(/three different members/i);
    expect(text).not.toMatch(BETTING);
    expect(text.replaceAll("contact@txsixmanfootball.com", "")).not.toMatch(/maxpreps|sixmanfootball|calpreps|hudl/i); // (this site's own address is not a source)
    if (path === "/privacy") {
      for (const part of ["Your email address", "A display name", "Your birth year", "The teams you follow", "What you post", "Push alerts", "There are\n?\\s*no ads"]) {
        expect(text).toMatch(new RegExp(part.replace(/ /g, "\\s+"), "i"));
      }
      expect(text).toMatch(/under 13[\s\S]*deleted/i);
      expect(text).toMatch(/delete your account/i);
      expect(text).toMatch(/under 18 goes to any third party/);
    }
    expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      short: [...document.querySelectorAll("main a")].filter((el) => el.getBoundingClientRect().height < 44 && getComputedStyle(el).display !== "inline").length,
    }));
    expect(m).toEqual({ overflow: 0, short: 0 });
    void info;
  });
}

// A stand-in for the browser's push machinery: no service worker runs under the dev server.
const fakePush = (page: Page) =>
  page.addInitScript(() => {
    let sub: object | null = null;
    const fake = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }),
      unsubscribe: async () => ((sub = null), true),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => sub, subscribe: async () => (sub = fake) } }) },
    });
    Object.defineProperty(window, "Notification", { value: { permission: "granted", requestPermission: async () => "granted" } });
  });

const stubRpc = (page: Page, calls: string[] = []) =>
  page.route("https://vhgnaihnyjdnaaergtcl.supabase.co/rest/v1/rpc/*", (route) => {
    calls.push(new URL(route.request().url()).pathname.split("/").pop()!);
    return route.fulfill({ status: 204, body: "" });
  });

test("an odd error value on the sign-in page does not break it", async ({ request }) => {
  for (const value of ["__proto__", "constructor", "toString", "link", "unavailable", "zzz"]) {
    expect((await request.get(`/sign-in?error=${value}`)).status(), value).toBe(200);
  }
  expect((await request.get("/sign-in?error=a&error=b")).status()).toBe(200);
});

test("the header asks who is signed in again after a client-side navigation, so it follows a sign-in or sign-out", async ({ page }) => {
  let asked = 0;
  // Signed out on the home page; the same browser is signed in by the time it is on /rankings.
  await page.route("**/api/me", (route) => {
    asked += 1;
    return route.fulfill({ json: page.url().includes("/rankings") ? me({ displayName: "Bobcat Fan", follows: [] }) : me(null) });
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Sign in" })).toBeVisible({ timeout: 20_000 });
  await nav.getByRole("link", { name: "Rankings" }).click();
  await expect(nav.getByRole("link", { name: /Bobcat Fan/ })).toBeVisible({ timeout: 20_000 });
  expect(asked).toBeGreaterThanOrEqual(2);
});

test("signed out, the Follow button still follows and unfollows on this browser", async ({ page }) => {
  const calls: string[] = [];
  await fakePush(page);
  await stubRpc(page, calls);
  await page.goto("/programs/jayton");
  const button = page.getByRole("button", { name: "Alert me to Jayton finals" });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  const nudge = page.getByRole("link", { name: "Sign in to follow on every device" });
  if (ON) await expect(nudge).toHaveAttribute("href", "/sign-in?next=%2Fprograms%2Fjayton");
  else await expect(nudge).toHaveCount(0); // accounts off: the button is as it always was
  await button.click();
  await expect(page.getByRole("button", { name: "Stop alerts" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Alerts on" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("followed-programs") ?? "[]"))).toEqual(["jayton"]);
  await page.getByRole("button", { name: "Stop alerts" }).click();
  await expect(page.getByRole("button", { name: "Alert me to Jayton finals" })).toBeEnabled(); // not the busy moment in between
  await expect(page.getByRole("status").filter({ hasText: "Alerts off" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("followed-programs") ?? "[]"))).toEqual([]);
  expect(calls).toEqual(["push_follow", "push_unfollow"]);
});

test("signed in, the header shows the display name and the Follow button follows on the account as well", async ({ page }) => {
  const writes: unknown[] = [];
  await fakePush(page);
  await stubRpc(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: me({ displayName: "Bobcat Fan", follows: [] }) }));
  await page.route("**/api/follows", (route) => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { follows: ["jayton"] } });
  });
  await page.goto("/programs/jayton");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Bobcat Fan/ })).toHaveAttribute("href", "/account");
  const button = page.getByRole("button", { name: "Follow Jayton", exact: true });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect(page.getByRole("button", { name: "Unfollow Jayton" })).toBeVisible();
  expect(writes).toEqual([{ op: "follow", slug: "jayton" }]);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
});

test("signed in with no push support, Follow still follows on the account", async ({ page }) => {
  const writes: unknown[] = [];
  await page.addInitScript(() => Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true }));
  await page.route("**/api/me", (route) => route.fulfill({ json: me({ displayName: "Bobcat Fan", follows: [] }) }));
  await page.route("**/api/follows", (route) => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { follows: ["jayton"] } });
  });
  await page.goto("/programs/jayton");
  const button = page.getByRole("button", { name: "Follow Jayton", exact: true });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect(page.getByRole("button", { name: "Unfollow Jayton" })).toBeVisible();
  expect(writes).toEqual([{ op: "follow", slug: "jayton" }]);
});

test("signed in, My teams shows the account's follows, not this browser's", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("followed-programs", JSON.stringify(["fort-bend-chargers"])));
  await page.route("**/api/me", (route) => route.fulfill({ json: me({ displayName: "Bobcat Fan", follows: ["jayton"] }) }));
  await page.goto("/");
  const block = page.getByRole("region", { name: "My teams" });
  await expect(block.getByRole("link", { name: /^Jayton/ })).toBeVisible({ timeout: 20_000 });
  await expect(block.getByRole("listitem")).toHaveCount(1);
  await expect(block.getByRole("link", { name: /Fort Bend/ })).toHaveCount(0);
});

test("a signed-in fan who has not finished sign-up is sent to the sign-up step from a public page", async ({ page }) => {
  test.skip(!ON, "with accounts off the sign-up page sends everyone home, so there is nothing to follow");
  await page.route("**/api/me", (route) => route.fulfill({ json: me({ displayName: null, follows: [] }) }));
  const sent = page.waitForRequest((r) => r.url().includes("/account/welcome"), { timeout: 20_000 });
  await page.goto("/rankings");
  await sent;
  // (With no session behind the stub, the real page sends them on: to sign-in when accounts are on, home when off.)
});
