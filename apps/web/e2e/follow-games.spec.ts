import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { noLiveScores } from "./live-route";

// Follow buttons on a game page, for each team that has a program page: where a link shared in a group lands.
noLiveScores(test);

/** A current-season game between two programs, from the same lib the site is built from (the loaders read ../../data from the working directory). */
async function aGame() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    const { loadSeasonResults } = await import("../lib/games");
    const { loadAlignments, programFor } = await import("../lib/alignments");
    const alignments = await loadAlignments();
    const r = (await loadSeasonResults(2026)).find((x) => x.href === `/scores/${x.id}` && programFor(alignments, x.home) && programFor(alignments, x.away))!;
    return { href: r.href, away: r.away, home: r.home, slugs: [programFor(alignments, r.away)!.slug, programFor(alignments, r.home)!.slug] };
  } finally {
    process.chdir(was);
  }
}

// A stand-in for the browser's push machinery (no service worker runs under the dev server) that has not been granted
// notifications yet, and counts how many times the page asks.
const fakePush = (page: Page) =>
  page.addInitScript(() => {
    let sub: object | null = null;
    const fake = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }),
      unsubscribe: async () => ((sub = null), true),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register: async () => ({}), ready: Promise.resolve({ pushManager: { getSubscription: async () => sub, subscribe: async () => (sub = fake) } }) },
    });
    (window as unknown as { asked: number }).asked = 0;
    Object.defineProperty(window, "Notification", {
      value: {
        permission: "default",
        requestPermission: async () => {
          (window as unknown as { asked: number }).asked += 1;
          return "granted";
        },
      },
    });
  });

test("a game page has a Follow button for each team, 44px tall, and tapping one asks for notifications", async ({ page }) => {
  const { href, away, home, slugs } = await aGame();
  await fakePush(page);
  await page.route("https://vhgnaihnyjdnaaergtcl.supabase.co/rest/v1/rpc/push_*", (route) => route.fulfill({ status: 204, body: "" }));
  await page.goto(href);
  const section = page.getByRole("region", { name: "Follow these teams" });
  const buttons = [section.getByRole("button", { name: `Alert me to ${away} finals` }), section.getByRole("button", { name: `Alert me to ${home} finals` })];
  for (const b of buttons) {
    await expect(b).toBeEnabled({ timeout: 20_000 });
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await buttons[0].click();
  await expect(section.getByRole("button", { name: "Stop alerts" })).toHaveCount(1);
  await expect(section.getByRole("status").filter({ hasText: `Alerts on: you will get ${away}` })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { asked: number }).asked)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("followed-programs") ?? "[]"))).toEqual([slugs[0]]);
  // The other team is still off.
  await expect(buttons[1]).toBeEnabled();
});

test("a game page has no repeated ids and says nothing about betting", async ({ page }) => {
  const { href } = await aGame();
  await page.goto(href);
  await expect(page.getByRole("region", { name: "Follow these teams" })).toBeVisible();
  const ids = await page.evaluate(() => [...document.querySelectorAll("[id]")].map((e) => e.id));
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  expect(await page.locator("body").innerText()).not.toMatch(/\b(spread|spreads|odds|betting|wager|parlay)\b/i);
});

test("a game page passes axe", async ({ page }) => {
  const { href } = await aGame();
  await page.goto(href);
  await expect(page.getByRole("region", { name: "Follow these teams" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Alert me to/ }).first()).toBeEnabled({ timeout: 20_000 });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});
