// Margin disagreements (ADR 0059): finals where MaxPreps and the second source name the same winner but their margins
// differ by more than a touchdown. Results watch runs it after the finals cross-check (ADR 0026); by hand:
//   node tools/league-watch/margins.mjs <year> --private <private data repo>
// reads the two private reports that compare the sources, davecampbells-<year>/finals-check.csv (the robot's, bracket
// finals of the last game nights) and davecampbells-history-<year>/history-check.csv (dc-fill.mjs's, the whole season,
// ADR 0032), and writes davecampbells-<year>/margin-check.csv, one row a game, in the private data repo only: the second
// source's scores never reach the public repo (ADR 0026). The console line is counts only, never a team or a score.
//
// A different winner is not a margin disagreement: it goes on the disputed list (ADR 0040). A forfeit-shaped score
// (1-0 or 2-0) on either side is left out, since its margin is not a real one. MaxPreps' score always stands; the list
// changes no rating (ADR 0059's backtest).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { forfeitScore } from "../../apps/web/lib/forfeit.ts";
import { REPORT_FILE as HISTORY_FILE } from "./dc-fill.mjs";
import { REPORT_FILE as FINALS_FILE } from "./davecampbells.mjs";
import { parseCsv } from "./store.mjs";

/** More than one touchdown (6 points in six-man): 2026's non-zero gaps cluster at 1 to 6 and jump to 8 and above. */
export const MIN_GAP = 7;
export const MARGIN_FILE = "margin-check.csv";
export const MARGIN_COLUMNS = ["game_date", "home", "away", "mp_home", "mp_away", "dc_home", "dc_away", "gap"];

const num = (s) => (/^\d+$/.test(s ?? "") ? Number(s) : null);
const keyOf = (r) => `${r.game_date}|${r.home}|${r.away}`;

/** Both reports' rows in one shape, MaxPreps' score as mp_*: the history check's store_* is the same store's score. */
const fromHistory = (r) => ({ game_date: r.game_date, home: r.home, away: r.away, mp_home: r.store_home, mp_away: r.store_away, dc_home: r.dc_home, dc_away: r.dc_away });

/**
 * The games whose two scores name the same winner and whose margins differ by at least `min`, widest gap first, each
 * game once. A game in both reports is judged by the finals check alone: it is the newer read of both sources.
 */
export function marginRows({ finals = [], history = [] }, min = MIN_GAP) {
  const games = new Map(history.map((r) => [keyOf(r), fromHistory(r)]));
  for (const r of finals) games.set(keyOf(r), r);
  const out = [];
  for (const r of games.values()) {
    const [mh, ma, dh, da] = [r.mp_home, r.mp_away, r.dc_home, r.dc_away].map(num);
    if ([mh, ma, dh, da].includes(null) || forfeitScore(mh, ma) || forfeitScore(dh, da)) continue;
    const [ours, theirs] = [mh - ma, dh - da];
    if (ours === 0 || theirs === 0 || Math.sign(ours) !== Math.sign(theirs)) continue;
    const gap = Math.abs(ours - theirs);
    if (gap >= min) out.push({ game_date: r.game_date, home: r.home, away: r.away, mp_home: mh, mp_away: ma, dc_home: dh, dc_away: da, gap });
  }
  return out.sort((a, b) => b.gap - a.gap || a.game_date.localeCompare(b.game_date) || a.home.localeCompare(b.home));
}

export const marginCsv = (rows) => [MARGIN_COLUMNS.join(","), ...rows.map((r) => MARGIN_COLUMNS.map((c) => r[c]).join(","))].join("\n").concat("\n");

/** Counts only, for the run summary (the repo's Actions summaries are public): never a team or a score. */
export const marginSummary = (year, rows, checked) =>
  `Margin check ${year}: ${checked} games compared; ${rows.length} with the same winner and margins ${MIN_GAP} or more points apart (${rows.filter((r) => r.gap >= 14).length} of 14 or more).`;

/** Reads whichever of the two reports exist; null when neither does (nothing to write). */
export function readReports(root, year) {
  const read = (file, label) => (existsSync(file) ? parseCsv(readFileSync(file, "utf8"), label).rows : null);
  const finals = read(path.join(root, `davecampbells-${year}`, FINALS_FILE), FINALS_FILE);
  const history = read(path.join(root, `davecampbells-history-${year}`, HISTORY_FILE), HISTORY_FILE);
  return finals || history ? { finals: finals ?? [], history: history ?? [] } : null;
}

function main() {
  const year = Number(process.argv[2]);
  const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
  const root = arg("--private");
  if (!Number.isInteger(year) || !root) throw new Error("usage: margins.mjs <year> --private <private data repo>");
  const reports = readReports(root, year);
  if (!reports) return console.log(`Margin check ${year}: no cross-check report yet; nothing written.`);
  const rows = marginRows(reports);
  const dir = path.join(root, `davecampbells-${year}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, MARGIN_FILE), marginCsv(rows));
  console.log(marginSummary(year, rows, new Set([...reports.history, ...reports.finals].map(keyOf)).size));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
