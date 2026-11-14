// Late finals and missing finals (ADR 0046). Invented teams only; no test reads a site.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fillStore, lateRows, missingLine, moveRows, movesFor, NOTE, planLate, taiaoFor } from "./late-finals.mjs";
import { mergeStored, parseCsv, rowKey } from "./store.mjs";

const HEADER = "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
const row = (date, home, away, hs = "", as = "", extra = {}) => ({ league: "TAIAO", division: "2", round: "quarterfinal", game_date: date, home, away, neutral: "", home_score: hs, away_score: as, end_reason: hs === "" ? "" : "unknown", end_period: "", source_url: "", notes: "", ...extra });
const csv = (rows) => [HEADER, ...rows.map((r) => HEADER.split(",").map((c) => r[c]).join(","))].join("\n") + "\n";
// 7:00 AM Central on Saturday Nov 14, 2026 (CST, UTC-6): Friday's night is over, Saturday's is not.
const SAT_MORNING = new Date("2026-11-14T13:00:00Z");

test("a game is late once its Central game night is over: from 3:00 AM the next morning, never a postponed one", () => {
  const rows = [row("2026-11-13", "Heron", "Lark"), row("2026-11-14", "Robin", "Crane"), row("2026-11-12", "Finch", "Jay", "40", "6"), row("2026-11-13", "Wren", "Owl", "", "", { end_reason: "postponed" })];
  assert.deepEqual(lateRows(rows, SAT_MORNING).map((r) => r.home), ["Heron"]);
  assert.deepEqual(lateRows(rows, new Date("2026-11-14T08:59:00Z")).map((r) => r.home), [], "2:59 AM Central: Friday's night is not over");
  assert.deepEqual(lateRows(rows, new Date("2026-11-14T09:00:00Z")).map((r) => r.home), ["Heron"], "3:00 AM Central: it is");
});

test("the morning read checks the night before: 11:23 UTC is 5:23 AM Central in November, 6:23 AM in October", () => {
  const sat = [row("2026-11-14", "Robin", "Crane")];
  assert.deepEqual(lateRows(sat, new Date("2026-11-15T11:23:00Z")).map((r) => r.home), ["Robin"], "Sunday's read checks Saturday");
  assert.deepEqual(lateRows([row("2026-10-16", "Robin", "Crane")], new Date("2026-10-17T11:23:00Z")).map((r) => r.home), ["Robin"]);
  assert.deepEqual(lateRows(sat, new Date("2026-11-15T04:30:00Z")).map((r) => r.home), [], "10:30 PM Saturday: still tonight");
});

const bracket = [
  { code: "NQ1", date: "2026-11-13", forfeit: false, teams: [{ name: "Lark", home: true, score: 68 }, { name: "Heron", home: false, score: 0 }] },
  { code: "NQ2", date: "2026-11-14", forfeit: false, teams: [{ name: "Robin", home: false, score: null }, { name: "Crane", home: true, score: null }] },
  { code: "NR3", date: "2026-11-13", forfeit: false, teams: [{ name: "Finch", home: true, score: 2 }, { name: "Jay", home: false, score: 0 }] },
  { code: "SQ1", date: "2026-11-13", forfeit: true, teams: [{ name: "Owl", home: true, score: 30 }, { name: "Wren", home: false, score: 0 }] },
  { code: "SQ2", date: "2026-11-12", forfeit: false, teams: [{ name: "Kite", home: true, score: 30 }, { name: "Gull", home: false, score: 20 }] },
];

test("the league bracket's final is put in the stored row's order, and only a real final on the row's own date", () => {
  assert.deepEqual(taiaoFor(row("2026-11-13", "Heron", "Lark"), bracket), { date: "2026-11-13", final: { home: 0, away: 68 } }, "the bracket's home side is not ours");
  assert.deepEqual(taiaoFor(row("2026-11-13", "Crane", "Robin"), bracket), { date: "2026-11-14", final: null }, "moved, not played");
  assert.equal(taiaoFor(row("2026-11-13", "Finch", "Jay"), bracket).final, null, "a 2-0 may be a forfeit");
  assert.equal(taiaoFor(row("2026-11-13", "Owl", "Wren"), bracket).final, null, "the bracket says forfeit");
  assert.equal(taiaoFor(row("2026-11-13", "Kite", "Gull"), bracket).final, null, "another date");
  assert.equal(taiaoFor(row("2026-11-13", "Lark", "Gull"), bracket), null, "not the same two teams");
});

test("one source's final fills; two must agree; a disagreement fills nothing", () => {
  const [a, b, c] = [row("2026-11-13", "Heron", "Lark"), row("2026-11-13", "Kite", "Gull"), row("2026-11-13", "Owl", "Wren")];
  const taiao = new Map([[rowKey(a), { home: 0, away: 68 }], [rowKey(c), { home: 30, away: 7 }]]);
  const second = new Map([[rowKey(b), { home: 21, away: 14 }], [rowKey(c), { home: 30, away: 8 }]]);
  const { fill, disagree } = planLate([a, b, c], { taiao, second });
  assert.deepEqual(fill.map((f) => [f.row.home, f.home, f.away, f.from]), [["Heron", 0, 68, "taiao"], ["Kite", 21, 14, "second"]]);
  assert.deepEqual(disagree.map((r) => r.home), ["Owl"]);
  const both = planLate([a], { taiao, second: new Map([[rowKey(a), { home: 0, away: 68 }]]) });
  assert.equal(both.fill[0].from, "both");
});

test("the fill goes through the store's merge: an ordinary stored row a later MaxPreps read can only propose to change", () => {
  const late = row("2026-11-13", "Heron", "Lark");
  const stored = csv([late, row("2026-11-06", "Lark", "Wren", "70", "6")]);
  const GAMES = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
  const games = `${GAMES}\n2,season,2026-11-06,Lark,Wren,false,70,6,unknown,,,\n`;
  const filledBoth = fillStore({ stored, games, fill: [{ row: late, home: 0, away: 68, from: "taiao" }], pending: [], now: SAT_MORNING, sourceUrl: () => "https://league.test/bracket" });
  const m = filledBoth.playoffs;
  // games.csv gets the played game too, as the reader writes a playoff game there: round "season", not neutral.
  const played = parseCsv(filledBoth.games.text).rows.find((r) => r.home === "Heron");
  assert.deepEqual([played.division, played.round, played.game_date, played.neutral, played.home_score, played.away_score], ["2", "season", "2026-11-13", "false", "0", "68"]);
  assert.equal(parseCsv(filledBoth.games.text).rows.length, 2);
  // A different stored score in games.csv is never changed this way: it throws, and nothing is written.
  assert.throws(() => fillStore({ stored, games: `${GAMES}\n2,season,2026-11-13,Heron,Lark,false,0,60,unknown,,,\n`, fill: [{ row: late, home: 0, away: 68, from: "taiao" }], pending: [], now: SAT_MORNING }), /games\.csv/);
  const filled = parseCsv(m.text).rows.find((r) => r.home === "Heron");
  assert.deepEqual([filled.home_score, filled.away_score, filled.end_reason, filled.notes], ["0", "68", "unknown", NOTE.taiao]);
  assert.equal(parseCsv(m.text).rows.length, 2);
  // MaxPreps later reads 0-66: proposed, not applied, until a second read says the same (ADR 0031).
  const fresh = csv([row("2026-11-13", "Heron", "Lark", "0", "66")]);
  const once = mergeStored({ file: "playoffs.csv", stored: m.text, fresh, pending: [], readTeam: () => false, now: "t1" });
  assert.equal(parseCsv(once.text).rows.find((r) => r.home === "Heron").away_score, "68");
  assert.equal(once.counts.proposed, 1);
  const twice = mergeStored({ file: "playoffs.csv", stored: once.text, fresh, pending: once.pending, readTeam: () => false, now: "t2" });
  assert.equal(parseCsv(twice.text).rows.find((r) => r.home === "Heron").away_score, "66");
  // A row that already has a score is never filled: the merge would not say "filled", so it throws.
  assert.throws(() => fillStore({ stored: m.text, fill: [{ row: late, home: 0, away: 68, from: "taiao" }], pending: [], now: SAT_MORNING }), /did not only fill/);
});

test("a blank game the league's bracket dates later is moved to that date, never onto another stored game", () => {
  const [a, b, c] = [row("2026-11-13", "Crane", "Robin"), row("2026-11-13", "Heron", "Lark"), row("2026-11-12", "Kite", "Gull")];
  const games = [...bracket, { code: "SQ3", date: "2026-11-14", forfeit: false, teams: [{ name: "Kite", home: true, score: null }, { name: "Gull", home: false, score: null }] }];
  const clash = row("2026-11-14", "Gull", "Kite");
  const moves = movesFor([a, b, c, { ...a, league: "TAPPS" }], games, [a, b, c, clash]);
  assert.deepEqual(moves.map((m) => [m.row.home, m.to]), [["Crane", "2026-11-14"]], "the same date, or a date another stored row has, is no move; only the league's own games");
  const moved = parseCsv(moveRows(csv([a, b]), moves)).rows;
  assert.deepEqual(moved.map((r) => [r.home, r.game_date]), [["Crane", "2026-11-14"], ["Heron", "2026-11-13"]]);
  // After the move it is a game of tonight: not late at 7 AM Saturday, so neither filled nor missing.
  assert.deepEqual(lateRows(moved, SAT_MORNING).map((r) => r.home), ["Heron"]);
  assert.equal(missingLine(b), "2026-11-13 · TAIAO 2 quarterfinal · Lark at Heron");
});
