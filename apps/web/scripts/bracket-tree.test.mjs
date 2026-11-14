// What each box of the tree view holds (ADR 0048; lib/bracket-tree.ts): UIL Division I from its own bracket and the live
// rows of Nov 14, 2026 (fixtures/uil-2026-playoffs-nov14.csv), a bracket with no league file (its shape from the listed
// games alone), and TAIAO's byes. Each tree is also laid out (lib/bracket-layout.ts), so every box has a place.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { derivedSlots, ownSlots, ROUND_ORDER, uilSlotRows } from "../lib/bracket-fill.ts";
import { layoutTree } from "../lib/bracket-layout.ts";
import { treeGames } from "../lib/bracket-tree.ts";
import { parseCsv, UIL_BRACKET_COLUMNS, UilBracketRow } from "../lib/data-schemas.ts";

const STRUCTURE = parseCsv("b.csv", readFileSync(new URL("../../../data/seed/uil-2026-28/bracket-2026.csv", import.meta.url), "utf8"), UIL_BRACKET_COLUMNS, UilBracketRow).map(({ row }) => row);
const [header, ...lines] = readFileSync(new URL("fixtures/uil-2026-playoffs-nov14.csv", import.meta.url), "utf8").trim().split("\n");
const LIVE = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [header.split(",")[i], v])));
const toGame = (r) => ({
  round: r.round, date: r.game_date, home: r.home, away: r.away, confirmed: r.home_score !== "",
  ...(r.home_score !== "" ? { homeScore: Number(r.home_score), awayScore: Number(r.away_score) } : {}),
});
const game = (round, date, home, away, score, extra = {}) => ({ round, date, home, away, confirmed: !!score, ...(score ? { homeScore: score[0], awayScore: score[1] } : {}), ...extra });
const byId = (tree) => new Map(tree.map((n) => [n.id, n]));
const texts = (n) => n.sides.map((s) => s.text);
/** Every box has a place in the layout. */
const placesAll = (tree) => assert.equal(layoutTree(tree).placed.length, tree.length);

test("UIL Division I: 31 boxes, finals bold their winner, the next round names teams or the game it waits on", () => {
  const games = LIVE.filter((r) => r.division === "I").map(toGame);
  const tree = treeGames(ownSlots(uilSlotRows(STRUCTURE), { league: "UIL", division: "I" }), games, ROUND_ORDER);
  assert.equal(tree.length, 31);
  placesAll(tree);
  const at = byId(tree);
  // Every bi-district game is a final, one team bold, both scores shown.
  for (const n of tree.filter((x) => x.round === "bi-district")) {
    assert.equal(n.state, "final", n.id);
    assert.equal(n.sides.filter((s) => s.won).length, 1, n.id);
    assert.ok(n.sides.every((s) => typeof s.score === "number"), n.id);
    assert.equal(n.group, `Region ${STRUCTURE.find((r) => r.division === "I" && r.slot === n.id).region}`);
  }
  // G17 is not listed: its two winners. G19 is listed: upcoming, no score. Later rounds wait on codes.
  assert.equal(at.get("G17").state, "open");
  assert.deepEqual(texts(at.get("G17")), ["Nazareth", "Hermleigh"]);
  assert.equal(at.get("G19").state, "upcoming");
  assert.deepEqual(at.get("G19").sides.map((s) => s.score), [undefined, undefined]);
  assert.deepEqual(texts(at.get("G25")), ["Winner of G17", "Winner of G18"]);
  assert.deepEqual(texts(at.get("G31")), ["Winner of G29", "Winner of G30"]);
  assert.deepEqual(at.get("G31").feeds, ["G29", "G30"]);
  assert.equal(at.get("G31").code, "G31");
});

test("a listed slot keeps the date and site only for a game no site lists yet", () => {
  const tree = treeGames(ownSlots(uilSlotRows(STRUCTURE), { league: "UIL", division: "I" }), [], ROUND_ORDER);
  const g19 = byId(tree).get("G19");
  assert.equal(g19.kickoff_utc, "2026-11-21T00:00:00Z");
  assert.match(g19.site, /Sterling City/);
  const listed = treeGames(ownSlots(uilSlotRows(STRUCTURE), { league: "UIL", division: "I" }), LIVE.filter((r) => r.division === "I").map(toGame), ROUND_ORDER);
  assert.equal(byId(listed).get("G19").site, undefined, "a listed game's own site wins (lib/kickoffs.ts)");
});

test("no league file: the listed games give the shape, two semifinals close the final, nothing further is guessed", () => {
  const qf = [
    game("quarterfinal", "2026-11-13", "A", "B", [40, 20]), game("quarterfinal", "2026-11-13", "C", "D", [30, 34]),
    game("quarterfinal", "2026-11-13", "E", "F", [50, 0], { forfeit: false }), game("quarterfinal", "2026-11-13", "G", "H", [1, 0], { forfeit: true }),
  ];
  const sf = [game("semifinal", "2026-11-20", "A", "D"), game("semifinal", "2026-11-20", "E", "G")];
  const tree = treeGames(derivedSlots([...qf, ...sf], "final", ROUND_ORDER), [...qf, ...sf], ROUND_ORDER);
  assert.equal(tree.length, 7);
  placesAll(tree);
  const final = byId(tree).get("closed:final");
  assert.equal(final.code, undefined);
  assert.deepEqual(texts(final), ["Winner of D–A", "Winner of G–E"]);
  // A forfeit names its winner and shows no score.
  const forfeit = tree.find((n) => n.game?.forfeit);
  assert.deepEqual(forfeit.sides.map((s) => [s.text, s.score, s.won]), [["G", undefined, true], ["H", undefined, undefined]]);
  // Quarterfinals alone: four separate trees, never paired by guess.
  const alone = treeGames(derivedSlots(qf, "final", ROUND_ORDER), qf, ROUND_ORDER);
  assert.equal(alone.length, 4);
  assert.ok(alone.every((n) => n.feeds.every((f) => f === null)));
  assert.ok(layoutTree(alone).placed.length < alone.length, "the page shows such a bracket by rounds, not as a tree");
});

test("TAIAO: a bye is its own box, the team goes on, North and South label the halves", () => {
  const rows = [
    ["round-1", "NR1", "Texas Wind", "bye"], ["round-1", "NR2", "Lubbock", "East Texas"], ["round-1", "SR1", "Fort Bend", "Valor"], ["round-1", "SR2", "San Antonio", "WILCO"],
    ["quarterfinal", "NQ1", "winner:NR1", "winner:NR2"], ["quarterfinal", "SQ1", "winner:SR1", "winner:SR2"], ["final", "FINAL", "winner:NQ1", "winner:SQ1"],
  ].map(([round, slot, a, b]) => ({ league: "TAIAO", division: "1", round, slot, a, b }));
  const games = [game("round-1", "2026-11-06", "Lubbock", "East Texas", [28, 30])];
  const tree = treeGames(ownSlots(rows, { league: "TAIAO", division: "1" }), games, ROUND_ORDER);
  placesAll(tree);
  const at = byId(tree);
  assert.equal(at.get("NR1").state, "bye");
  assert.deepEqual(texts(at.get("NR1")), ["Texas Wind", "Bye"]);
  assert.deepEqual(texts(at.get("NQ1")), ["Texas Wind", "East Texas"]);
  assert.equal(at.get("NQ1").state, "open");
  assert.deepEqual(texts(at.get("SQ1")), ["Winner of SR1", "Winner of SR2"]);
  assert.deepEqual([at.get("NR2").group, at.get("SR1").group, at.get("FINAL").group], ["North", "South", undefined]);
  assert.deepEqual(layoutTree(tree).groups.map((g) => [g.label, g.half]), [["North", "left"], ["South", "right"]]);
});
