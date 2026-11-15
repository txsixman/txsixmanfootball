import { expect, test } from "@playwright/test";
import { noLiveScores } from "./live-route";

noLiveScores(test);

// Game-night pages preview a card of their own, drawn at build time (app/friday-card.tsx): the og:image and twitter:image
// point at the page's own image, which answers 200 as a PNG, 1200 by 630.
const PNG_SIZE = { width: 1200, height: 630 };

for (const [url, card] of [
  ["/scores/tonight", "/scores/tonight/opengraph-image"],
  ["/playoffs/this-round", "/playoffs/this-round/opengraph-image"],
] as const) {
  test(`${url}: the link preview is its own card, a 1200 by 630 image`, async ({ page, request }) => {
    test.setTimeout(90_000); // the dev server draws each card on first request
    await page.goto(url);
    for (const attr of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      expect(await page.locator(attr).count(), `${url} ${attr}`).toBe(1);
      expect(await page.locator(attr).getAttribute("content"), `${url} ${attr}`).toContain(card);
    }
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", String(PNG_SIZE.width));
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", String(PNG_SIZE.height));
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    const res = await request.get(new URL(image!).pathname + new URL(image!).search);
    expect(res.status(), url).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    // A PNG's IHDR holds its width and height.
    const body = await res.body();
    expect([body.readUInt32BE(16), body.readUInt32BE(20)], url).toEqual([PNG_SIZE.width, PNG_SIZE.height]);
  });
}
