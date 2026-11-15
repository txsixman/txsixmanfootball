import { expect, test, type Page } from "@playwright/test";

// Push alerts tied to the account (ADR 0054, migration 0023): signed in, this browser's push subscription is linked to the
// account through /api/push/link, so the account's follows drive its alerts. Signed out, the Follow button is as it was.
// Browser side only: /api/me, /api/follows and /api/push/link answer with stubs (as e2e/accounts.spec.ts does), so these
// run with accounts on or off, and no Supabase project is called.
test.use({ serviceWorkers: "block" });

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/e2e-endpoint";
const me = (follows: string[]) => ({ enabled: true, me: { displayName: "Bobcat Fan", follows } });

/** A stand-in for the browser's push machinery (no service worker runs under the dev server). */
const fakePush = (page: Page, { permission = "granted", subscribed = true } = {}) =>
  page.addInitScript(
    ({ permission, subscribed, endpoint }) => {
      const fake = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }), unsubscribe: async () => true };
      let sub: object | null = subscribed ? fake : null;
      const registration = { pushManager: { getSubscription: async () => sub, subscribe: async () => (sub = fake) } };
      Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => ({}), ready: Promise.resolve(registration), getRegistration: async () => registration } });
      Object.defineProperty(window, "Notification", { value: { permission, requestPermission: async () => permission } });
    },
    { permission, subscribed, endpoint: ENDPOINT },
  );

/** Every request that matters, in order, as "link" and "follows:<op>"; the link answers with `left` (what stays on this browser). */
async function stubAccount(page: Page, { follows = [] as string[], left = [] as string[], linkStatus = 200 } = {}) {
  const log: string[] = [];
  const linked: unknown[] = [];
  await page.route("**/api/me", (route) => route.fulfill({ json: me(follows) }));
  await page.route("**/api/push/link", (route) => {
    log.push("link");
    linked.push(route.request().postDataJSON());
    return route.fulfill({ status: linkStatus, json: linkStatus === 200 ? { programs: left } : { error: "unavailable" } });
  });
  await page.route("**/api/follows", (route) => {
    const body = route.request().postDataJSON() as { op: string };
    log.push(`follows:${body.op}`);
    return route.fulfill({ json: { follows: body.op === "follow" ? ["jayton"] : [] } });
  });
  // Anything that reaches Supabase directly (the signed-out calls, live scores) is stubbed away.
  await page.route("https://vhgnaihnyjdnaaergtcl.supabase.co/rest/v1/rpc/*", (route) => {
    log.push(`rpc:${new URL(route.request().url()).pathname.split("/").pop()}`);
    return route.fulfill({ status: 200, json: [] });
  });
  return { log: () => log.filter((l) => l !== "rpc:live_scores"), linked };
}

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("followed-programs") ?? "[]"));

test("a signed-in browser that already has push alerts is linked to the account once per visit, without asking anything", async ({ page }) => {
  await fakePush(page);
  const account = await stubAccount(page);
  await page.goto("/programs/jayton");
  await expect(page.getByRole("button", { name: "Follow Jayton", exact: true })).toBeEnabled({ timeout: 20_000 });
  await expect.poll(() => account.log()).toEqual(["link"]);
  expect(account.linked).toEqual([{ endpoint: ENDPOINT, p256dh: "B".repeat(87), auth: "a".repeat(22) }]);
  await page.goto("/programs/guthrie"); // the same tab: once is enough
  await expect(page.getByRole("button", { name: /^(Follow|Unfollow) Guthrie/ })).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(account.log()).toEqual(["link"]);
});

test("signed in, Follow links this browser first, then follows on the account; the alert note says so", async ({ page }) => {
  await fakePush(page, { subscribed: false }); // no subscription yet: following makes one
  const account = await stubAccount(page);
  await page.goto("/programs/jayton");
  const button = page.getByRole("button", { name: "Follow Jayton", exact: true });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect(page.getByRole("button", { name: "Unfollow Jayton" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "alerts on this browser" })).toBeVisible();
  expect(account.log()).toEqual(["link", "follows:follow"]);
  expect(account.linked).toEqual([{ endpoint: ENDPOINT, p256dh: "B".repeat(87), auth: "a".repeat(22) }]);
});

test("signed in, Unfollow links first (the browser's own list moves onto the account), then unfollows, and the browser forgets it", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("followed-programs", JSON.stringify(["jayton", "strawn"])));
  await fakePush(page);
  const account = await stubAccount(page, { follows: ["jayton"], left: ["strawn"] });
  await page.goto("/programs/jayton");
  const button = page.getByRole("button", { name: "Unfollow Jayton" });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await expect.poll(() => account.log()).toEqual(["link"]); // the visit's own link
  await button.click();
  await expect(page.getByRole("button", { name: "Follow Jayton", exact: true })).toBeEnabled();
  expect(account.log()).toEqual(["link", "link", "follows:unfollow"]);
  // The server kept strawn on this browser's own list (the account was full), and jayton is gone from it.
  expect(await stored(page)).toEqual(["strawn"]);
});

test("signed in with notifications blocked, Follow still follows on the account and says alerts are blocked; nothing is linked", async ({ page }) => {
  await fakePush(page, { permission: "denied", subscribed: false });
  const account = await stubAccount(page);
  await page.goto("/programs/jayton");
  const button = page.getByRole("button", { name: "Follow Jayton", exact: true });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect(page.getByRole("button", { name: "Unfollow Jayton" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "blocked" })).toBeVisible();
  expect(account.log()).toEqual(["follows:follow"]);
});

test("if the link fails, Follow still follows on the account but Unfollow stops (a stale list must not bring the team back)", async ({ page }) => {
  await fakePush(page, { subscribed: false });
  const account = await stubAccount(page, { linkStatus: 503 });
  await page.goto("/programs/jayton");
  const follow = page.getByRole("button", { name: "Follow Jayton", exact: true });
  await expect(follow).toBeEnabled({ timeout: 20_000 });
  await follow.click();
  await expect(page.getByRole("button", { name: "Unfollow Jayton" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "alerts on this browser did not change" })).toBeVisible();
  expect(account.log()).toEqual(["link", "follows:follow"]);
  await page.getByRole("button", { name: "Unfollow Jayton" }).click();
  await expect(page.getByRole("status").filter({ hasText: "That did not work" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unfollow Jayton" })).toBeEnabled(); // still followed
  expect(account.log()).toEqual(["link", "follows:follow", "link"]); // no unfollow went out
});

test("signed out, the Follow button works as it always did: this browser's own push follow, and never the account link", async ({ page }) => {
  await fakePush(page, { subscribed: false });
  const account = await stubAccount(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: { enabled: true, me: null } }));
  await page.goto("/programs/jayton");
  const button = page.getByRole("button", { name: "Alert me to Jayton finals" });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect(page.getByRole("button", { name: "Stop alerts" })).toBeVisible();
  expect(await stored(page)).toEqual(["jayton"]);
  await page.getByRole("button", { name: "Stop alerts" }).click();
  await expect(page.getByRole("button", { name: "Alert me to Jayton finals" })).toBeEnabled();
  expect(account.log()).toEqual(["rpc:push_follow", "rpc:push_unfollow"]);
});
