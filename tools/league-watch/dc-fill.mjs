// The second source's fill (ADR 0033, ADR 0034): adds to a season's store (ADR 0031) the regular-season games the second source has
// and MaxPreps does not, and never changes a game the store holds. Run by hand, after a history read (ADR 0032):
//   node tools/league-watch/dc-fill.mjs <year> --private <private data repo> [--dry-run]
// reads <private>/davecampbells-history-<year>/games.csv (date, our two program slugs, scores, forfeit flags) and the store's
// <private>/maxpreps-<year>/games.csv and playoffs.csv, and:
// - adds a game only when the store has no game of that date and pair, no game of that pair within 3 days either side,
//   both teams are in this season's alignments, it is dated before the season's first bracket game, it has a score, and
//   it is not a forfeit: a forfeit is never filled from the second source alone; it waits for MaxPreps or a hand capture (ADR 0034).
//   It goes through the store's own merge (store.mjs mergeStored), so it lands as an ordinary stored row: later MaxPreps
//   reads may only propose a different score, which applies after two reads (ADR 0031).
// - writes one row a second-source game, with the store's score and a verdict, to
//   <private>/davecampbells-history-<year>/history-check.csv, the private report. Nothing else is written.
// A filled row is written as the reader writes a regular-season game: the alignment names, the home school's division,
// round season, neutral false, end_reason unknown. source_url is the second source's team page and notes says where the row came from;
// publish.mjs drops both, so no page names a source (ADR 0010).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLUMNS, loadAlignments, slugify } from "./maxpreps.mjs";
import { mergeStored, parseCsv, readPending, rowKey } from "./store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The history read's columns (davecampbells.mjs --history, ADR 0032). */
export const DC_COLUMNS = "game_date,home,away,home_score,away_score,home_forfeit,away_forfeit";
export const REPORT_FILE = "history-check.csv";
export const REPORT_COLUMNS = ["game_date", "home", "away", "dc_home", "dc_away", "store_home", "store_away", "verdict"];
/** added: filled into the store. agree / differs: the store has the game (its score stands). near-date: the store has
 * the pair within 3 days. playoff-time: on or after the season's first bracket game. not-aligned: a team missing from the
 * season's alignments. no-score: the second source has none (or both sides forfeited). forfeit: the second source says
 * one side forfeited; a forfeit names a winner, so one source is not enough (it waits for MaxPreps or a hand capture). */
export const VERDICTS = ["added", "agree", "differs", "near-date", "playoff-time", "not-aligned", "no-score", "forfeit"];
export const NEAR_DAYS = 3;
export const SOURCE_ORIGIN = "https://www.davecampbells.com";
export const NOTE = "second source history read (ADR 0033)";

const days = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
const pairOf = (a, b) => [slugify(a), slugify(b)].sort().join("|");

/** The second source's score in our home and away order, a forfeit as 1-0, or null for none. */
export function dcScore(r) {
  const [hf, af] = [r.home_forfeit === "true", r.away_forfeit === "true"];
  if (hf && af) return null;
  if (hf || af) return hf ? ["0", "1"] : ["1", "0"];
  return r.home_score !== "" && r.away_score !== "" ? [r.home_score, r.away_score] : null;
}

/**
 * Sorts each second-source game into a verdict, and the games to add as store rows.
 * @param {{ dcRows: object[], storedGames: object[], storedPlayoffs: object[], alignments: Map<string, object>, teamPage: (slug: string) => string }} input
 */
export function planFill({ dcRows, storedGames, storedPlayoffs, alignments, teamPage }) {
  const stored = [...storedGames, ...storedPlayoffs];
  const byKey = new Map(stored.map((r) => [rowKey(r), r]));
  const datesByPair = new Map();
  for (const r of stored) datesByPair.set(pairOf(r.home, r.away), [...(datesByPair.get(pairOf(r.home, r.away)) ?? []), r.game_date]);
  const firstBracket = storedPlayoffs.map((r) => r.game_date).sort()[0] ?? "9999-12-31";
  const report = [];
  const add = [];
  for (const r of dcRows) {
    const score = dcScore(r);
    const old = byKey.get(rowKey(r));
    const line = { game_date: r.game_date, home: r.home, away: r.away, dc_home: score?.[0] ?? "", dc_away: score?.[1] ?? "", store_home: "", store_away: "" };
    let verdict;
    if (old) {
      const same = slugify(old.home) === r.home;
      [line.store_home, line.store_away] = same ? [old.home_score, old.away_score] : [old.away_score, old.home_score];
      verdict = !score || line.store_home === "" ? "no-score" : line.store_home === score[0] && line.store_away === score[1] ? "agree" : "differs";
    } else if ((datesByPair.get(pairOf(r.home, r.away)) ?? []).some((d) => days(d, r.game_date) <= NEAR_DAYS)) verdict = "near-date";
    else if (!score) verdict = "no-score";
    else if (r.home_forfeit === "true" || r.away_forfeit === "true") verdict = "forfeit";
    else if (r.game_date >= firstBracket) verdict = "playoff-time";
    else if (!alignments.has(r.home) || !alignments.has(r.away)) verdict = "not-aligned";
    else {
      verdict = "added";
      const [home, away] = [alignments.get(r.home), alignments.get(r.away)];
      add.push({
        division: home.division,
        round: "season",
        game_date: r.game_date,
        home: home.school,
        away: away.school,
        neutral: "false",
        home_score: score[0],
        away_score: score[1],
        end_reason: "unknown",
        end_period: "",
        source_url: teamPage(r.home) || teamPage(r.away) || `${SOURCE_ORIGIN}/`,
        notes: NOTE,
      });
    }
    report.push({ ...line, verdict });
  }
  report.sort((a, b) => a.game_date.localeCompare(b.game_date) || a.home.localeCompare(b.home));
  return { report, add };
}

export const reportCsv = (report) => [REPORT_COLUMNS.join(","), ...report.map((r) => REPORT_COLUMNS.map((c) => r[c]).join(","))].join("\n").concat("\n");
const csvLine = (r) => COLUMNS.split(",").map((c) => r[c] ?? "").join(",");
export const counts = (report) => Object.fromEntries(VERDICTS.map((v) => [v, report.filter((r) => r.verdict === v).length]));

/** Adds the planned rows to the stored games.csv through the store's merge; every one must come back as added. */
export function fillStore(storedText, add, pending, now) {
  if (add.some((r) => r.notes.includes(",") || r.source_url.includes(","))) throw new Error("a filled row would hold a comma");
  const fresh = [COLUMNS, ...add.map(csvLine)].join("\n").concat("\n");
  const merged = mergeStored({ file: "games.csv", stored: storedText, fresh, pending, readTeam: () => false, now });
  if (merged.counts.added !== add.length || merged.changes.length) throw new Error(`the store's merge did not only add: ${JSON.stringify(merged.counts)}`);
  return merged;
}

function main() {
  const year = Number(process.argv[2]);
  const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
  const root = arg("--private");
  if (!Number.isInteger(year) || !root) throw new Error("usage: dc-fill.mjs <year> --private <private data repo> [--dry-run]");
  const dcDir = path.join(root, `davecampbells-history-${year}`);
  const store = path.join(root, `maxpreps-${year}`);
  const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const dc = parseCsv(read(path.join(dcDir, "games.csv")), "second-source games.csv");
  if (dc.header !== DC_COLUMNS) throw new Error(`${dcDir}/games.csv: expected ${DC_COLUMNS}`);
  const gamesText = read(path.join(store, "games.csv"));
  const theirs = JSON.parse(readFileSync(path.join(HERE, "davecampbells-teams.json"), "utf8"));
  const { report, add } = planFill({
    dcRows: dc.rows,
    storedGames: parseCsv(gamesText, "games.csv").rows,
    storedPlayoffs: parseCsv(read(path.join(store, "playoffs.csv")), "playoffs.csv").rows,
    alignments: loadAlignments(),
    teamPage: (slug) => (/^[a-z0-9-]+$/.test(theirs[slug] ?? "") ? `${SOURCE_ORIGIN}/team/${theirs[slug]}` : ""),
  });
  writeFileSync(path.join(dcDir, REPORT_FILE), reportCsv(report));
  if (add.length && !process.argv.includes("--dry-run")) {
    const merged = fillStore(gamesText, add, readPending(read(path.join(store, "pending-scores.csv"))), new Date().toISOString());
    writeFileSync(path.join(store, "games.csv"), merged.text);
  }
  const c = counts(report);
  console.log(`${year}: ${report.length} second-source games; ${VERDICTS.map((v) => `${c[v]} ${v}`).join(", ")}${process.argv.includes("--dry-run") ? " (dry run: the store is unchanged)" : ""}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
