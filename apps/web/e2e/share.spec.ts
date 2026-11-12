import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { demoGames } from "../lib/demo-games";

// The Share button on program pages and game pages: the share sheet when the browser has one, else copy the link.

const pages = [`/programs/jayton`, `/scores/${demoGames[0].id}`];

async function axeClean(page: Page, url: string) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id), url).toEqual([]);
}

for (const url of pages) {
  test(`${url}: Share is visible, 44px tall and passes axe`, async ({ page }) => {
    await page.goto(url, { waitUntil: "networkidle" });
    const share = page.getByRole("button", { name: "Share", exact: true });
    await expect(share).toBeVisible();
    expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await axeClean(page, url);
  });

  test(`${url}: Share calls the share sheet with the page address`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { shared: unknown[] }).shared = [];
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (data: unknown) => {
          (window as unknown as { shared: unknown[] }).shared.push(data);
          return Promise.resolve();
        },
      });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const shared = await page.evaluate(() => (window as unknown as { shared: { title: string; url: string }[] }).shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].url).toBe(page.url());
    expect(shared[0].title).toContain("TX Six-Man Football");
    await expect(page.getByText("Link copied")).toHaveCount(0);
  });

  test(`${url}: a cancelled share is not an error and copies nothing`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.reject(new DOMException("cancelled", "AbortError")),
      });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText("Link copied")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${url}: with no share sheet the link is copied and "Link copied" is announced`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const note = page.getByRole("status").filter({ hasText: "Link copied" });
    await expect(note).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    await axeClean(page, url);
    await expect(note).toHaveCount(0, { timeout: 6000 }); // the message goes away after a few seconds
  });

  test(`${url}: with neither share sheet nor clipboard the button does nothing harmful`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText("Link copied")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
