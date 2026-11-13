// Prints each page's Lighthouse numbers as a Markdown table, for the CI run summary: every number is the median of
// that page's runs, the same median the budgets in lighthouserc.cjs assert (aggregationMethod "median"), so a budget
// that fails shows the number it failed on. Reads the manifest Lighthouse CI writes (upload.outputDir). No manifest:
// says so and exits 0, so the step that failed earlier is the one that shows red.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(import.meta.dirname, ".lighthouse");
const manifestPath = path.join(dir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.log("Lighthouse wrote no results (see the Lighthouse step).");
  process.exit(0);
}

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const pct = (s) => (s == null ? "–" : String(Math.round(s * 100)));
const ms = (v) => (v == null ? "–" : `${Math.round(v)} ms`);

// The manifest's jsonPath is the path inside CI's container; the report sits beside the manifest.
const byPage = new Map();
let runs = 0;
for (const r of JSON.parse(readFileSync(manifestPath, "utf8"))) {
  const lhr = JSON.parse(readFileSync(path.join(dir, path.basename(r.jsonPath)), "utf8"));
  const page = new URL(r.url).pathname;
  if (!byPage.has(page)) byPage.set(page, []);
  byPage.get(page).push({ summary: r.summary, audits: lhr.audits });
  runs = Math.max(runs, byPage.get(page).length);
}

const rows = [...byPage].map(([page, list]) => {
  const cat = (k) => median(list.map((x) => x.summary[k]));
  const num = (k) => median(list.map((x) => x.audits[k]?.numericValue));
  const kb = num("total-byte-weight");
  const cls = num("cumulative-layout-shift");
  return [
    page,
    pct(cat("performance")),
    pct(cat("accessibility")),
    pct(cat("best-practices")),
    ms(num("first-contentful-paint")),
    ms(num("largest-contentful-paint")),
    ms(num("total-blocking-time")),
    cls == null ? "–" : cls.toFixed(3),
    kb == null ? "–" : `${Math.round(kb / 1024)} KB`,
  ];
});

console.log(`### Lighthouse, mobile settings (median of ${runs} runs, each number on its own)\n`);
console.log("| Page | Perf | A11y | Best pr. | FCP | LCP | TBT | CLS | Weight |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.join(" | ")} |`);
