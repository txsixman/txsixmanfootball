// Reads TAIAO's six-man divisions from its public football page, the way a visitor's browser does (ADR 0005): it loads
// the page, waits for the division tables to render, and reads each table's heading and team names. Nothing else on
// the page (rankings, seeds, athlete counts) is kept. It never calls TAIAO's data server directly.
// It rewrites only the TAIAO rows of data/seed/private-2026/alignments.csv; TCAF rows there stay as entered.
// Usage: node taiao.mjs [alignments.csv]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { robotsAllows, USER_AGENT } from "./tapps.mjs";

export const PAGE = "https://taiao.org/football/playoffs";
export const SEASON = "2026";
const HEADER = "league,division,region,district,school,source_url";
const HEADING = /^Division (1|2|3) (North|South)$/;

/** Tables as the page renders them: each table's first heading row, and the Team cell of each body row. */
export function parseTaiao(tables) {
  const rows = [];
  for (const { heading, teams } of tables) {
    const m = HEADING.exec(heading.trim());
    if (!m) throw new Error(`unexpected table heading: ${heading}`);
    for (const team of teams) rows.push({ division: m[1], region: m[2], school: team.trim() });
  }
  return rows;
}

/** Fails loudly when the page changed shape, so a broken read never becomes a quiet bad seed. */
export function checkTaiao(rows, title) {
  const problems = [];
  if (!title.startsWith(`${SEASON} TAIAO`)) problems.push(`page title is "${title}"; this reader writes ${SEASON} only`);
  if (rows.length < 30 || rows.length > 90) problems.push(`${rows.length} teams; expected 30 to 90`);
  for (const division of ["1", "2", "3"]) {
    for (const region of ["North", "South"]) {
      if (!rows.some((r) => r.division === division && r.region === region)) problems.push(`no Division ${division} ${region}`);
    }
  }
  const seen = new Set();
  for (const { school } of rows) {
    if (seen.has(school)) problems.push(`listed twice: ${school}`);
    seen.add(school);
    if (!school || /,/.test(school)) problems.push(`not a usable name: "${school}"`);
    if (school.length > 90) problems.push(`not a school name: ${school}`);
  }
  if (problems.length) throw new Error(`TAIAO divisions failed their checks:\n- ${problems.join("\n- ")}`);
}

/** The file with its TAIAO rows replaced and every other league's rows kept as they were, TAIAO first. */
export function mergeInto(csv, rows) {
  const [header, ...lines] = csv.trim().split("\n");
  if (header !== HEADER) throw new Error(`unexpected header: ${header}`);
  const others = lines.filter((line) => !line.startsWith("TAIAO,"));
  const taiao = rows.map((r) => ["TAIAO", r.division, r.region, "0", r.school, PAGE].join(","));
  return `${[HEADER, ...taiao, ...others].join("\n")}\n`;
}

async function main() {
  const file = process.argv[2] ?? fileURLToPath(new URL("../../data/seed/private-2026/alignments.csv", import.meta.url));

  const robots = await fetch("https://taiao.org/robots.txt", { headers: { "user-agent": USER_AGENT } });
  if (!robots.ok) throw new Error(`robots.txt answered ${robots.status}; not reading without it`);
  if (!robotsAllows(await robots.text(), new URL(PAGE).pathname)) {
    throw new Error("taiao.org robots.txt now disallows the football page. Stop and switch to asking TAIAO (ADR 0005).");
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(PAGE, { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator("main table thead th", { hasText: HEADING }).first().waitFor({ timeout: 30_000 });
    const title = (await page.locator("h1").first().innerText()).trim();
    const tables = await page.$$eval("main table", (all) =>
      all
        .map((t) => ({
          heading: t.querySelector("thead tr th")?.textContent ?? "",
          teams: [...t.querySelectorAll("tbody tr")].map((tr) => tr.children[1]?.textContent ?? ""),
        }))
        .filter((t) => /^Division \d/.test(t.heading.trim())),
    );
    const rows = parseTaiao(tables);
    checkTaiao(rows, title);
    writeFileSync(file, mergeInto(readFileSync(file, "utf8"), rows));
    console.log(`TAIAO ${SEASON}: ${rows.length} teams in ${tables.length} division tables`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
