// Reads TAPPS's six-man alignment from its public alignment page, the way a visitor's browser does (ADR 0005).
// It loads the page, picks the year and "Football - 6 Man" in the widget, and reads the rendered list. It never calls
// TAPPS's data server directly. Usage: node tapps.mjs [outDir]   (TAPPS_YEAR=2026/2027 by default)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PAGE = "https://tapps.biz/home/tapps-26-28-alignment/";
export const USER_AGENT = "txsixmanfootball-results-reader/1.0 (+https://txsixmanfootball.com; contact@txsixmanfootball.com)";
const HEADER = "league,division,region,district,school,source_url";
const HEADING = /^Football - 6 Man - Division (I|II|III|IV|V) - (?:District (\d+)|(Independent|Non-Aligned))$/;

/** Turns the widget's text into rows. Everything before the first division heading is page chrome. */
export function parseTapps(text) {
  const rows = [];
  let group = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading) {
      group = { division: heading[1], district: heading[2] ?? heading[3] };
      continue;
    }
    if (!group || !line) continue;
    rows.push({ ...group, school: line.replace(/\s*\*$/, ""), marked: /\*$/.test(line) });
  }
  return rows;
}

/** Fails loudly when the page changed shape, so a broken read never becomes a quiet bad seed. */
export function checkTapps(rows) {
  const problems = [];
  if (rows.length < 40 || rows.length > 150) problems.push(`${rows.length} schools; expected 40 to 150`);
  for (const division of ["I", "II", "III"]) {
    if (!rows.some((r) => r.division === division)) problems.push(`no Division ${division}`);
  }
  const sizes = {};
  for (const r of rows) if (/^\d+$/.test(r.district)) sizes[`${r.division}-${r.district}`] = (sizes[`${r.division}-${r.district}`] ?? 0) + 1;
  for (const [key, n] of Object.entries(sizes)) if (n < 2) problems.push(`Division ${key.replace("-", " District ")} has ${n} school`);
  const seen = new Set();
  for (const { school } of rows) {
    if (seen.has(school)) problems.push(`listed twice: ${school}`);
    seen.add(school);
    if (/,/.test(school)) problems.push(`comma in a name: ${school}`);
    if (school.length > 90 || /^Football\b|^Select\b/.test(school)) problems.push(`not a school name: ${school}`);
  }
  if (problems.length) throw new Error(`TAPPS alignment failed its checks:\n- ${problems.join("\n- ")}`);
}

/** Disallow rules for "*" or for us. shortcut: prefix match only, no wildcards; upgrade: if TAPPS adds wildcard rules. */
export function robotsAllows(robots, pagePath) {
  let applies = false;
  let lastWasAgent = false;
  const disallowed = [];
  for (const raw of robots.split("\n")) {
    const [key, ...rest] = raw.replace(/#.*/, "").split(":");
    const field = key.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (field === "user-agent") {
      const ours = value === "*" || value.toLowerCase().startsWith("txsixmanfootball");
      applies = lastWasAgent ? applies || ours : ours;
      lastWasAgent = true;
    } else if (field) {
      lastWasAgent = false;
      if (applies && field === "disallow" && value) disallowed.push(value);
    }
  }
  return !disallowed.some((prefix) => pagePath.startsWith(prefix));
}

export const toCsv = (rows) =>
  `${[HEADER, ...rows.map((r) => ["TAPPS", r.division, "", r.district, r.school, PAGE].join(","))].join("\n")}\n`;

async function main() {
  const outDir = process.argv[2] ?? fileURLToPath(new URL("../../data/seed/tapps-2026-28/", import.meta.url));
  const year = process.env.TAPPS_YEAR ?? "2026/2027";

  const robots = await fetch("https://tapps.biz/robots.txt", { headers: { "user-agent": USER_AGENT } });
  if (!robots.ok) throw new Error(`robots.txt answered ${robots.status}; not reading without it`);
  if (!robotsAllows(await robots.text(), new URL(PAGE).pathname)) {
    throw new Error("tapps.biz robots.txt now disallows the alignment page. Stop and switch to asking TAPPS (ADR 0005).");
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(PAGE, { waitUntil: "networkidle", timeout: 60_000 });
    const widget = page.frameLocator('iframe[src*="embed-code/alignments"]');
    await widget.locator("select").nth(0).selectOption({ label: year });
    await widget.locator("select").nth(1).selectOption({ label: "Football - 6 Man" });
    await widget.getByText(/^Football - 6 Man - Division I - /).first().waitFor({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    const rows = parseTapps(await widget.locator("body").innerText());
    checkTapps(rows);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "alignments.csv"), toCsv(rows));
    const marked = rows.filter((r) => r.marked).map((r) => r.school);
    writeFileSync(
      path.join(outDir, "marked.txt"),
      `# Schools TAPPS shows with a * on ${PAGE} (${year}). The page does not say what * means.\n${marked.join("\n")}\n`,
    );
    console.log(`TAPPS ${year}: ${rows.length} schools, ${marked.length} marked with *`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
