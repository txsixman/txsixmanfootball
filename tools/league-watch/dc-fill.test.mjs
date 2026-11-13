// Invented fixtures only: no test reads the feed or the private repo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS } from "./maxpreps.mjs";
import { counts, dcScore, fillStore, NOTE, planFill, reportCsv, REPORT_COLUMNS } from "./dc-fill.mjs";
import { parseCsv } from "./store.mjs";

const alignments = new Map([
  ["wren", { school: "Wren", division: "I" }],
  ["lark", { school: "Lark", division: "II" }],
  ["finch", { school: "Finch", division: "I" }],
]);
const dc = (game_date, home, away, home_score, away_score, over = {}) => ({ game_date, home, away, home_score, away_score, home_forfeit: "false", away_forfeit: "false", ...over });
const stored = (game_date, home, away, home_score, away_score) => ({ division: "I", round: "season", game_date, home, away, neutral: "false", home_score, away_score, end_reason: "unknown", end_period: "", source_url: "https://example.org/g", notes: "" });
const teamPage = (slug) => (slug === "wren" ? "https://www.davecampbells.com/team/wren-wrens" : "");
const plan = (dcRows, storedGames = [], storedPlayoffs = []) => planFill({ dcRows, storedGames, storedPlayoffs, alignments, teamPage });

test("a game the store lacks is added as the reader writes a regular-season game", () => {
  const { add, report } = plan([dc("2026-09-04", "wren", "lark", "44", "20")]);
  assert.deepEqual(add, [{ division: "I", round: "season", game_date: "2026-09-04", home: "Wren", away: "Lark", neutral: "false", home_score: "44", away_score: "20", end_reason: "unknown", end_period: "", source_url: "https://www.davecampbells.com/team/wren-wrens", notes: NOTE }]);
  assert.equal(report[0].verdict, "added");
});

test("the store's game always stands: agree or differs is only reported, in our home and away order", () => {
  const { add, report } = plan(
    [dc("2026-09-04", "wren", "lark", "44", "20"), dc("2026-09-11", "lark", "wren", "20", "44")],
    [stored("2026-09-04", "Lark", "Wren", "20", "44"), stored("2026-09-11", "Lark", "Wren", "21", "44")],
  );
  assert.deepEqual(add, []);
  assert.deepEqual(report.map((r) => [r.verdict, r.store_home, r.store_away]), [["agree", "44", "20"], ["differs", "21", "44"]]);
});

test("the same pair within 3 days, a game in bracket time, a team not aligned, or no score is never added", () => {
  const { add, report } = plan(
    [
      dc("2026-09-05", "wren", "lark", "44", "20"), // the store has it on Sep 4
      dc("2026-11-14", "wren", "finch", "30", "28"), // the brackets start Nov 13
      dc("2026-09-18", "wren", "robin", "50", "0"), // robin is not in the alignments
      dc("2026-09-25", "wren", "finch", "", ""),
    ],
    [stored("2026-09-04", "Wren", "Lark", "44", "20")],
    [{ league: "UIL", ...stored("2026-11-13", "Finch", "Lark", "", "") }],
  );
  assert.deepEqual(add, []);
  assert.deepEqual(report.map((r) => r.verdict), ["near-date", "not-aligned", "no-score", "playoff-time"]); // by date
});

test("a forfeit is 1-0 to the side that did not forfeit; both sides forfeiting is no score", () => {
  assert.deepEqual(dcScore(dc("d", "a", "b", "0", "0", { home_forfeit: "true" })), ["0", "1"]);
  assert.deepEqual(dcScore(dc("d", "a", "b", "", "", { away_forfeit: "true" })), ["1", "0"]);
  assert.equal(dcScore(dc("d", "a", "b", "", "", { home_forfeit: "true", away_forfeit: "true" })), null);
});

test("the fill goes through the store's merge: only added, the stored rows untouched, in the store's order", () => {
  const storedText = [COLUMNS, Object.values(stored("2026-09-11", "Lark", "Finch", "28", "26")).join(",")].join("\n") + "\n";
  const { add } = plan([dc("2026-09-04", "wren", "lark", "44", "20")]);
  const merged = fillStore(storedText, add, [], "2026-11-13T00:00:00Z");
  assert.equal(merged.counts.added, 1);
  const rows = parseCsv(merged.text).rows;
  assert.deepEqual(rows.map((r) => [r.game_date, r.home, r.home_score]), [["2026-09-04", "Wren", "44"], ["2026-09-11", "Lark", "28"]]);
  assert.equal(merged.text.split("\n")[0], COLUMNS);
});

test("a fill that would change a stored game fails loudly", () => {
  const storedText = [COLUMNS, Object.values(stored("2026-09-04", "Wren", "Lark", "40", "20")).join(",")].join("\n") + "\n";
  const row = { ...plan([dc("2026-09-04", "wren", "lark", "44", "20")]).add[0] };
  // planFill never plans this (the store has the game); fillStore refuses it anyway.
  assert.throws(() => fillStore(storedText, [row], [], "now"), /did not only add/);
});

test("the private report keeps one row a game and the counts name no team", () => {
  const { report } = plan([dc("2026-09-04", "wren", "lark", "44", "20")]);
  assert.equal(reportCsv(report).split("\n")[0], REPORT_COLUMNS.join(","));
  assert.deepEqual(counts(report), { added: 1, agree: 0, differs: 0, "near-date": 0, "playoff-time": 0, "not-aligned": 0, "no-score": 0 });
});
