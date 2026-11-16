import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { SUPABASE_URL } from "../lib/supabase-public";
import { noLiveScores } from "./live-route";

// Following a team where alerts cannot reach (lib/push.ts, app/programs/follow.tsx): a browser without Web Push (an iPhone's Safari
// outside the Home Screen) still follows on this browser, so My teams shows the team; a browser at its 25-team cap is told so; an
// unfollow never asks for notification permission. Browser side only: /api/me and Supabase's push_follow and push_unfollow are
// stubs, and the browser's push machinery is a stand-in, so no real prompt, push service or Supabase project is touched.
noLiveScores(test); // also blocks the service worker: none runs under the dev server

const TEAM = "jayton";
const SCHOOL = "Jayton";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/e2e-follow-reach";
const RPC = `${SUPABASE_URL}/rest/v1/rpc/push_*`;

/** No Web Push: a service worker, but no PushManager and no Notification (an iPhone's Safari tab). */
const noPush = (page: Page) =>
  page.addInitScript(() => {
    Reflect.deleteProperty(window, "PushManager");
    Reflect.deleteProperty(window, "Notification");
  });

/** Web Push with `permission` as it starts; `window.asked` counts permission requests (each answers `permission`). */
const withPush = (page: Page, { permission = "default", subscribed = false } = {}) =>
  page.addInitScript(
    ({ permission, subscribed, endpoint }) => {
      const w = window as unknown as { asked: number };
      w.asked = 0;
      const fake = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }), unsubscribe: async () => true };
      let sub: object | null = subscribed ? fake : null;
      const registration = { pushManager: { getSubscription: async () => sub, subscribe: async () => (sub = fake) } };
      Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => ({}), ready: Promise.resolve(registration), getRegistration: async () => registration }, configurable: true });
      Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
      Object.defineProperty(window, "Notification", {
        value: { permission, requestPermission: async () => ((w.asked += 1), permission) },
        configurable: true,
      });
    },
    { permission, subscribed, endpoint: ENDPOINT },
  );

/** A current-season game between two programs, from the same lib the site is built from (as e2e/follow-games.spec.ts). */
async function aGame() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    const { loadSeasonResults } = await import("../lib/games");
    const { loadAlignments, programFor } = await import("../lib/alignments");
    const alignments = await loadAlignments();
    const r = (await loadSeasonResults(2026)).find((x) => x.href === `/scores/${x.id}` && programFor(alignments, x.home) && programFor(alignments, x.away))!;
    return { href: r.href, away: r.away, home: r.home };
  } finally {
    process.chdir(was);
  }
}

const follow = (page: Page, slugs: string[]) => page.addInitScript((list) => localStorage.setItem("followed-programs", JSON.stringify(list)), slugs);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("followed-programs") ?? "[]"));
const asked = (page: Page) => page.evaluate(() => (window as unknown as { asked?: number }).asked ?? 0);
const signedOut = (page: Page) => page.route("**/api/me", (route) => route.fulfill({ json: { enabled: false, posts: false, me: null } }));

/** Supabase's push_follow and push_unfollow, logged by function name with the body. */
async function stubRpc(page: Page) {
  const calls: { fn: string; body: Record<string, unknown> }[] = [];
  await page.route(RPC, (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 204, body: "" });
    calls.push({ fn: new URL(route.request().url()).pathname.split("/").pop()!, body: route.request().postDataJSON() });
    return route.fulfill({ status: 204, body: "" });
  });
  return calls;
}

test.describe("a browser that cannot show alerts, signed out", () => {
  test("the program page offers Follow, keeps the team on this browser and shows it under My teams; nothing is sent", async ({ page }) => {
    await noPush(page);
    await signedOut(page);
    const rpc = await stubRpc(page);
    await page.goto(`/programs/${TEAM}`);
    const button = page.getByRole("button", { name: `Follow ${SCHOOL}` });
    await expect(button).toBeEnabled({ timeout: 20_000 });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId("follow-no-push")).toContainText("add this site to your Home Screen");
    await button.click();
    await expect(page.getByRole("button", { name: `Unfollow ${SCHOOL}` })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: `Following ${SCHOOL} on this browser.` })).toBeVisible();
    expect(await stored(page)).toEqual([TEAM]);
    expect(rpc).toEqual([]);

    await page.goto("/");
    const block = page.getByRole("region", { name: "My teams" });
    await expect(block).toBeVisible({ timeout: 20_000 });
    await expect(block.locator(`a[href='/programs/${TEAM}']`).first()).toBeVisible();

    await page.goto(`/programs/${TEAM}`);
    await page.getByRole("button", { name: `Unfollow ${SCHOOL}` }).click();
    await expect(page.getByRole("button", { name: `Follow ${SCHOOL}` })).toHaveAttribute("aria-pressed", "false");
    expect(await stored(page)).toEqual([]);
    expect(rpc).toEqual([]);
  });

  test("a game page shows a Follow button for each team, not an empty block", async ({ page }) => {
    const { href, away, home } = await aGame();
    await noPush(page);
    await signedOut(page);
    await page.goto(href);
    const section = page.getByRole("region", { name: "Follow these teams" });
    for (const school of [away, home]) await expect(section.getByRole("button", { name: `Follow ${school}` })).toBeEnabled({ timeout: 20_000 });
    const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='game-alerts']").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe("a browser that can show alerts, signed out", () => {
  test("at 25 teams, following one more says so plainly, asks nothing and sends nothing", async ({ page }) => {
    await withPush(page);
    await signedOut(page);
    await follow(page, Array.from({ length: 25 }, (_, i) => `team-${String(i).padStart(2, "0")}`));
    const rpc = await stubRpc(page);
    await page.goto(`/programs/${TEAM}`);
    const button = page.getByRole("button", { name: `Alert me to ${SCHOOL} finals` });
    await expect(button).toBeEnabled({ timeout: 20_000 });
    await button.click();
    await expect(page.getByRole("status").filter({ hasText: "This browser follows 25 teams, the most it can." })).toBeVisible();
    await expect(button).toBeEnabled();
    expect(await asked(page)).toBe(0);
    expect(rpc).toEqual([]);
    expect(await stored(page)).toHaveLength(25);
  });

  test("notifications blocked after following: Stop alerts still works, asks nothing, and keeps the other teams", async ({ page }) => {
    await withPush(page, { permission: "denied", subscribed: true });
    await signedOut(page);
    await follow(page, [TEAM, "strawn"]);
    const rpc = await stubRpc(page);
    await page.goto(`/programs/${TEAM}`);
    const stop = page.getByRole("button", { name: "Stop alerts" });
    await expect(stop).toBeEnabled({ timeout: 20_000 });
    await stop.click();
    await expect(page.getByRole("button", { name: `Alert me to ${SCHOOL} finals` })).toBeEnabled();
    await expect(page.getByRole("status").filter({ hasText: `Alerts off for ${SCHOOL}.` })).toBeVisible();
    expect(await asked(page)).toBe(0);
    expect(rpc).toEqual([{ fn: "push_follow", body: { p_endpoint: ENDPOINT, p_p256dh: "B".repeat(87), p_auth: "a".repeat(22), p_programs: ["strawn"] } }]);
    expect(await stored(page)).toEqual(["strawn"]);
  });
});
