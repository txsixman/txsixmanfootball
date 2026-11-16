import { expect, test, type Page } from "@playwright/test";
import { SUPABASE_URL } from "../lib/supabase-public";
import { noLiveScores } from "./live-route";

// The game alerts switch (the push alerts dark switch, web half): a "Game alerts on this device" switch in the home page's My teams
// block and on /account, shown only while /api/push/status says { alerts: true } (the server's FAN_PUSH_ALERTS is "on").
// Browser side only, as e2e/push-account.spec.ts: the status route, /api/me, /api/push/link and Supabase's push_follow and
// push_unfollow answer with stubs, and the browser's push machinery (service worker, PushManager, Notification) is a stand-in,
// so no real permission prompt, push service or Supabase project is touched.
noLiveScores(test); // also blocks the service worker: none runs under the dev server

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/e2e-push-alerts-endpoint";
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const TEAM = "fort-bend-chargers"; // a program with a My teams card, as e2e/my-teams.spec.ts uses
const STATUS = "**/api/push/status";
const RPC = `${SUPABASE_URL}/rest/v1/rpc/push_*`;
const SWITCH = "Game alerts on this device";

/** A stand-in for the browser's push machinery. `permission` is what Notification.permission starts as; a request answers it
 * (default: granted) and, once granted, it stays granted, as a browser does. `window.asked` counts the requests. `pushManager: false`
 * makes a browser without Web Push (an iPhone's Safari outside the Home Screen). */
const fakePush = (page: Page, { permission = "default", answer = "granted", pushManager = true, subscribed = false } = {}) =>
  page.addInitScript(
    ({ permission, answer, pushManager, subscribed, endpoint, p256dh, auth }) => {
      const w = window as unknown as { asked: number; Notification?: unknown; PushManager?: unknown };
      w.asked = 0;
      if (!pushManager) {
        // iPhone Safari in a tab: a service worker, but no PushManager and no Notification.
        Reflect.deleteProperty(window, "PushManager");
        Reflect.deleteProperty(window, "Notification");
        Object.defineProperty(navigator, "standalone", { value: false, configurable: true });
        return;
      }
      let state = permission;
      const fake = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          sub = null;
          return true;
        },
      };
      let sub: object | null = subscribed ? fake : null;
      const registration = { pushManager: { getSubscription: async () => sub, subscribe: async () => (sub = fake) } };
      Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => ({}), ready: Promise.resolve(registration), getRegistration: async () => registration }, configurable: true });
      Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
      Object.defineProperty(window, "Notification", {
        value: {
          get permission() {
            return state;
          },
          requestPermission: async () => {
            w.asked += 1;
            if (answer === "granted") state = "granted";
            else if (answer === "denied") state = "denied";
            return answer;
          },
        },
        configurable: true,
      });
    },
    { permission, answer, pushManager, subscribed, endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH },
  );

const follow = (page: Page, slugs: string[] = [TEAM]) => page.addInitScript((list) => localStorage.setItem("followed-programs", JSON.stringify(list)), slugs);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("followed-programs") ?? "[]"));
const asked = (page: Page) => page.evaluate(() => (window as unknown as { asked: number }).asked);
const statusIs = (page: Page, alerts: boolean) => page.route(STATUS, (route) => route.fulfill({ json: { alerts } }));

/** Supabase's push_follow and push_unfollow: every POST, by function name, with its body. */
async function stubRpc(page: Page) {
  const calls: { fn: string; body: Record<string, unknown> }[] = [];
  await page.route(RPC, (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 204, body: "" }); // the preflight
    calls.push({ fn: new URL(route.request().url()).pathname.split("/").pop()!, body: route.request().postDataJSON() });
    return route.fulfill({ status: 204, body: "" });
  });
  return calls;
}

/** The home page's My teams block, with its card up; the switch sits inside it. */
async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "My teams" })).toBeVisible({ timeout: 20_000 });
}

test.describe("alerts off (the default)", () => {
  test("with the status route unmocked, the home page shows no alerts switch and no iOS note", async ({ page }) => {
    test.skip(process.env.FAN_PUSH_ALERTS === "on", "the server under test has the alerts switch on");
    await fakePush(page);
    await follow(page);
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/push/status", { timeout: 20_000 });
    await openHome(page);
    const res = await answered;
    expect(await res.json()).toEqual({ alerts: false });
    expect(res.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByTestId("alerts-toggle")).toHaveCount(0);
    await expect(page.getByTestId("alerts-ios-note")).toHaveCount(0);
    await expect(page.getByTestId("alerts-blocked")).toHaveCount(0);
    expect(await asked(page)).toBe(0);
  });

  test("answered { alerts: false }, neither the home page nor /account shows the switch, and nothing is asked", async ({ page }) => {
    let asks = 0;
    await page.route(STATUS, (route) => {
      asks += 1;
      return route.fulfill({ json: { alerts: false } });
    });
    await fakePush(page);
    await follow(page);
    await openHome(page);
    await expect.poll(() => asks).toBeGreaterThan(0); // the page did ask
    await expect(page.getByTestId("alerts-toggle")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: SWITCH })).toHaveCount(0);
    await expect(page.getByTestId("alerts-ios-note")).toHaveCount(0);
    // /account needs a session (a signed-out visit goes to sign-in, or is not found while accounts are off): no switch there either.
    await page.goto("/account");
    await expect(page.getByTestId("alerts-toggle")).toHaveCount(0);
    expect(await asked(page)).toBe(0);
  });

  test("an iPhone Safari tab with the switch off shows no iOS note either", async ({ page }) => {
    await fakePush(page, { pushManager: false });
    await follow(page);
    await statusIs(page, false);
    await openHome(page);
    await expect(page.getByTestId("alerts-ios-note")).toHaveCount(0);
    await expect(page.getByTestId("alerts-toggle")).toHaveCount(0);
  });
});

test.describe("alerts on, signed out", () => {
  test("permission is asked only when the switch is tapped; on follows the list on this device, off keeps the list", async ({ page }) => {
    await fakePush(page);
    await follow(page);
    await statusIs(page, true);
    const rpc = await stubRpc(page);
    await openHome(page);

    const toggle = page.getByRole("switch", { name: SWITCH });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("alerts-toggle")).toHaveCount(1);
    await expect(page.getByText("Kickoff, final score and the next playoff game for the teams you follow.")).toBeVisible();
    // Loading the page asked nothing and sent nothing.
    await page.waitForTimeout(500);
    expect(await asked(page)).toBe(0);
    expect(rpc).toEqual([]);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await asked(page)).toBe(1);
    expect(rpc).toEqual([{ fn: "push_follow", body: { p_endpoint: ENDPOINT, p_p256dh: P256DH, p_auth: AUTH, p_programs: [TEAM] } }]);
    expect(await stored(page)).toEqual([TEAM]);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(rpc.map((c) => c.fn)).toEqual(["push_follow", "push_unfollow"]);
    expect(rpc[1].body).toEqual({ p_endpoint: ENDPOINT });
    expect(await asked(page)).toBe(1); // turning off asks nothing
    expect(await stored(page)).toEqual([TEAM]); // the followed teams stay
  });

  test("the switch has a 44px target on every project", async ({ page }) => {
    await fakePush(page);
    await follow(page);
    await statusIs(page, true);
    await stubRpc(page);
    await openHome(page);
    const toggle = page.getByRole("switch", { name: SWITCH });
    await expect(toggle).toBeVisible();
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("notifications already blocked: the page says so", async ({ page }) => {
    await fakePush(page, { permission: "denied", answer: "denied" });
    await follow(page);
    await statusIs(page, true);
    const rpc = await stubRpc(page);
    await openHome(page);
    const blocked = page.getByTestId("alerts-blocked");
    const toggle = page.getByRole("switch", { name: SWITCH });
    // Shown on load, or once the switch is tapped: either way it ends here, and nothing was followed.
    await expect(blocked.or(toggle).first()).toBeVisible();
    if (!(await blocked.isVisible()) && (await toggle.isEnabled())) await toggle.click();
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText("Alerts are blocked for this site in your browser's settings.");
    await expect(page.getByRole("switch", { name: SWITCH, checked: true })).toHaveCount(0);
    expect(rpc).toEqual([]);
  });

  test("a tap the person refuses at the prompt leaves the switch off and follows nothing", async ({ page }) => {
    await fakePush(page, { answer: "denied" });
    await follow(page);
    await statusIs(page, true);
    const rpc = await stubRpc(page);
    await openHome(page);
    const toggle = page.getByRole("switch", { name: SWITCH });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(page.getByTestId("alerts-blocked")).toBeVisible();
    await expect(toggle).not.toHaveAttribute("aria-checked", "true");
    expect(await asked(page)).toBe(1);
    expect(rpc).toEqual([]);
  });

  test("a browser that already has push alerts starts on", async ({ page }) => {
    await fakePush(page, { permission: "granted", subscribed: true });
    await follow(page);
    await statusIs(page, true);
    await stubRpc(page);
    await openHome(page);
    await expect(page.getByRole("switch", { name: SWITCH })).toHaveAttribute("aria-checked", "true");
    expect(await asked(page)).toBe(0);
  });
});

test.describe("alerts on, iPhone or iPad Safari in a tab", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });

  test("no Web Push and not on the Home Screen: the note says to add the site to the Home Screen first", async ({ page }) => {
    await fakePush(page, { pushManager: false });
    await follow(page);
    await statusIs(page, true);
    await openHome(page);
    const note = page.getByTestId("alerts-ios-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("add this site to your Home Screen first (Share, then Add to Home Screen), then open it from there to turn on alerts.");
    expect(await asked(page)).toBe(0);
  });
});

test.describe("alerts on, signed in", () => {
  /** /api/me says a fan is signed in; /api/push/link is stubbed and logged. */
  async function signedIn(page: Page, { linkStatus = 200 } = {}) {
    const linked: unknown[] = [];
    await page.route("**/api/me", (route) => route.fulfill({ json: { enabled: true, me: { displayName: "Bobcat Fan", follows: [TEAM] } } }));
    await page.route("**/api/push/link", (route) => {
      linked.push(route.request().postDataJSON());
      return route.fulfill({ status: linkStatus, json: linkStatus === 200 ? { programs: [] } : { error: "unavailable" } });
    });
    return linked;
  }

  test("tapping the switch links this browser to the account through /api/push/link, once, and sends nothing to Supabase", async ({ page }) => {
    await fakePush(page);
    await follow(page);
    await statusIs(page, true);
    const rpc = await stubRpc(page);
    const linked = await signedIn(page);
    await openHome(page);
    const toggle = page.getByRole("switch", { name: SWITCH });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.waitForTimeout(500);
    expect(await asked(page)).toBe(0); // asked on the tap only
    await toggle.click();
    await expect.poll(() => linked.length).toBe(1);
    expect(linked).toEqual([{ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH }]);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(await asked(page)).toBe(1);
    expect(rpc).toEqual([]); // the account's path, not the browser's own push_follow
  });

  test("if the link fails, the switch is not left on", async ({ page }) => {
    await fakePush(page);
    await follow(page);
    await statusIs(page, true);
    await stubRpc(page);
    const linked = await signedIn(page, { linkStatus: 503 });
    await openHome(page);
    const toggle = page.getByRole("switch", { name: SWITCH });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect.poll(() => linked.length).toBe(1);
    await expect(toggle).not.toHaveAttribute("aria-checked", "true");
  });
});
