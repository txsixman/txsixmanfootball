import { expect, test } from "@playwright/test";

// The admin console and sign-in, signed out. Without Supabase settings (CI) /admin says "Admin is not configured"; with
// them it says "Sign in". Either way a visitor sees no game, no search and no data, nothing is cached or indexed, and a
// cookie made up by hand does not get in. (A real session needs the owner's account: the setup steps are in docs/admin-console.md.)

const ADMIN_PAGES = ["/admin", "/admin/merge", "/admin/corrections", "/admin/moderation", "/admin/games/2026-09-04-guthrie-at-jayton"];
const NO_DATA = /Find a game|Past corrections|Merge programs|Moderation|Hidden posts|Sign out|2026-09-04/;

test("signed out, /admin shows sign-in or 'not configured', and none of the console", async ({ page }) => {
  for (const url of ADMIN_PAGES) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }), url).toHaveText(/^(Admin is not configured|Admin)$/i);
    await expect(page.locator("body"), url).not.toContainText(NO_DATA);
    await expect(page.getByLabel("Team")).toHaveCount(0);
    await expect(page.locator("form"), url).toHaveCount(0);
    expect(await page.locator("meta[name=robots]").getAttribute("content")).toMatch(/noindex/);
  }
});

test("admin, sign-in and auth responses are never cached or indexed", async ({ request }) => {
  for (const url of [...ADMIN_PAGES, "/sign-in", "/auth/callback", "/auth/callback?code=forged"]) {
    const res = await request.get(url, { maxRedirects: 0 });
    const cache = res.headers()["cache-control"] ?? "";
    expect(cache, url).toMatch(/no-store/);
    // Pages get Next's own dynamic header (production: "private, no-cache, no-store, max-age=0, must-revalidate"; the dev
    // server sends less); the callback is a route handler of ours and says "private" itself.
    if (url.startsWith("/auth/")) expect(cache, url).toMatch(/private/);
    expect(res.headers()["x-robots-tag"], url).toMatch(/noindex/);
    expect(res.headers()["cache-control"], url).not.toMatch(/public|s-maxage|max-age=[1-9]/);
  }
});

test("a session cookie made up by hand gets nowhere", async ({ page, context }) => {
  // A Supabase session cookie, forged: a JWT-shaped token naming a user id nobody signed.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated", exp: 4102444800, aud: "authenticated" })}.forged`;
  const session = `base64-${b64({ access_token: jwt, refresh_token: "forged", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated" } })}`;
  const url = new URL(page.url() === "about:blank" ? "http://localhost" : page.url());
  await context.addCookies(
    ["sb-abcdefghijklmnopqrst-auth-token", "sb-localhost-auth-token", "sb-127-auth-token"].map((name) => ({ name, value: session, domain: url.hostname, path: "/" })),
  );
  for (const target of ADMIN_PAGES) {
    await page.goto(target);
    await expect(page.getByRole("heading", { level: 1 }), target).toHaveText(/^(Admin is not configured|Admin|Not allowed)$/i);
    await expect(page.locator("body"), target).not.toContainText(NO_DATA);
  }
});

test("a server action cannot be driven without the admin: no cookie, no write", async ({ request }) => {
  // Posting to the page with a server-action header and no session changes nothing and shows nothing.
  const res = await request.post("/admin", { headers: { "Next-Action": "00".repeat(20), "Content-Type": "text/plain;charset=UTF-8" }, data: "[]", maxRedirects: 0 });
  expect(res.status()).toBeLessThan(500);
  expect(await res.text()).not.toMatch(/Find a game|github|supabase/i);
});

test("the auth callback with no valid code goes to sign-in with a plain error, and sets no cookie", async ({ request }) => {
  for (const url of ["/auth/callback", "/auth/callback?code=forged", "/auth/callback?error=access_denied&code=x"]) {
    const res = await request.get(url, { maxRedirects: 0 });
    expect([302, 303, 307, 308], url).toContain(res.status());
    expect(res.headers().location, url).toMatch(/\/sign-in\?error=link$/);
    expect(res.headers()["set-cookie"] ?? "", url).not.toMatch(/sb-.*auth-token=[^;]/);
  }
});

test("sign-in offers an emailed link, no password and no account creation", async ({ page }) => {
  await page.goto("/sign-in?next=//evil.test");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign-in link/i })).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  await expect(page.getByText(/sign up|create account|register/i)).toHaveCount(0);
  // A crafted `next` never survives: the hidden field holds a local path only.
  await expect(page.locator("input[name=next]")).toHaveValue("/");
  expect(await page.locator("meta[name=robots]").getAttribute("content")).toMatch(/noindex/);
});

test("no public page links to the admin console or its sign-in", async ({ page }) => {
  for (const url of ["/", "/scores", "/programs", "/rankings"]) {
    await page.goto(url);
    await expect(page.locator("a[href^='/admin'], a[href^='/sign-in'], a[href^='/auth']"), url).toHaveCount(0);
  }
});
