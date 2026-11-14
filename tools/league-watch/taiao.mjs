// Reads TAIAO's six-man divisions from its public football page, the way a visitor's browser does (ADR 0005): it loads
// the page, waits for the division tables to render, and reads each table's heading and team names. Nothing else on
// the page (rankings, seeds, athlete counts) is kept. It never calls TAIAO's data server directly.
// It rewrites only the TAIAO rows of data/seed/private-2026/alignments.csv; TCAF rows there stay as entered.
// Usage: node taiao.mjs [alignments.csv]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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

// ---- Brackets (ADR 0047) ----

/** The bracket file's columns: a side is a team as the page names it, "bye", or "winner:<slot>". No source column (ADR 0010). */
export const BRACKET_HEADER = "league,division,round,slot,a,b";
const SLOT = /^(?:[NS][RQ][1-4]|SF[12]|FINAL)$/;
const roundOf = (code) => (code === "FINAL" ? "final" : code.startsWith("SF") ? "semifinal" : code[1] === "Q" ? "quarterfinal" : "round-1");
const ORDER = ["round-1", "quarterfinal", "semifinal", "final"];

/** One division's bracket tab as its text renders: each slot code, then its two sides (a seeded team, "Winner <slot>" or
 * BYE). Everything else on the tab (scores, dates, sites, seeds) is passed over. */
export function parseBracket(text, division) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const start = lines.indexOf(`Division ${division} Playoffs`);
  if (start < 0) throw new Error(`no "Division ${division} Playoffs" on the bracket tab`);
  const slots = [];
  for (const l of lines.slice(start + 1)) {
    if (/^Division \d Playoffs$/.test(l)) break;
    if (SLOT.test(l)) {
      slots.push({ code: l, sides: [] });
      continue;
    }
    const cur = slots.at(-1);
    if (!cur || cur.sides.length === 2) continue;
    const team = /^\d{1,2}\. (.+)$/.exec(l);
    const winner = /^Winner ((?:[NS][RQ][1-4]|SF[12]))$/.exec(l);
    if (team) cur.sides.push({ team: team[1].trim() });
    else if (winner) cur.sides.push({ winnerOf: winner[1] });
    else if (l === "BYE") cur.sides.push({ bye: true });
  }
  return slots;
}

/**
 * A division's slots as file rows. A first-round side is its team (or the bye); a later side is always the slot that
 * feeds it: "Winner NQ2" as the page says it, or, once the page has placed a team, the earlier slot that team played in.
 * Fails loudly when the tab has another shape: 8 first-round slots, 4 quarterfinals, 2 semifinals and a final, two sides each.
 */
export function bracketRows(division, slots) {
  const want = { "round-1": 8, quarterfinal: 4, semifinal: 2, final: 1 };
  const problems = [];
  for (const [round, n] of Object.entries(want)) {
    const got = slots.filter((s) => roundOf(s.code) === round).length;
    if (got !== n) problems.push(`${n} ${round} slots expected, ${got} read`);
  }
  for (const s of slots) if (s.sides.length !== 2) problems.push(`${s.code}: ${s.sides.length} sides read`);
  if (new Set(slots.map((s) => s.code)).size !== slots.length) problems.push("a slot code twice");
  const side = (s, x) => {
    if ("bye" in x) return "bye";
    if ("winnerOf" in x) return `winner:${x.winnerOf}`;
    if (roundOf(s.code) === "round-1") return x.team;
    const before = ORDER[ORDER.indexOf(roundOf(s.code)) - 1];
    const from = slots.find((t) => roundOf(t.code) === before && t.sides.some((y) => y.team === x.team));
    if (!from) problems.push(`${s.code}: ${x.team} is in no ${before} slot`);
    return from ? `winner:${from.code}` : "";
  };
  for (const s of slots) for (const x of s.sides) if ("team" in x && (!x.team || /,/.test(x.team) || x.team.length > 90)) problems.push(`not a usable name: "${x.team}"`);
  const rows = slots.map((s) => ({ league: "TAIAO", division, round: roundOf(s.code), slot: s.code, a: side(s, s.sides[0]), b: side(s, s.sides[1]) }));
  if (problems.length) throw new Error(`TAIAO Division ${division} bracket failed its checks:\n- ${problems.join("\n- ")}`);
  return rows;
}

/** The bracket file with its TAIAO rows replaced and every other league's kept. */
export function mergeBrackets(csv, rows) {
  const [header, ...lines] = csv.trim() ? csv.trim().split("\n") : [BRACKET_HEADER];
  if (header !== BRACKET_HEADER) throw new Error(`unexpected header: ${header}`);
  const others = lines.filter((line) => !line.startsWith("TAIAO,"));
  return `${[BRACKET_HEADER, ...rows.map((r) => [r.league, r.division, r.round, r.slot, r.a, r.b].join(",")), ...others].join("\n")}\n`;
}

async function main() {
  const file = process.argv[2] ?? fileURLToPath(new URL("../../data/seed/private-2026/alignments.csv", import.meta.url));
  const bracketFile = process.argv[3] ?? fileURLToPath(new URL(`../../data/seed/brackets/${SEASON}.csv`, import.meta.url));

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
    // Each division's bracket tab, clicked as a visitor would: its slot codes and what fills each side (ADR 0047).
    const slots = [];
    for (const division of ["1", "2", "3"]) {
      await page.locator("button", { hasText: `Division ${division} Bracket` }).first().click();
      await page.getByText(`Division ${division} Playoffs`, { exact: true }).waitFor({ timeout: 30_000 });
      slots.push(...bracketRows(division, parseBracket(await page.locator("main").innerText(), division)));
    }
    mkdirSync(path.dirname(bracketFile), { recursive: true });
    writeFileSync(bracketFile, mergeBrackets(existsSync(bracketFile) ? readFileSync(bracketFile, "utf8") : "", slots));
    console.log(`TAIAO ${SEASON} brackets: ${slots.length} slots in 3 divisions`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
