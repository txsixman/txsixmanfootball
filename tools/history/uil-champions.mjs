// Reads UIL's own state football final archive (https://www.uiltexas.org/football/archives, 33 pages) and keeps the
// six-man finals: season, class and division, champion, runner-up, score and notes, each row citing the archive page
// it came from. UIL is the league itself, a primary source (ADR 0002). robots.txt allows /football/archives; the box
// score and bracket PDFs live under /files/, which it disallows, so they are never fetched.
// Run after each season's final: node tools/history/uil-champions.mjs [out.csv]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { robotsAllows } from "../league-watch/tapps.mjs";

export const ARCHIVE = "https://www.uiltexas.org/football/archives";
const USER_AGENT = "Project80x40-history-reader/1.0";
const DELAY_MS = 2500;
export const COLUMNS = "season,conference,division,champion,runner_up,champion_score,runner_up_score,score_note,notes,source_url";

const decode = (s) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;|\u2019/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Every final on one archive page, any class. Throws when the table changed shape. */
export function parseArchive(html) {
  if (!/<th>Champion<\/th>\s*<th>Runner-Up<\/th>\s*<th>Score<\/th>/.test(html)) throw new Error("archive table header changed");
  const rows = [];
  for (const [, tr] of html.matchAll(/<tr>\s*(<td>\d{4}-\d{4}<\/td>.*?)<\/tr>/gs)) {
    const cells = [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => decode(m[1]));
    if (cells.length !== 7) throw new Error(`a final row has ${cells.length} cells: ${decode(tr).slice(0, 80)}`);
    const [years, conference, champion, runnerUp, score, , notes] = cells;
    rows.push({ season: Number(years.slice(0, 4)), conference, champion, runnerUp, score, notes });
  }
  return rows;
}

/** "1A Six-Man Division 1" → { conference: "1A", division: "I" }; "Six-Man" alone (early years) → { conference: "", division: "" }. */
export function sixMan(conference) {
  if (!/six[- ]man|6[- ]man/i.test(conference)) return null;
  const cls = /\b(\d)A\b/i.exec(conference)?.[1];
  const div = /Division (\d|I{1,2})\b/i.exec(conference)?.[1];
  const roman = { 1: "I", 2: "II", I: "I", II: "II" }[div] ?? "";
  return { conference: cls ? `${cls}A` : "", division: roman };
}

/**
 * "69-22 - Mercy Rule 3Q" → [69, 22, "Mercy Rule 3Q"]; "43-12 (boxscore not available)" → [43, 12, ""]. The champion's
 * score is listed first. Text that is not a score (a forfeit) comes back whole as the note.
 */
export function splitScore(text) {
  const m = /^(\d+)\s*-\s*(\d+)(.*)$/.exec(text.trim());
  if (!m) return [null, null, text.trim()];
  const note = m[3].replace(/\(?boxscore not available\)?/i, "").replace(/^[\s:–-]+/, "").replace(/[()]/g, "").trim();
  return [Number(m[1]), Number(m[2]), note];
}

/** Seasons UIL lists with no state final: "Champion: None", "Played to Regionals". */
export const noFinal = (f) => f.champion === "None" && !f.runnerUp;

/** aliases: UIL's spelling → the school's current name (uil-aliases.json). */
export function toRows(finals, pageUrlOf, aliases = {}) {
  const name = (n) => aliases[n] ?? n;
  return finals
    .map((f) => ({ ...f, six: sixMan(f.conference) }))
    .filter((f) => f.six && !noFinal(f))
    .map((f) => {
      const [champ, runner, note] = splitScore(f.score);
      return { season: f.season, ...f.six, champion: name(f.champion), runnerUp: name(f.runnerUp), champ, runner, note, notes: f.notes, source: pageUrlOf(f) };
    });
}

/** Fails loudly when something looks wrong rather than writing a quiet bad seed. */
export function checkRows(rows) {
  const problems = [];
  if (rows.length < 40) problems.push(`only ${rows.length} six-man finals`);
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.season} ${r.conference} ${r.division}`;
    if (seen.has(key)) problems.push(`two finals for ${key}`);
    seen.add(key);
    if (!r.champion || !r.runnerUp) problems.push(`${key}: missing a team`);
    for (const v of [r.champion, r.runnerUp, r.note, r.notes]) if (/,/.test(v ?? "")) problems.push(`${key}: comma in "${v}"`);
    if (r.champ != null && r.champ < r.runner) problems.push(`${key}: champion scored less (${r.champ}-${r.runner})`);
  }
  if (problems.length) throw new Error(`UIL six-man finals failed their checks:\n- ${problems.join("\n- ")}`);
}

export const NO_FINAL_COLUMNS = "season,conference,played_to,source_url";

/** Six-man seasons with no state final, kept as their own record: "Played to Bi-District" → "bi-district". */
export function noFinalRows(finals, pageUrlOf) {
  return finals
    .filter((f) => sixMan(f.conference) && noFinal(f))
    .map((f) => {
      const playedTo = /Played to ([A-Za-z-]+)/i.exec(f.score)?.[1]?.toLowerCase();
      if (!playedTo) throw new Error(`${f.season}: no final, and no round named in "${f.score}"`);
      return { season: f.season, conference: sixMan(f.conference).conference, playedTo, source: pageUrlOf(f) };
    })
    .sort((a, b) => a.season - b.season);
}

export const toNoFinalCsv = (rows) =>
  `${[NO_FINAL_COLUMNS, ...rows.map((r) => [r.season, r.conference, r.playedTo, r.source].join(","))].join("\n")}\n`;

export const toCsv = (rows) =>
  `${[COLUMNS, ...rows.map((r) => [r.season, r.conference, r.division, r.champion, r.runnerUp, r.champ ?? "", r.runner ?? "", r.note, r.notes, r.source].join(","))].join("\n")}\n`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One archive page; UIL_CACHE=<dir> keeps a copy so a rerun after a fix reads no page twice. */
async function page(url, headers) {
  const { existsSync, mkdirSync } = await import("node:fs");
  const cached = process.env.UIL_CACHE && `${process.env.UIL_CACHE}/${url.split("/").pop() || "P0"}.html`;
  if (cached && existsSync(cached)) return readFileSync(cached, "utf8");
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const html = await res.text();
  if (cached) {
    mkdirSync(process.env.UIL_CACHE, { recursive: true });
    writeFileSync(cached, html);
  }
  await sleep(DELAY_MS);
  return html;
}

async function main() {
  const out = process.argv[2] ?? fileURLToPath(new URL("../../data/seed/uil-champions/six-man.csv", import.meta.url));
  const headers = { "user-agent": USER_AGENT };
  const robots = await fetch("https://www.uiltexas.org/robots.txt", { headers });
  if (!robots.ok || !robotsAllows(await robots.text(), "/football/archives")) throw new Error("robots.txt no longer allows /football/archives");

  const finals = [];
  for (let offset = 0, last = 0; offset <= last; offset += 24) {
    const url = offset ? `${ARCHIVE}/P${offset}` : ARCHIVE;
    const html = await page(url, headers);
    if (!offset) last = Number(/archives\/P(\d+)">Last/.exec(html)?.[1] ?? 0);
    for (const f of parseArchive(html)) finals.push({ ...f, url });
  }
  const aliases = JSON.parse(readFileSync(new URL("./uil-aliases.json", import.meta.url), "utf8"));
  const rows = toRows(finals, (f) => f.url, aliases).sort((a, b) => a.season - b.season || a.division.localeCompare(b.division));
  checkRows(rows);
  const none = noFinalRows(finals, (f) => f.url);
  const { mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(rows));
  writeFileSync(join(dirname(out), "six-man-no-final.csv"), toNoFinalCsv(none));
  const seasons = new Set(rows.map((r) => r.season));
  console.log(`${finals.length} UIL finals read; ${rows.length} six-man finals in ${seasons.size} seasons, ${Math.min(...seasons)} to ${Math.max(...seasons)}; ${none.length} six-man seasons with no state final`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
