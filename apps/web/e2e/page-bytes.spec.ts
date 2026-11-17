import { expect, test } from "@playwright/test";
import { brotliCompressSync, constants } from "node:zlib";

// What the heaviest pages send (ADR 0105), measured on the production build, so a long list cannot grow back to its old size one class at a
// time. "Sent" is the HTML compressed as Vercel compresses it (brotli, quality 3: the same byte count to the byte on the five pages checked
// against the live site, Nov 17, 2026); "raw" is the HTML as parsed, which is also the size of the page's data stream. A budget is the
// size measured after ADR 0105 with 4 to 8 percent room for a game night's new rows (a bracket and the scores page grow most); a page that outgrows it should be made lighter, not the budget bigger,
// unless the page really did get more to say (then say so in the ADR). Only the phone project runs it: the HTML is the same on both.
test.beforeEach(({}, info) => test.skip(info.project.name !== "phone", "the HTML is the same at any width"));
test.use({ serviceWorkers: "block" });

const KB = 1024;
// [path, raw HTML budget in KB, sent budget in KB]. Raw is the budget that holds the class-text cut: the sent size moved only 2 to 8 percent
const BUDGETS: [string, number, number][] = [
  ["/", 233, 19.7],
  ["/scores", 238, 23.5],
  ["/rankings", 750, 56.5],
  ["/playoffs/bracket/uil-division-i", 350, 31.5],
  ["/seasons/2025", 517, 34.3],
  ["/leaders", 173, 13.8],
  ["/series/aspermont/jayton", 63, 9.9],
  ["/programs/jayton", 445, 43.8], // 420.2 raw and 41.3 sent with the road to the State Championship (ADR 0104), plus the same headroom
  ["/standings", 464, 25.2],
  ["/championships", 395, 24.1],
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
