// The results store (ADR 0031): the reader's games.csv and playoffs.csv in the private data repo are the record, and a
// read merges into them instead of rebuilding them. Pure functions; maxpreps.mjs reads and writes the files.
//
// A read may add a game, fill an empty score, or propose a different score. It never deletes or blanks a stored score:
// - a game the source no longer lists, or lists with no score, keeps its stored score;
// - a stored final changes only when the source shows the same different score on two full reads in a row. The first
//   read records the proposal in pending-scores.csv; the second applies it and appends it to score-changes.csv, which
//   only ever grows. A read that shows the stored score again drops the proposal.
// - an unscored row (a game not yet played) is dropped when a page of one of its teams was read and no longer lists it:
//   a postponed game is listed again under its new date. A row whose teams' pages were not read stays.
// A stored score that must go (a game that was not six-man, a wrong team) goes through data/corrections or a reviewed
// commit to the private repo, never a read.

import { slugify } from "./maxpreps.mjs";

export const PENDING_FILE = "pending-scores.csv";
export const CHANGES_FILE = "score-changes.csv";
export const PENDING_COLUMNS = "file,key,home_score,away_score,first_seen";
export const CHANGE_COLUMNS = "changed_at,file,key,old_home_score,old_away_score,new_home_score,new_away_score,source_url";

/** Plain comma cells, as the reader writes them; a quoted cell would shift columns, so it fails loudly instead. */
export function parseCsv(text, file = "csv") {
  if (!text.trim()) return { header: "", cols: [], rows: [] };
  if (text.includes('"')) throw new Error(`${file}: a quoted cell; the store reads plain cells only`);
  const [header, ...lines] = text.trimEnd().split("\n");
  const cols = header.split(",");
  const rows = lines.map((line, n) => {
    const cells = line.split(",");
    if (cells.length !== cols.length) throw new Error(`${file}: line ${n + 2} has ${cells.length} cells, expected ${cols.length}`);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
  return { header, cols, rows };
}

/** One game in either file: its date and both teams, in either order (lib/games.ts gameKey). */
export const rowKey = (r) => [r.game_date, ...[slugify(r.home), slugify(r.away)].sort()].join("|");
const scored = (r) => r.home_score !== "" && r.away_score !== "";
/** The fresh row's scores in the stored row's home and away order. */
function scoresAs(stored, fresh) {
  const same = slugify(stored.home) === slugify(fresh.home);
  return same ? [fresh.home_score, fresh.away_score] : [fresh.away_score, fresh.home_score];
}
/** The files' own orders: playoffs.csv by league, division, date and home; games.csv by date and home. */
function compare(a, b) {
  if ("league" in a) return a.league.localeCompare(b.league) || a.division.localeCompare(b.division) || a.game_date.localeCompare(b.game_date) || a.home.localeCompare(b.home);
  return a.game_date.localeCompare(b.game_date) || slugify(a.home).localeCompare(slugify(b.home));
}

/**
 * Merges one fresh read of a file into the stored file.
 * @param {{ file: string, stored: string, fresh: string, pending: object[], readTeam: (name: string) => boolean, now: string }} input
 *   stored: the file as the store holds it ("" before the first read); fresh: the same file as this read found it;
 *   pending: every proposal in pending-scores.csv (other files' are passed through); readTeam: whether this read read
 *   that team's page; now: an ISO time for the logs.
 * @returns {{ text: string, pending: object[], changes: object[], counts: Record<string, number> }}
 */
export function mergeStored({ file, stored, fresh, pending, readTeam, now }) {
  const s = parseCsv(stored, `stored ${file}`);
  const f = parseCsv(fresh, `fresh ${file}`);
  if (s.header && f.header && s.header !== f.header) throw new Error(`${file}: the stored header ${s.header} is not this read's ${f.header}`);
  const header = s.header || f.header;
  const cols = s.cols.length ? s.cols : f.cols;
  const counts = { added: 0, filled: 0, same: 0, proposed: 0, changed: 0, keptUnlisted: 0, keptBlank: 0, droppedUnplayed: 0 };
  const proposals = new Map(pending.filter((p) => p.file === file).map((p) => [p.key, p]));
  const nextPending = new Map(proposals);
  const changes = [];
  const out = new Map(s.rows.map((r) => [rowKey(r), r]));
  const seen = new Set();

  for (const r of f.rows) {
    const key = rowKey(r);
    if (seen.has(key)) continue; // listed twice in one read: the first stands, as the reader's own dedupe does
    seen.add(key);
    const old = out.get(key);
    if (!old) {
      out.set(key, r);
      counts.added++;
      continue;
    }
    if (!scored(r)) {
      if (scored(old)) counts.keptBlank++;
      else out.set(key, r); // still to be played: this read's row (its date, site and round) stands
      continue;
    }
    if (!scored(old)) {
      out.set(key, r);
      nextPending.delete(key);
      counts.filled++;
      continue;
    }
    const [home, away] = scoresAs(old, r);
    if (home === old.home_score && away === old.away_score) {
      out.set(key, { ...old, ...fillBlanks(old, r) });
      nextPending.delete(key);
      counts.same++;
      continue;
    }
    const p = proposals.get(key);
    if (p && p.home_score === home && p.away_score === away) {
      out.set(key, { ...old, home_score: home, away_score: away, source_url: r.source_url || old.source_url });
      changes.push({ changed_at: now, file, key, old_home_score: old.home_score, old_away_score: old.away_score, new_home_score: home, new_away_score: away, source_url: r.source_url ?? "" });
      nextPending.delete(key);
      counts.changed++;
    } else {
      nextPending.set(key, { file, key, home_score: home, away_score: away, first_seen: p && p.home_score === home && p.away_score === away ? p.first_seen : now });
      counts.proposed++;
    }
  }

  for (const [key, old] of [...out]) {
    if (seen.has(key)) continue;
    if (scored(old)) counts.keptUnlisted++;
    else if (readTeam(old.home) || readTeam(old.away)) {
      out.delete(key);
      nextPending.delete(key);
      counts.droppedUnplayed++;
    }
  }

  const rows = [...out.values()].sort(compare);
  return {
    text: header ? [header, ...rows.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n") + "\n" : "",
    pending: [...pending.filter((p) => p.file !== file), ...nextPending.values()],
    changes,
    counts,
  };
}

/** Fields the stored row left empty that this read has (an end period, a source page); scores are never touched here. */
function fillBlanks(old, fresh) {
  const filled = {};
  for (const [c, v] of Object.entries(fresh)) if (!["home_score", "away_score", "home", "away"].includes(c) && (old[c] ?? "") === "" && v !== "") filled[c] = v;
  return filled;
}

/** pending-scores.csv as rows, and back. */
export const readPending = (text) => parseCsv(text, PENDING_FILE).rows;
export const pendingCsv = (rows) => [PENDING_COLUMNS, ...[...rows].sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key)).map((p) => PENDING_COLUMNS.split(",").map((c) => p[c]).join(","))].join("\n") + "\n";

/** Lines to append to score-changes.csv (its header first when the file is new). Never rewrites what is there. */
export const changeLines = (changes, fileExists) =>
  (fileExists ? [] : [CHANGE_COLUMNS]).concat(changes.map((c) => CHANGE_COLUMNS.split(",").map((k) => c[k]).join(","))).map((l) => `${l}\n`).join("");

/** One line for coverage.txt and the run summary: counts only, never a team or a source. */
export function countsLine(file, c) {
  return `${file}: ${c.added} added, ${c.filled} scores filled, ${c.same} unchanged, ${c.changed} changed after two reads, ${c.proposed} proposed changes waiting for a second read, ${c.keptUnlisted} kept that this read did not list, ${c.keptBlank} kept that this read showed with no score, ${c.droppedUnplayed} unplayed games no longer listed (dropped).`;
}
