// After a production deploy: do the pages fans open load on the live site? Each page must answer 200, show its main
// heading and log no console error; /build.json must name the deployed commit. A real Chromium (Playwright's, from
// apps/web's install, run in Playwright's container) against the public site. No token, no secret, nothing written.
//
//   node .github/scripts/smoke.mjs     post-deploy-smoke.yml; exits 1 when any page fails
// Env: SITE (default https://txsixmanfootball.com), EXPECT_SHA (the deployed commit; empty on the scheduled run, which
// only requires a marker), WAIT (seconds to wait for /build.json to name EXPECT_SHA, default 300).

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readMarker } from "./site-freshness.mjs";

/** The fixed pages. A bracket and a game page are followed from the site's own links (FOLLOW), so no name goes stale. */
export const PAGES = ["/", "/scores", "/scores/tonight", "/playoffs", "/rankings", "/weeks", "/programs/jayton"];
export const FOLLOW = [
  { what: "a bracket", from: "/playoffs", pattern: /^\/playoffs\/bracket\/[a-z0-9-]+$/ },
  { what: "a game page", from: "/programs/jayton", pattern: /^\/scores\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/ },
];

/** The first address on a page matching `pattern`, or null. */
export const pickLink = (hrefs, pattern) => hrefs.find((h) => pattern.test(h)) ?? null;

/** What is wrong with one page as loaded; empty when it passes. */
export function pageProblems({ status, heading, errors }) {
  const out = [];
  if (status !== 200) out.push(`answered ${status ?? "nothing"}`);
  if (!heading) out.push("no main heading");
  for (const e of errors.slice(0, 3)) out.push(`console: ${e.slice(0, 200)}`);
  if (errors.length > 3) out.push(`and ${errors.length - 3} more console errors`);
  return out;
}

/** What is wrong with the build marker; null when it passes. */
export function markerProblem(sha, expected) {
  if (!sha) return "/build.json shows no commit";
  if (expected && sha !== expected) return `/build.json names ${sha.slice(0, 7)}, not the deployed ${expected.slice(0, 7)}`;
  return null;
}

async function main() {
  const site = (process.env.SITE || "https://txsixmanfootball.com").replace(/\/$/, "");
  const expected = /^[0-9a-f]{40}$/.test(process.env.EXPECT_SHA ?? "") ? process.env.EXPECT_SHA : null;
  const waitSeconds = Number(process.env.WAIT ?? 300);
  const failures = [];
  const rows = [];

  // The marker first: on a deploy event the domain may still be moving to the new build.
  const marker = async () => {
    const res = await fetch(`${site}/build.json?smoke=${Date.now()}`, { cache: "no-store" }).catch(() => null);
    return res?.ok ? readMarker(await res.json().catch(() => null)) : null;
  };
  const deadline = Date.now() + waitSeconds * 1000;
  let sha = await marker();
  while (expected && sha !== expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    sha = await marker();
  }
  const mp = markerProblem(sha, expected);
  rows.push(`| /build.json | ${mp ?? `pass (${sha.slice(0, 7)})`} |`);
  if (mp) failures.push(`/build.json: ${mp}`);

  const require = createRequire(fileURLToPath(new URL("../../apps/web/package.json", import.meta.url)));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  const visit = async (path) => {
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    let status = null;
    let heading = false;
    let hrefs = [];
    try {
      status = (await page.goto(site + path, { waitUntil: "load", timeout: 30_000 }))?.status() ?? null;
      heading = await page.locator("main h1, h1").first().waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {}); // late errors (live scores) count too
      hrefs = await page.locator("main a[href]").evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
    } catch (e) {
      errors.push(`load failed: ${e.message.split("\n")[0]}`);
    }
    await page.close();
    const problems = pageProblems({ status, heading, errors });
    rows.push(`| ${path} | ${problems.length ? problems.join("; ").replaceAll("|", "\\|") : "pass"} |`);
    for (const p of problems) failures.push(`${path}: ${p}`);
    return hrefs;
  };

  const linksFrom = new Map();
  for (const path of PAGES) linksFrom.set(path, await visit(path));
  for (const f of FOLLOW) {
    const href = pickLink(linksFrom.get(f.from) ?? [], f.pattern);
    if (!href) {
      rows.push(`| ${f.what} | no link on ${f.from} |`);
      failures.push(`${f.what}: no link on ${f.from}`);
      continue;
    }
    await visit(href);
  }
  await browser.close();

  console.log(`## Post-deploy smoke: ${site}${expected ? ` at ${expected.slice(0, 7)}` : ""}\n\n| Page | Result |\n|---|---|\n${rows.join("\n")}\n`);
  if (failures.length) {
    console.log(`${failures.length} failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`Post-deploy smoke could not run: ${error.message}`);
      process.exit(1);
    },
  );
}
