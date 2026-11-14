// Lays this run's captures on the private data repo's newest main (ADR 0051). commit-results.sh used to replace the whole
// maxpreps-<season>/ folder with the run's copy after resetting to the newest main, so anything someone else committed to
// that folder while the run was reading (a hand fill, a late final, a correction) was silently wiped. This merges instead:
//   node tools/league-watch/remerge.mjs <run's copy of the folder> <the private repo's folder, at its newest main> [--base <dir>]
// --base is the folder as the run started (the private checkout's HEAD before the read). With it, only what the run
// changed or added (its delta against the base) is laid on main, and everything the run left alone stays as main has it.
// Without it every file of the run counts as changed. A file whose main copy still equals the base was untouched by anyone
// else, so the run's copy goes in as it is (the case on nearly every run, and exactly what the folder copy did).
//
// The rule for each file, when main's copy differs from the base:
// - games.csv, playoffs.csv: the run's delta rows through the store's own merge (store.mjs mergeStored, ADR 0031) onto
//   main's file. A row only main has stays. A stored final is never overwritten: a different score becomes a proposal that
//   applies after two reads. A score fills a blank; a blank never replaces a score. No unplayed row is dropped here (no
//   team page counts as read), so a postponed game's old row waits for the next read to drop it.
// - pending-scores.csv: main's proposals, plus the run's new or changed ones, minus the ones the run settled (when main
//   still holds the run's base copy of them); then the merge above updates it for the rows it touched.
// - score-changes.csv (append only): main's lines, plus the run's new lines for a file whose rows went in as the run had
//   them (its change is in the file), plus the changes this merge applied itself. A line of a file that went through the
//   merge is dropped: the merge did not apply that change, so it is proposed again, not logged.
// - moved-games.csv: every move from both sides, deduped by movesCsv (a move never goes away here).
// - outside.csv: main's rows, the run's new or changed rows over them (keepOutside, as the reader keeps them).
// - teams.csv: main's rows, the run's new or changed rows over them (a slug's page is replaced, never shortened).
// - schedule.csv (the unplayed games a targeted read looks for): main's rows plus the run's, minus what the run dropped
//   and minus any game now scored in games.csv or playoffs.csv.
// - every other file (coverage.txt, season.json, a report): the run's copy when the run changed it, else main's.
// Files the run does not have are never touched, and nothing is ever deleted.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keepOutside, SCHEDULE_COLUMNS, SCHEDULE_FILE } from "./maxpreps.mjs";
import { CHANGE_COLUMNS, CHANGES_FILE, changeLines, countsLine, mergeStored, MOVES_FILE, movesCsv, parseCsv, PENDING_FILE, pendingCsv, readPending, rowKey } from "./store.mjs";

const KEYED = ["games.csv", "playoffs.csv"];
const lines = (t) => (t.trim() ? t.trimEnd().split("\n") : []);
const join = (ls) => (ls.length ? ls.join("\n") + "\n" : "");

/** Every file under a folder, as relative paths. */
function walk(dir, rel = "") {
  if (!existsSync(path.join(dir, rel))) return [];
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]));
}

/** The CSV with only the rows of `runText` that `baseText` does not hold the same line for (by line, or by game key for a keyed file). */
function deltaCsv(runText, baseText, keyed) {
  const run = lines(runText);
  const base = new Set(lines(baseText));
  if (!keyed) return join([run[0] ?? "", ...run.slice(1).filter((l) => !base.has(l))].filter(Boolean));
  const r = parseCsv(runText, "run csv");
  const b = parseCsv(baseText, "base csv");
  const line = (row, cols) => cols.map((c) => row[c] ?? "").join(",");
  const had = new Map(b.rows.map((x) => [rowKey(x), line(x, b.cols)]));
  return join([r.header, ...r.rows.filter((x) => had.get(rowKey(x)) !== line(x, r.cols)).map((x) => line(x, r.cols))]);
}

/**
 * @param {{ run: string, main: string, base?: string, now?: string }} input folders and an ISO time for the logs
 * @returns {{ merged: string[], lines: string[] }} the files that went through the merge, and one summary line each
 */
export function remerge({ run, main, base = "", now = new Date().toISOString() }) {
  const read = (dir, name) => (dir && existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : "");
  const has = (dir, name) => Boolean(dir) && existsSync(path.join(dir, name));
  const put = (name, text) => {
    if (text === read(main, name) && has(main, name)) return;
    mkdirSync(path.dirname(path.join(main, name)), { recursive: true });
    writeFileSync(path.join(main, name), text);
  };
  const names = walk(run);
  const merged = [];
  const out = [];
  const fast = new Set(); // keyed files whose rows went in as the run had them

  // Proposals first: main's, plus what the run added or changed, minus what it settled (only where main still agrees with the base).
  const id = (p) => `${p.file}|${p.key}`;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mainPending = new Map(readPending(read(main, PENDING_FILE)).map((p) => [id(p), p]));
  const basePending = new Map(readPending(read(base, PENDING_FILE)).map((p) => [id(p), p]));
  const runPending = new Map(readPending(read(run, PENDING_FILE)).map((p) => [id(p), p]));
  for (const [k, p] of runPending) if (!same(basePending.get(k), p)) mainPending.set(k, p);
  for (const [k, p] of basePending) if (!runPending.has(k) && same(mainPending.get(k), p)) mainPending.delete(k);
  let pending = [...mainPending.values()];
  const changes = [];

  for (const name of KEYED) {
    if (!names.includes(name)) continue;
    const [r, m, b] = [read(run, name), read(main, name), read(base, name)];
    if (m === b) {
      put(name, r);
      fast.add(name);
    } else if (r !== b) {
      const res = mergeStored({ file: name, stored: m, fresh: deltaCsv(r, b, true), pending, readTeam: () => false, now });
      put(name, res.text);
      pending = res.pending;
      changes.push(...res.changes);
      merged.push(name);
      out.push(countsLine(name, res.counts));
    }
  }
  if (names.some((n) => KEYED.includes(n) || n === PENDING_FILE)) {
    const text = pendingCsv(pending);
    if (pending.length || has(main, PENDING_FILE)) put(PENDING_FILE, text);
  }

  // The change log only ever grows.
  const mainLog = read(main, CHANGES_FILE);
  const known = new Set(lines(mainLog));
  const add = lines(read(run, CHANGES_FILE)).slice(1).filter((l) => fast.has(l.split(",")[1]) && !known.has(l));
  if (add.length || changes.length) put(CHANGES_FILE, (mainLog.trim() ? join(lines(mainLog)) : `${CHANGE_COLUMNS}\n`) + join(add) + changeLines(changes, true));

  for (const name of names) {
    if (KEYED.includes(name) || name === PENDING_FILE || name === CHANGES_FILE) continue;
    const [r, m, b] = [read(run, name), read(main, name), read(base, name)];
    if (name === SCHEDULE_FILE) {
      const key = (x) => rowKey(x);
      const rows = new Map(parseCsv(m, name).rows.map((x) => [key(x), x]));
      const runRows = parseCsv(r, name).rows;
      const ran = new Set(runRows.map(key));
      for (const x of parseCsv(b, name).rows) if (!ran.has(key(x))) rows.delete(key(x));
      for (const x of runRows) rows.set(key(x), x);
      for (const f of KEYED) for (const x of parseCsv(read(main, f), f).rows) if (x.home_score !== "" && x.away_score !== "") rows.delete(key(x));
      const list = [...rows.values()].sort((x, y) => x.game_date.localeCompare(y.game_date) || x.home.localeCompare(y.home));
      put(name, [SCHEDULE_COLUMNS, ...list.map((x) => `${x.game_date},${x.home},${x.away}`)].join("\n") + "\n");
    } else if (r === b) {
      continue; // the run left it alone: main's copy stands
    } else if (m === b || (!m && !has(main, name))) {
      put(name, r);
    } else if (name === MOVES_FILE) {
      const own = parseCsv(r, name).rows.filter((x) => !lines(b).includes([x.from_date, x.home, x.away, x.to_date, x.source].join(",")));
      put(name, movesCsv(m, own));
    } else if (name === "outside.csv") {
      put(name, keepOutside(m, deltaCsv(r, b, false)).csv);
    } else if (name === "teams.csv") {
      const teams = new Map([...lines(m).slice(1), ...lines(deltaCsv(r, b, false)).slice(1)].map((l) => [l.split(",")[0], l]));
      put(name, join([lines(r)[0], ...[...teams.values()].sort()]));
    } else {
      put(name, readFileSync(path.join(run, name), "utf8")); // a whole-file report the run rewrote: its copy
    }
  }
  return { merged, lines: out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [run, main] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--base");
  const at = process.argv.indexOf("--base");
  if (!run || !main) throw new Error("usage: remerge.mjs <run's folder> <private folder> [--base <folder as the run started>]");
  const { merged, lines: out } = remerge({ run, main, base: at > 0 ? process.argv[at + 1] : "" });
  if (merged.length) console.log(["Private repo: its main moved during the run; this run's captures were merged onto it, not copied over it:", ...out.map((l) => `- ${l}`)].join("\n"));
}
