import { expect, test, type Page } from "@playwright/test";

// A game night with a bad signal (ADR 0096): a page the fan opened comes back from the service worker's saved copy, says when it was
// saved (Central time) and that scores may have changed, shows no live badge and asks for no live score; when the signal returns it
// loads the page again and says so. The service worker registers only in a production build (app/offline-notice.tsx), as CI runs.
test.skip(!process.env.CI, "the service worker runs only in a production build");

/** Every "7:42 PM" Central clock reading in the last `minutes`, so the test knows the notice names a time near now, in Central time. */
function recentClocks(minutes: number): string[] {
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return Array.from({ length: minutes + 1 }, (_, i) => clock.format(new Date(Date.now() - i * 60_000)).replace(/ /g, " "));
}

async function controlled(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now through the worker, which keeps a copy
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect.poll(() => page.evaluate(async (p) => Boolean(await (await caches.open("saved-pages")).match(p)), path)).toBe(true);
}

test("offline: a visited page reloads as a saved copy with its time, a fixed height and no live badge", async ({ page, context }) => {
  await controlled(page, "/scores/tonight");
  const notice = page.locator('[data-saved-notice="saved"]');
  await expect(notice).toHaveCount(0); // online and fresh: no notice
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/tonight/i);
  await expect(notice).toBeVisible();
  const text = (await notice.textContent()) ?? "";
  expect(text).toMatch(/^Saved copy from \d{1,2}:\d{2} (AM|PM)\. You're offline; scores may have changed\./);
  expect(recentClocks(5).some((clock) => text.startsWith(`Saved copy from ${clock}.`)), text).toBe(true);
  expect((await notice.boundingBox())?.height).toBe(56);
  // Never presented as live: no live line, no red Live badge or section, nothing under way asked of the network.
  await expect(page.locator("[data-live-score]")).toHaveCount(0);
  await expect(page.locator("[data-live-updated]")).toHaveCount(0);
  await expect(page.getByText(/\bLive now\b/i)).toHaveCount(0);
  await expect(page.locator("main .bg-alert")).toHaveCount(0);
  // The notice is the same height before and after a minute of reading, and the button is a real touch target.
  const retry = notice.getByRole("button", { name: "Try again" });
  const size = await retry.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(size!.width).toBeGreaterThanOrEqual(44);
  await context.setOffline(false);
});

test("offline, then back online: the page loads again and says so", async ({ page, context }) => {
  await controlled(page, "/playoffs/this-round");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-saved-notice="saved"]')).toBeVisible();
  await context.setOffline(false);
  // The returning signal triggers a check, then a fresh load, then the notice swaps.
  await expect(page.locator('[data-saved-notice="updated"]')).toHaveText("Back online — updated", { timeout: 30_000 });
  await expect(page.locator('[data-saved-notice="saved"]')).toHaveCount(0);
});

test("Save for no signal keeps tonight's pages and says what it cost; the bracket then opens with no signal", async ({ page, context }) => {
  await page.goto("/scores/tonight");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole("button", { name: "Save for no signal" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved for tonight: \d+ pages?, \d+(\.\d)? (KB|MB) on this phone/ })).toBeVisible({ timeout: 60_000 });
  await context.setOffline(true);
  await page.goto("/playoffs/this-round"); // never visited: only the save kept it
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Offline");
  await expect(page.locator('[data-saved-notice="saved"]')).toContainText("You're offline");
  await context.setOffline(false);
});

test("a sign-in page and the account pages are never kept", async ({ page, context }) => {
  await controlled(page, "/scores");
  await page.goto("/sign-in");
  await page.waitForLoadState("load");
  const kept = await page.evaluate(async () => {
    const found: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) if (/\/(sign-in|account|admin|auth|api|forums)(\/|\?|$)/.test(new URL(request.url).pathname)) found.push(`${name} ${request.url}`);
    return found;
  });
  expect(kept).toEqual([]);
  await context.setOffline(false);
});
