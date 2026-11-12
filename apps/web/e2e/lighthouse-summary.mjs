// Prints the median Lighthouse run of each page as a Markdown table, for the CI run summary. Reads the manifest
// Lighthouse CI writes (lighthouserc.cjs, upload.outputDir). No manifest: says so and exits 0, so the step that
// failed earlier is the one that shows red.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(import.meta.dirname, ".lighthouse");
const manifestPath = path.join(dir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.log("Lighthouse wrote no results (see the Lighthouse step).");
  process.exit(0);
}

const pct = (s) => (s == null ? "–" : String(Math.round(s * 100)));
const ms = (a) => (a?.numericValue == null ? "–" : `${Math.round(a.numericValue)} ms`);
const rows = JSON.parse(readFileSync(manifestPath, "utf8"))
  .filter((r) => r.isRepresentativeRun)
  .map((r) => {
    const lhr = JSON.parse(readFileSync(path.resolve(dir, r.jsonPath), "utf8"));
    const a = lhr.audits;
    const kb = a["total-byte-weight"]?.numericValue;
    return [
      new URL(r.url).pathname,
      pct(r.summary.performance),
      pct(r.summary.accessibility),
      pct(r.summary["best-practices"]),
      ms(a["first-contentful-paint"]),
      ms(a["largest-contentful-paint"]),
      ms(a["total-blocking-time"]),
      a["cumulative-layout-shift"]?.numericValue?.toFixed(3) ?? "–",
      kb == null ? "–" : `${Math.round(kb / 1024)} KB`,
    ];
  });

console.log("### Lighthouse, mobile settings (median of 3)\n");
console.log("| Page | Perf | A11y | Best pr. | FCP | LCP | TBT | CLS | Weight |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.join(" | ")} |`);
