// Reads TAIAO's six-man divisions from its public football page, the way a visitor's browser does (ADR 0005): it loads
// the page, waits for the division tables to render, and reads each table's heading and team names. Nothing else on
// the page (rankings, seeds, athlete counts) is kept. It never calls TAIAO's data server directly.
// It rewrites only the TAIAO rows of data/seed/private-2026/alignments.csv; TCAF rows there stay as entered.
// Usage: node taiao.mjs [alignments.csv]
// The same page's bracket tabs give TAIAO's own date and score for each playoff game (ADR 0046): readBrackets() clicks
// each "Division N Bracket" tab and parses its text (parseBracket); tools/league-watch/late-finals.mjs reads them for a
// bracket game still blank the morning after. `node taiao.mjs --text "Division 2 Bracket"` prints a tab's text only.
// The bracket tabs also give each division's slots and what feeds them (ADR 0047): main() writes them to
// data/seed/brackets/<season>.csv (parseBracketSlots, bracketRows).
// `node taiao.mjs --details --out <game details file>` fills each TAIAO bracket game still to play with the
// bracket's kickoff and site, name and city only (ADR 0063), never overwriting a kept value (ADR 0041).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeKickoffs, missingDetails, siteText, streetText } from "./davecampbells.mjs";
import { centralDate, slugify } from "./maxpreps.mjs";
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
export function parseBracketSlots(text, division) {
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
  const bracketFile = process.argv[3] ?? fileURLToPath(new URL(`../../data/seed/brackets/${SEASON}.csv`, import.meta.url));
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
    // Each division's bracket tab, clicked as a visitor would: its slot codes and what fills each side (ADR 0047).
    const slots = [];
    for (const division of ["1", "2", "3"]) {
      await page.locator("button", { hasText: `Division ${division} Bracket` }).first().click();
      await page.getByText(`Division ${division} Playoffs`, { exact: true }).waitFor({ timeout: 30_000 });
      slots.push(...bracketRows(division, parseBracketSlots(await page.locator("main").innerText(), division)));
    }
    mkdirSync(path.dirname(bracketFile), { recursive: true });
    writeFileSync(bracketFile, mergeBrackets(existsSync(bracketFile) ? readFileSync(bracketFile, "utf8") : "", slots));
    console.log(`TAIAO ${SEASON} brackets: ${slots.length} slots in 3 divisions`);
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A game's code on the bracket: NR1 to SR4 (round 1), NQ1 to SQ2 (quarterfinals), SF1 and SF2, FINAL. */
const CODE = /^(?:[NS][RQ]\d|SF\d|FINAL)$/;
/** A team line, "1. Grace Academy Griffins" (an unseeded team reads "—."); "Winner NQ2" and "BYE" are not teams. */
const TEAM = /^(?:\d{1,2}|—)\.\s+(.+)$/;
/** A game's day and time, "Fri, Nov 13 · 7:00 PM" (Central); "Date / Time TBD" has none, "Jan 2 · TBD" no time. */
const WHEN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2}) (\d{1,2})\b(?:\s*·\s*(\d{1,2}):(\d{2})\s*([AP]M)\b)?/;
/** Lines after a game's date that are not its site: a link, the forfeit word, a placeholder, a round heading in capitals. */
const NOT_SITE = /livestream|watch|tickets|forfeit|\bTBD\b/i;

/**
 * One division's bracket, from the text its tab shows (after the "Division N Playoffs" heading): each game's code, its
 * named teams (home marked "(H)") with any score, its date ("YYYY-MM-DD", the season's year; January the next), its
 * Central kickoff time ("19:30", null when none is shown), its site line as the page writes it (null when none, or
 * "Location TBD"; venueOf keeps only a name and a city of it, ADR 0063), and whether its text says forfeit. A game with
 * a "Winner …" or "BYE" side has fewer than two teams. Nothing else is kept.
 */
export function parseBracket(text, season = Number(SEASON)) {
  const lines = text.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => /^Division \d Playoffs$/.test(l));
  const games = [];
  let g = null;
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (!line) continue;
    if (CODE.test(line)) {
      g = { code: line, teams: [], date: null, time: null, site: null, forfeit: false };
      games.push(g);
      continue;
    }
    if (!g) continue;
    let m;
    if (/forfeit/i.test(line)) g.forfeit = true;
    if (g.date) {
      // After the date: the site (its first line that is not a link or a placeholder), then links.
      if (g.site === null && !g.siteDone) {
        g.siteDone = true;
        if (/[a-z]/.test(line) && !NOT_SITE.test(line)) g.site = line;
      }
      continue;
    }
    if ((m = TEAM.exec(line)) && g.teams.length < 2) g.teams.push({ name: m[1].trim(), home: false, score: null });
    else if (line === "(H)" && g.teams.length) g.teams.at(-1).home = true;
    else if (/^\d{1,3}$/.test(line) && g.teams.length && g.teams.at(-1).score === null) g.teams.at(-1).score = Number(line);
    else if ((m = WHEN.exec(line)) && MONTHS.includes(m[1])) {
      const month = MONTHS.indexOf(m[1]) + 1;
      g.date = `${month < 7 ? season + 1 : season}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      if (m[3]) g.time = `${String((Number(m[3]) % 12) + (m[5] === "PM" ? 12 : 0)).padStart(2, "0")}:${m[4]}`;
    }
  }
  for (const x of games) delete x.siteDone;
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

// ---- Kickoffs and sites from the bracket (ADR 0063, under ADR 0041's rules) ----

/** A street address's road words: a city follows the last of them when no comma sets it off. */
const ROAD = /^(?:dr|drive|st|street|rd|road|ave|avenue|blvd|boulevard|ln|lane|hwy|highway|pkwy|parkway|way|ct|court|cir|circle|pl|place|trl|trail|loop|spur|point|pt)\.?$/i;
/** A highway, "FM-1188", "TX-16", "US 83": the token after it may start the city. */
const HIGHWAY = /^(?:fm|tx|us|sh|rm|cr|ih|i)-?\d+$/i;
const STATE = /(?:,\s*|\s+)(?:TX|Tx|Texas)\.?(?:,?\s*\d{5}(?:-\d{4})?)?\s*$/;
/** A city as a page writes one: one to three capitalized words. */
const CITY = /^[A-Z][a-z'.-]*(?: [A-Z][a-z'.-]*){0,2}$/;

/** The trailing words of an address part that name its city: those after the street number's road word or highway. */
function cityAfterStreet(part) {
  const words = part.split(/\s+/);
  const num = words.findIndex((w) => /^\d+[A-Za-z]?$/.test(w));
  if (num < 0) return "";
  let at = -1;
  for (let i = num + 1; i < words.length; i++) if (ROAD.test(words[i]) || HIGHWAY.test(words[i])) at = i;
  if (at < 0) return "";
  const city = words.slice(at + 1).join(" ");
  return CITY.test(city) ? city : "";
}

/**
 * A bracket site line as the facts file keeps it (ADR 0041): the venue's name and its city, never the street, number or
 * postal code. The name is the text before the first part that starts with a street number; the city is the part just
 * before the state, or the last part after a street, or the words after a street's road word. Anything that does not
 * read cleanly is "" (not known), never a guess. A city with no name is not a site.
 */
export function venueOf(line) {
  if (typeof line !== "string" || !line.trim()) return { site_name: "", site_city: "", site_street: "", site_state: "", site_zip: "" };
  let t = line.replace(/\s+United States\s*$/i, "").replace(/[;()]/g, ",").replace(/\s+-\s+/g, ", ").replace(/\s+/g, " ").trim();
  // "Academy-4427 Main" and "Stadium. 600 W 7th" start a street after the name (a capital before a dash is a highway, "FM-775").
  t = t.replace(/([a-z])-(\d)/, "$1, $2").replace(/([A-Za-z])\.\s+(\d)/, "$1, $2").replace(/[,\s]+$/, "");
  const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
  // The name: the parts before the first that starts with a street number, cut where a street number starts inside it.
  const first = parts[0] ?? "";
  const name = siteText(/^\d/.test(first) ? "" : first.split(/\s(?=\d+[A-Za-z]?\s)/)[0].replace(/[\s.-]+$/, ""), 80);
  if (!name || !/[a-z]/i.test(name)) return { site_name: "", site_city: "", site_street: "", site_state: "", site_zip: "" };
  let city = "";
  const stated = STATE.exec(t);
  if (stated) {
    const before = t.slice(0, stated.index).split(",").map((p) => p.trim()).filter(Boolean);
    const last = before.at(-1) ?? "";
    city = before.length > 1 && CITY.test(last) && !/\d/.test(last) ? last : cityAfterStreet(last);
  } else if (parts.length >= 2 && CITY.test(parts.at(-1)) && parts.slice(0, -1).some((p) => /\d/.test(p))) {
    city = parts.at(-1);
  } else {
    city = cityAfterStreet(parts.at(-1) ?? "");
  }
  if (city === name || /^(?:TX|Texas)$/i.test(city)) city = "";
  return { site_name: name, site_city: siteText(city, 60), ...streetOf(t, name, city, stated) };
}

/** The street address a site line gives after its name (ADR 0066): from the first street number to the city or state, with
 * "TX" and the ZIP when the line has them; all blank when the line has no clean street (a name alone, a city alone). */
function streetOf(t, name, city, stated) {
  const none = { site_street: "", site_state: "", site_zip: "" };
  let rest = (stated ? t.slice(0, stated.index) : t).slice(t.indexOf(name) + name.length).replace(/^[\s,.-]+/, "");
  // A part between the name and the street ("Lark High School, 12 W 3rd Street") is not the street.
  const at = rest.search(/(?:^|,\s*)\d/);
  if (at > 0) rest = rest.slice(at).replace(/^[,\s]+/, "");
  if (city && rest.endsWith(city)) rest = rest.slice(0, -city.length);
  const site_street = streetText(rest.replace(/[\s,.-]+$/, "").replace(/\s*,\s*/g, " "));
  if (!/^\d/.test(site_street)) return none;
  const zip = stated ? /\d{5}(?:-\d{4})?/.exec(stated[0])?.[0] ?? "" : "";
  return { site_street, site_state: stated ? "TX" : "", site_zip: zip };
}

/** A Central date and "HH:MM" as the UTC kickoff the facts file keeps ("2026-11-21T01:30:00Z"), daylight time known. */
export function kickoffUtc(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  for (const offset of [5, 6]) {
    const at = new Date(Date.UTC(y, mo - 1, d, h + offset, mi));
    const shown = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    if (shown === `${date}, ${time}`) return at.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return "";
}

/**
 * The facts rows the bracket gives for its own games, played or still to play (ADR 0065): both teams named and a date.
 * Home is the team marked "(H)". Each has its kickoff when a time is shown and its site when venueOf reads
 * one; a game with neither is left out. The bracket's own pairings are used, not the listed ones: a listing that
 * contradicts the bracket is voided (ADR 0040), and the right one keys to the same date and two teams once it is listed.
 */
export function detailRows(games) {
  const out = [];
  for (const g of games) {
    // Played games too (ADR 0065): a played game keeps its site line on the bracket.
    if (g.teams.length !== 2 || !g.date) continue;
    const [home, away] = g.teams[1].home ? [g.teams[1], g.teams[0]] : g.teams;
    const kickoff_utc = g.time ? kickoffUtc(g.date, g.time) : "";
    const site = venueOf(g.site);
    if (kickoff_utc || site.site_name) out.push({ date: g.date, home: home.name, away: away.name, kickoff_utc, ...site });
  }
  return out;
}

/** The bracket's games still to play, as the "Still missing" line counts them (missingDetails' due rows). */
export const dueGames = (games, today) =>
  games
    .filter((g) => g.teams.length === 2 && g.date && g.date >= today && g.teams.every((t) => t.score === null))
    .map((g) => ({ league: "TAIAO", game_date: g.date, home: g.teams[0].name, away: g.teams[1].name }));

/** `--details --out <file>`: the bracket's kickoffs and sites merged into the facts file (never overwriting, ADR 0041). */
async function details() {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  if (!out) throw new Error("usage: taiao.mjs --details --out <game details file>");
  const today = centralDate();
  const games = await readBrackets();
  const fresh = detailRows(games);
  const merged = mergeKickoffs(existsSync(out) ? readFileSync(out, "utf8") : "", fresh);
  writeFileSync(out, merged);
  const due = dueGames(games, today);
  console.log(`League bracket details: ${due.length} TAIAO bracket games still to play with both teams known; ${fresh.filter((r) => r.kickoff_utc).length} kickoffs and ${fresh.filter((r) => r.site_name).length} sites on the bracket.`);
  console.log(missingDetails(due, merged));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await (process.argv.includes("--text") ? text() : process.argv.includes("--details") ? details() : main());
