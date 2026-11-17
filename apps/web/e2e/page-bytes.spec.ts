import { expect, test } from "@playwright/test";
import { brotliCompressSync, constants } from "node:zlib";

// What the heaviest pages send (ADR 0105), measured on the production build, so a long list cannot grow back to its old size one class at a
// time. "Sent" is the HTML compressed as Vercel compresses it (brotli, quality 3: the same byte count to the byte on the five pages checked
// against the live site, Nov 17, 2026); "raw" is the HTML as parsed, which is also the size of the page's data stream. A budget is the
// measured size with about 6 percent room for a game night's new rows; a page that outgrows it should be made lighter, not the budget bigger,
// unless the page really did get more to say (then say so in the ADR). Only the phone project runs it: the HTML is the same on both.
test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "the HTML is the same at any width"));
test.use({ serviceWorkers: "block" });

const KB = 1024;
// [path, raw HTML budget in KB, sent budget in KB]
const BUDGETS: [string, number, number][] = [
  ["/", 260, 21],
  ["/scores", 245, 24],
  ["/rankings", 1100, 62],
  ["/playoffs/bracket/uil-division-i", 450, 33],
  ["/seasons/2025", 660, 38],
  ["/leaders", 250, 15],
  ["/series/aspermont/jayton", 68, 10.5],
  ["/programs/jayton", 460, 43],
  ["/standings", 640, 28],
  ["/championships", 550, 26],
];

for (const [path, rawKb, sentKb] of BUDGETS) {
  test(`${path} stays under ${rawKb} KB of HTML and ${sentKb} KB sent`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    const html = Buffer.from(await res.body());
    const sent = brotliCompressSync(html, { params: { [constants.BROTLI_PARAM_QUALITY]: 3 } }).length;
    console.log(`page-bytes ${path}: raw ${(html.length / KB).toFixed(1)} KB, sent ${(sent / KB).toFixed(1)} KB`);
    expect(html.length / KB, `${path}: raw HTML`).toBeLessThan(rawKb);
    expect(sent / KB, `${path}: HTML sent`).toBeLessThan(sentKb);
  });
}
