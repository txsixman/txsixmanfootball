// Reads TAIAO's six-man divisions from its public football page, the way a visitor's browser does (ADR 0005): it loads
// the page, waits for the division tables to render, and reads each table's heading and team names. Nothing else on
// the page (rankings, seeds, athlete counts) is kept. It never calls TAIAO's data server directly.
// It rewrites only the TAIAO rows of data/seed/private-2026/alignments.csv; TCAF rows there stay as entered.
// Usage: node taiao.mjs [alignments.csv]
// The same page's bracket tabs give TAIAO's own date and score for each playoff game (ADR 0046): readBrackets() clicks
// each "Division N Bracket" tab and parses its text (parseBracket); tools/league-watch/late-finals.mjs reads them for a
// bracket game still blank the morning after. `node taiao.mjs --text "Division 2 Bracket"` prints a tab's text only.
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

/** Loads the football page as a visitor's browser does, once robots.txt allows it, and runs `read` on it. */
async function withPage(read) {
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
    return await read(page);
  } finally {
    await browser.close();
  }
}

async function main() {
  const file = process.argv[2] ?? fileURLToPath(new URL("../../data/seed/private-2026/alignments.csv", import.meta.url));
  await withPage(async (page) => {
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
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A game's code on the bracket: NR1 to SR4 (round 1), NQ1 to SQ2 (quarterfinals), SF1 and SF2, FINAL. */
const CODE = /^(?:[NS][RQ]\d|SF\d|FINAL)$/;
/** A team line, "1. Grace Academy Griffins" (an unseeded team reads "—."); "Winner NQ2" and "BYE" are not teams. */
const TEAM = /^(?:\d{1,2}|—)\.\s+(.+)$/;
/** A game's day, "Fri, Nov 13 · 7:00 PM"; "Date / Time TBD" has none. */
const WHEN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2}) (\d{1,2})\b/;

/**
 * One division's bracket, from the text its tab shows (after the "Division N Playoffs" heading): each game's code, its
 * named teams (home marked "(H)") with any score, its date ("YYYY-MM-DD", the season's year; January the next), and
 * whether its text says forfeit. A game with a "Winner …" or "BYE" side has fewer than two teams. Nothing else is kept.
 */
export function parseBracket(text, season = Number(SEASON)) {
  const lines = text.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => /^Division \d Playoffs$/.test(l));
  const games = [];
  let g = null;
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (!line) continue;
    if (CODE.test(line)) {
      g = { code: line, teams: [], date: null, forfeit: false };
      games.push(g);
      continue;
    }
    if (!g) continue;
    let m;
    if (/forfeit/i.test(line)) g.forfeit = true;
    if (g.date) continue; // after the date: the site and its links
    if ((m = TEAM.exec(line)) && g.teams.length < 2) g.teams.push({ name: m[1].trim(), home: false, score: null });
    else if (line === "(H)" && g.teams.length) g.teams.at(-1).home = true;
    else if (/^\d{1,3}$/.test(line) && g.teams.length && g.teams.at(-1).score === null) g.teams.at(-1).score = Number(line);
    else if ((m = WHEN.exec(line)) && MONTHS.includes(m[1])) {
      const month = MONTHS.indexOf(m[1]) + 1;
      g.date = `${month < 7 ? season + 1 : season}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
  }
  return games;
}

/** Every division's bracket games, as parseBracket gives them, each with its division. A tab that parses to no game fails. */
export async function readBrackets(divisions = ["1", "2", "3"]) {
  return withPage(async (page) => {
    const out = [];
    for (const d of divisions) {
      await page.getByText(`Division ${d} Bracket`, { exact: true }).first().click();
      await page.getByText(`Division ${d} Playoffs`, { exact: true }).first().waitFor({ timeout: 30_000 });
      const games = parseBracket(await page.locator("main").innerText());
      if (!games.length) throw new Error(`TAIAO Division ${d} bracket: no game read; the page changed shape`);
      out.push(...games.map((g) => ({ ...g, division: d })));
    }
    return out;
  });
}

/** `--text [tab name]`: the page's main text as a visitor sees it, after clicking the named tab ("Division 2 Bracket"),
 * printed only (nothing saved): how its bracket is read by hand. */
const text = () =>
  withPage(async (page) => {
    const tab = process.argv[process.argv.indexOf("--text") + 1];
    if (tab && !tab.startsWith("--")) {
      await page.getByText(tab, { exact: true }).first().click();
      await page.waitForLoadState("networkidle");
    }
    console.log(await page.locator("main").innerText());
  });

if (process.argv[1] === fileURLToPath(import.meta.url)) await (process.argv.includes("--text") ? text() : main());
