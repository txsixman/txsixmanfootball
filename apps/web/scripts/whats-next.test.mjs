// What is next for a game's winner (lib/whats-next.ts, ADR 0087), on an invented bracket.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { whatsNext } from "../lib/whats-next.ts";

const rounds = ["bi-district", "area", "regional", "state"];
const labelOf = (r) => ({ "bi-district": "Bi-district", area: "Area", regional: "Regional", state: "State Championship" })[r];
const entry = (over) => ({ round: "area", label: "Area", teams: ["Salt Fork", "Dry Wash"], text: ["Salt Fork", "Dry Wash"], date: "2026-11-20", kickoff: "2026-11-21T01:00:00Z", site: "Mesa Stadium", id: "area-1", ...over });
const next = (winner, entries, round = "bi-district") => whatsNext({ round, winner, rounds, entries, labelOf });

test("the next round's game that lists the winner, with the other team, day, kickoff, site and page", () => {
  const out = next("Salt Fork", [entry()]);
  assert.deepEqual(out, { kind: "game", label: "Area", opponent: "Dry Wash", known: true, date: "2026-11-20", kickoff: "2026-11-21T01:00:00Z", site: "Mesa Stadium", id: "area-1" });
  // Either side: the winner may be listed home or away.
  assert.equal(next("Dry Wash", [entry()]).opponent, "Salt Fork");
});

test("a side the bracket has not settled is its words, and the game is not known", () => {
  const out = next("Salt Fork", [entry({ teams: ["Salt Fork", null], text: ["Salt Fork", "winner of Cedar Gap–Mesa Verde"], id: undefined, date: undefined, kickoff: undefined, site: undefined })]);
  assert.equal(out.kind, "game");
  assert.deepEqual([out.opponent, out.known, out.id, out.date, out.site], ["winner of Cedar Gap–Mesa Verde", false, undefined, undefined, undefined]);
});

test("the earliest later round wins, and an earlier or the same round never does", () => {
  const entries = [entry({ round: "regional", label: "Regional", id: "reg" }), entry({ round: "area", label: "Area", id: "area" }), entry({ round: "bi-district", label: "Bi-district", id: "bi" })];
  assert.equal(next("Salt Fork", entries).id, "area");
  assert.equal(next("Salt Fork", entries, "area").id, "reg");
  // Two games in one round: the earlier day.
  assert.equal(next("Salt Fork", [entry({ id: "late", date: "2026-11-22" }), entry({ id: "early", date: "2026-11-20" })]).id, "early");
});

test("no game listed yet: the next round, not set; the last round has nothing more", () => {
  assert.deepEqual(next("Salt Fork", []), { kind: "unset", label: "Area" });
  assert.deepEqual(next("Salt Fork", [entry({ teams: ["Mesa Verde", "Dry Wash"] })]), { kind: "unset", label: "Area" }, "a game of other teams is not the winner's");
  assert.deepEqual(next("Salt Fork", [], "regional"), { kind: "unset", label: "State Championship" });
  assert.deepEqual(next("Salt Fork", [], "state"), { kind: "last" });
  assert.deepEqual(whatsNext({ round: "mystery", winner: "Salt Fork", rounds, entries: [], labelOf }), { kind: "last" }, "a round the bracket does not have says nothing");
});

test("a team name that is a whole word of another is not matched loosely", () => {
  assert.equal(next("Salt", [entry()]).kind, "unset");
});

test("a later game already played is followed: won, on to the next; lost or with no confirmed winner, nothing more", () => {
  const played = (winner, over = {}) => entry({ round: "area", label: "Area", played: { winner }, id: "area-played", ...over });
  const regional = entry({ round: "regional", label: "Regional", teams: ["Salt Fork", "Mesa Verde"], text: ["Salt Fork", "Mesa Verde"], id: "reg" });
  // The winner went on past a played area game to a regional game still to play.
  assert.deepEqual(next("Salt Fork", [played("Salt Fork"), regional]), { kind: "game", label: "Regional", opponent: "Mesa Verde", known: true, date: "2026-11-20", kickoff: "2026-11-21T01:00:00Z", site: "Mesa Stadium", id: "reg" });
  // Won the played game, the next round not set yet: the round after the one it won.
  assert.deepEqual(next("Salt Fork", [played("Salt Fork")]), { kind: "unset", label: "Regional" });
  // Lost it, or the score has no confirmed winner: nothing is said.
  assert.deepEqual(next("Salt Fork", [played("Dry Wash"), regional]), { kind: "out" });
  assert.deepEqual(next("Salt Fork", [played(null), regional]), { kind: "out" });
  // Won the last round there is: nothing more.
  assert.deepEqual(next("Salt Fork", [played("Salt Fork", { round: "state", label: "State Championship" })], "regional"), { kind: "last" });
});
