// Bracket-built due games (ADR 0067): invented teams only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { uilSlotRows } from "../../apps/web/lib/bracket-fill.ts";
import { builtDue, fillGame } from "./bracket-due.mjs";

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
