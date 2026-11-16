// Bracket-built due games (ADR 0067): invented teams only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { uilSlotRows } from "../../apps/web/lib/bracket-fill.ts";
import { builtDue, fillGame, pagePairings, seasonSlotRows, withoutVoided } from "./bracket-due.mjs";
import { parseCsv } from "./store.mjs";

const slot = (round, s, a, b) => ({ division: "I", region: "1", round, slot: s, a, b, kickoff_utc: "", site_name: "", site_city: "" });
const rows = uilSlotRows([
  slot("bi-district", "G1", "Lark", "Wren"), slot("bi-district", "G2", "Finch", "Heron"),
  slot("bi-district", "G3", "Owl", "Crane"), slot("bi-district", "G4", "Jay", "Kite"),
  slot("area", "G17", "winner:G1", "winner:G2"), slot("area", "G18", "winner:G3", "winner:G4"),
]);
const game = (round, home, away, hs = "", as = "") => ({ league: "UIL", division: "I", round, game_date: "2026-11-13", home, away, home_score: hs, away_score: as });

test("a next-round pairing both of whose teams are set by winners is due, with no date", () => {
  const playoffs = [game("bi-district", "Lark", "Wren", "50", "20"), game("bi-district", "Heron", "Finch", "6", "45"), game("bi-district", "Owl", "Crane", "30", "28"), game("bi-district", "Jay", "Kite")];
  assert.deepEqual(builtDue(rows, playoffs), [{ league: "UIL", division: "I", round: "area", game_date: "", home: "Lark", away: "Finch", home_score: "", away_score: "", built: true }]);
});

test("a pairing already listed, or with a side still waiting on its game, is not built; an unlisted first-round game is", () => {
  const playoffs = [game("bi-district", "Lark", "Wren", "50", "20"), game("bi-district", "Heron", "Finch", "6", "45"), game("area", "Finch", "Lark")];
  // G17 is listed; G18 waits on G3 and G4, which the bracket names but no listing has: those two are due.
  assert.deepEqual(builtDue(rows, playoffs).map((r) => `${r.round} ${r.home}-${r.away}`), ["bi-district Owl-Crane", "bi-district Jay-Kite"]);
});

test("a scored row is a final, a blank one is not", () => {
  assert.deepEqual(fillGame(game("bi-district", "Lark", "Wren", "1", "0")), { round: "bi-district", date: "2026-11-13", home: "Lark", away: "Wren", confirmed: true, homeScore: 1, awayScore: 0 });
  assert.equal(fillGame(game("bi-district", "Lark", "Wren")).confirmed, false);
});

test("page pairings: every game the bracket sets with both teams known, in the bracket's order, listed or not", () => {
  const playoffs = [game("bi-district", "Wren", "Lark", "20", "50"), game("bi-district", "Heron", "Finch", "6", "45"), game("bi-district", "Owl", "Crane", "30", "28"), game("bi-district", "Jay", "Kite")];
  // G17 is built from G1 and G2: its first side (home) is G1's winner, whichever way round the listing writes G1.
  assert.deepEqual(pagePairings(rows, playoffs), [{ league: "UIL", division: "I", round: "area", home: "Lark", away: "Finch" }]);
  // Once a listing has G17 the other way round, the bracket's order still stands.
  const listed = [...playoffs, game("area", "Finch", "Lark")];
  assert.deepEqual(pagePairings(rows, listed), [{ league: "UIL", division: "I", round: "area", home: "Lark", away: "Finch" }]);
  // A side still waiting on its game is not a pairing yet.
  assert.deepEqual(pagePairings(rows, playoffs.slice(0, 1)), []);
});

test("a TAPPS-style bracket with no slot file pairs its semifinal winners for the final", () => {
  const tapps = (round, home, away, hs = "", as = "") => ({ league: "TAPPS", division: "I", round, game_date: "2026-11-20", home, away, home_score: hs, away_score: as });
  const playoffs = [tapps("semifinal", "Ash", "Elm", "21", "14"), tapps("semifinal", "Oak", "Fir", "7", "28")];
  assert.deepEqual(pagePairings([], playoffs), [{ league: "TAPPS", division: "I", round: "final", home: "Ash", away: "Fir" }]);
});

test("a game a correction voids is dropped before the bracket is filled", () => {
  const playoffs = [game("bi-district", "Lark", "Wren", "50", "20"), game("bi-district", "Heron", "Finch", "6", "45"), game("bi-district", "Owl", "Crane", "30", "28"), game("bi-district", "Kite", "Jay", "10", "3")];
  const corrections = "game_date,home,away,action,home_score,away_score,source_url,reason,corrected_on\n2026-11-13,Wren,Lark,void,,,u,a copy,2026-11-14";
  assert.equal(withoutVoided(playoffs, corrections).length, 3);
  assert.deepEqual(pagePairings(rows, playoffs).map((p) => `${p.home}-${p.away}`), ["Lark-Finch", "Owl-Kite"]);
  assert.deepEqual(pagePairings(rows, playoffs, { corrections }).map((p) => `${p.home}-${p.away}`), ["Owl-Kite"], "no Lark-Wren game, no winner to place");
});

test("the committed 2026 data: later-round pairings in the bracket's order, with the listing's order where it differs", () => {
  const data = new URL("../../data/", import.meta.url);
  const text = (f) => readFileSync(new URL(f, data), "utf8");
  const playoffs = parseCsv(text("seed/maxpreps-2026/playoffs.csv"), "playoffs.csv").rows;
  const out = pagePairings(seasonSlotRows(new URL("seed/", data).pathname, 2026), playoffs, { corrections: text("corrections/games.csv") });
  const has = (league, division, round, home, away) => out.some((p) => p.league === league && p.division === division && p.round === round && p.home === home && p.away === away);
  assert.ok(out.length >= 19, `only ${out.length} pairings`);
  assert.ok(out.every((p) => p.round !== "round-1" && p.round !== "bi-district" && p.home !== p.away));
  assert.ok(has("UIL", "I", "area", "Nazareth", "Hermleigh"));
  assert.ok(has("UIL", "I", "area", "Jayton", "Whiteface"));
  assert.ok(has("UIL", "I", "area", "Gilmer Union Hill", "Oglesby"), "the listing has Oglesby at home; the bracket's order wins");
  assert.ok(out.some((p) => p.league === "TAPPS" && p.round === "final"), "TAPPS has no slot file; its finals come from closed slots");
  assert.ok(out.some((p) => p.league === "TCAF" && p.round === "final"));
});
