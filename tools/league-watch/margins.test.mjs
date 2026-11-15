// Invented fixtures only: no test reads the feed or the private repo.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MARGIN_COLUMNS, marginCsv, marginRows, marginSummary, MIN_GAP, readReports } from "./margins.mjs";

/** A finals-check row (davecampbells.mjs --finals). */
const fin = (game_date, home, away, mp_home, mp_away, dc_home, dc_away, verdict = "disagree") => ({
  game_date,
  home,
  away,
  mp_home: String(mp_home),
  mp_away: String(mp_away),
  dc_home: String(dc_home),
  dc_away: String(dc_away),
  verdict,
});
/** A history-check row (dc-fill.mjs). */
const his = (game_date, home, away, store_home, store_away, dc_home, dc_away, verdict = "differs") => ({
  game_date,
  home,
  away,
  dc_home: String(dc_home),
  dc_away: String(dc_away),
  store_home: String(store_home),
  store_away: String(store_away),
  verdict,
});

test("a same-winner game whose margins differ by more than a touchdown is listed, with its gap", () => {
  const want = [{ game_date: "2026-10-02", home: "wren", away: "lark", mp_home: 48, mp_away: 42, dc_home: 64, dc_away: 14, gap: 44 }];
  assert.deepEqual(marginRows({ history: [his("2026-10-02", "wren", "lark", 48, 42, 64, 14)] }), want);
  assert.deepEqual(marginRows({ finals: [fin("2026-10-02", "wren", "lark", 48, 42, 64, 14)] }), want);
});

test("the threshold is 7: a 6-point gap (one touchdown) is left out, a 7-point gap is in", () => {
  assert.equal(MIN_GAP, 7);
  const rows = marginRows({ history: [his("2026-09-04", "wren", "lark", 40, 20, 46, 20), his("2026-09-11", "finch", "lark", 40, 20, 47, 20)] });
  assert.deepEqual(rows.map((r) => [r.home, r.gap]), [["finch", 7]]);
});

test("a different winner is not a margin disagreement (it is a dispute, ADR 0040)", () => {
  assert.deepEqual(marginRows({ finals: [fin("2026-09-04", "wren", "lark", 40, 20, 20, 40)] }), []);
});

test("a tie on either side names no winner, so it is left out", () => {
  assert.deepEqual(marginRows({ history: [his("2026-09-04", "wren", "lark", 28, 28, 50, 20), his("2026-09-11", "wren", "lark", 50, 20, 28, 28)] }), []);
});

test("a forfeit-shaped score on either side is left out (its margin is not a real one)", () => {
  assert.deepEqual(marginRows({ history: [his("2026-10-02", "wren", "lark", 45, 0, 1, 0), his("2026-10-09", "wren", "lark", 2, 0, 50, 0)] }), []);
});

test("rows without both scores are skipped, and agreeing rows never list", () => {
  const history = [his("2026-09-04", "wren", "lark", 40, 20, 40, 20, "agree"), his("2026-09-11", "wren", "lark", "", "", 60, 0, "no-score"), his("2026-09-18", "wren", "lark", 40, 20, "", 0)];
  assert.deepEqual(marginRows({ history, finals: [fin("2026-11-12", "wren", "lark", 40, 20, "", "", "dc-missing")] }), []);
});

test("a game in both reports is judged by the finals check, the newer read: a later agreement takes it off", () => {
  const history = [his("2026-11-12", "wren", "lark", 48, 42, 64, 14), his("2026-11-12", "finch", "lark", 50, 20, 40, 20)];
  const finals = [fin("2026-11-12", "wren", "lark", 64, 14, 64, 14, "agree")];
  assert.deepEqual(marginRows({ history, finals }).map((r) => r.home), ["finch"]);
});

test("each game once, widest gap first", () => {
  const history = [his("2026-09-04", "wren", "lark", 50, 20, 40, 20), his("2026-09-04", "wren", "lark", 50, 20, 40, 20)];
  const rows = marginRows({ history, finals: [fin("2026-11-12", "finch", "lark", 48, 42, 64, 14)] });
  assert.deepEqual(rows.map((r) => [r.home, r.gap]), [["finch", 44], ["wren", 10]]);
});

test("the file has its header and one line a game; the summary is counts only", () => {
  const rows = marginRows({ history: [his("2026-11-12", "wren", "lark", 48, 42, 64, 14), his("2026-09-04", "finch", "lark", 50, 20, 40, 20)] });
  assert.equal(marginCsv(rows), `${MARGIN_COLUMNS.join(",")}\n2026-11-12,wren,lark,48,42,64,14,44\n2026-09-04,finch,lark,50,20,40,20,10\n`);
  const summary = marginSummary(2026, rows, 5);
  assert.equal(summary, "Margin check 2026: 5 games compared; 2 with the same winner and margins 7 or more points apart (1 of 14 or more).");
  for (const word of ["wren", "lark", "finch", "48", "64"]) assert.ok(!summary.includes(word));
});

test("readReports reads whichever report exists, and null when neither does", () => {
  const root = mkdtempSync(path.join(tmpdir(), "margins-"));
  assert.equal(readReports(root, 2026), null);
  mkdirSync(path.join(root, "davecampbells-2026"));
  writeFileSync(path.join(root, "davecampbells-2026", "finals-check.csv"), "game_date,home,away,mp_home,mp_away,dc_home,dc_away,verdict\n2026-11-12,wren,lark,48,42,64,14,disagree\n");
  const r = readReports(root, 2026);
  assert.deepEqual(r.history, []);
  assert.equal(marginRows(r)[0].gap, 44);
});
