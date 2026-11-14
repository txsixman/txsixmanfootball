// The tree view's layout math (ADR 0049; lib/bracket-layout.ts): UIL's 31-game bracket from its own file, TAIAO's shape
// with byes and crossover semifinals, a bracket that is only its last four, and a one-sided tree.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { layoutTree } from "../lib/bracket-layout.ts";
import { parseCsv, UIL_BRACKET_COLUMNS, UilBracketRow } from "../lib/data-schemas.ts";

const feed = (x) => (x.startsWith("winner:") ? x.slice(7) : null);
const at = (layout, id) => layout.placed.find((p) => p.id === id);

test("UIL Division I: 31 games in nine columns, the final in the middle, each game halfway between its feeders", () => {
  const rows = parseCsv("b.csv", readFileSync(new URL("../../../data/seed/uil-2026-28/bracket-2026.csv", import.meta.url), "utf8"), UIL_BRACKET_COLUMNS, UilBracketRow)
    .map(({ row }) => row).filter((r) => r.division === "I");
  const layout = layoutTree(rows.map((r) => ({ id: r.slot, feeds: [feed(r.a), feed(r.b)], group: r.region && `Region ${r.region}` })));
  assert.equal(layout.placed.length, 31);
  assert.equal(layout.cols, 9);
  assert.equal(layout.rows, 8);
  assert.deepEqual(at(layout, "G31"), { id: "G31", col: 4, row: 3.5, half: "center" });
  assert.deepEqual(at(layout, "G29"), { id: "G29", col: 3, row: 3.5, half: "left" });
  assert.deepEqual(at(layout, "G30"), { id: "G30", col: 5, row: 3.5, half: "right" });
  // Bi-district on the outer columns, in bracket order: G1 to G8 down the left, G9 to G16 down the right.
  assert.deepEqual([1, 2, 8].map((n) => at(layout, `G${n}`)), [
    { id: "G1", col: 0, row: 0, half: "left" }, { id: "G2", col: 0, row: 1, half: "left" }, { id: "G8", col: 0, row: 7, half: "left" },
  ]);
  assert.deepEqual(at(layout, "G9"), { id: "G9", col: 8, row: 0, half: "right" });
  for (const r of rows.filter((r) => feed(r.a))) {
    const [a, b, me] = [at(layout, feed(r.a)), at(layout, feed(r.b)), at(layout, r.slot)];
    assert.equal(me.row, (a.row + b.row) / 2, `${r.slot} sits between its feeders`);
    assert.ok(layout.links.some((l) => l.from === feed(r.a) && l.to === r.slot));
  }
  assert.equal(layout.links.length, 30);
  assert.deepEqual(layout.groups, [
    { label: "Region 1", half: "left", col: 0, top: 0, bottom: 3 }, { label: "Region 2", half: "left", col: 0, top: 4, bottom: 7 },
    { label: "Region 3", half: "right", col: 8, top: 0, bottom: 3 }, { label: "Region 4", half: "right", col: 8, top: 4, bottom: 7 },
  ]);
});

test("TAIAO: a bye's game stays a first-round game, and the crossover semifinals put North and South on each side", () => {
  const n = (id, a, b, group) => ({ id, feeds: [a, b], group });
  const nodes = [
    ...["NR1", "NR2", "NR3", "NR4"].map((id) => n(id, null, null, "North")), ...["SR1", "SR2", "SR3", "SR4"].map((id) => n(id, null, null, "South")),
    n("NQ1", "NR1", "NR2"), n("NQ2", "NR3", "NR4"), n("SQ1", "SR1", "SR2"), n("SQ2", "SR3", "SR4"),
    n("SF1", "NQ1", "SQ2"), n("SF2", "SQ1", "NQ2"), n("FINAL", "SF1", "SF2"),
  ];
  const layout = layoutTree(nodes);
  assert.equal(layout.cols, 7);
  assert.equal(layout.rows, 4);
  assert.equal(at(layout, "FINAL").col, 3);
  assert.deepEqual(["NR1", "NR2", "SR3", "SR4"].map((id) => at(layout, id).half), ["left", "left", "left", "left"]);
  assert.deepEqual(["SR1", "NR4"].map((id) => at(layout, id).half), ["right", "right"]);
  assert.deepEqual(layout.groups.map((g) => `${g.half} ${g.label} ${g.top}-${g.bottom}`), ["left North 0-1", "right North 2-3", "left South 2-3", "right South 0-1"]);
});

test("a bracket of its last four, a shorter half, a one-sided tree, and a game outside the tree", () => {
  const four = layoutTree([{ id: "S1", feeds: [null, null] }, { id: "S2", feeds: [null, null] }, { id: "F", feeds: ["S1", "S2"] }]);
  assert.deepEqual(four.placed.map((p) => `${p.id} ${p.col} ${p.row} ${p.half}`), ["S1 0 0 left", "S2 2 0 right", "F 1 0 center"]);
  // A semifinal side whose team had a bye: that half has one quarterfinal, the other two; the shorter half is centered.
  const uneven = layoutTree([
    { id: "Q1", feeds: [null, null] }, { id: "Q2", feeds: [null, null] }, { id: "Q3", feeds: [null, null] },
    { id: "S1", feeds: ["Q1", "Q2"] }, { id: "S2", feeds: ["Q3", null] }, { id: "F", feeds: ["S1", "S2"] },
  ]);
  assert.equal(uneven.rows, 2);
  assert.deepEqual(["Q3", "S2", "F"].map((id) => at(uneven, id).row), [0.5, 0.5, 0.5]);
  const one = layoutTree([{ id: "A", feeds: [null, null] }, { id: "B", feeds: ["A", null] }]);
  assert.deepEqual(one.placed.map((p) => `${p.id} ${p.col} ${p.half}`), ["A 0 left", "B 1 center"]);
  const stray = layoutTree([...[{ id: "S1", feeds: [null, null] }, { id: "S2", feeds: [null, null] }, { id: "F", feeds: ["S1", "S2"] }], { id: "X", feeds: [null, null] }]);
  assert.equal(stray.placed.some((p) => p.id === "X"), false);
  assert.deepEqual(layoutTree([]), { cols: 0, rows: 0, placed: [], links: [], groups: [] });
});

test("pixels: UIL's nine columns fit a 1600px screen, every team row is 44px, the side labels have their own gutter, connectors join box edges", async () => {
  const { geometry } = await import("../lib/bracket-layout.ts");
  const nine = geometry({ cols: 9, rows: 8, groups: [{}] });
  assert.ok(nine.width <= 1600 - 32, `${nine.width}px`);
  assert.equal(nine.boxH - nine.caption - nine.foot, 88);
  assert.ok(nine.foot >= 32, "two lines under the teams");
  assert.ok(nine.gutter >= 32 && nine.x(0) === nine.gutter, "a group label never sits under a box or at the frame's edge");
  const g = geometry({ cols: 3, rows: 2, groups: [] });
  assert.equal(g.gutter, 0);
  assert.equal(g.width, 3 * g.boxW + 2 * g.gap);
  const mid = g.y(0) + g.caption + 44;
  assert.equal(g.link({ col: 0, row: 0 }, { col: 1, row: 0.5 }), `M${g.boxW} ${mid}H${g.boxW + g.gap / 2}V${g.y(0.5) + g.caption + 44}H${g.boxW + g.gap}`);
  // The right half runs leftward, into the final's right edge.
  assert.match(g.link({ col: 2, row: 0 }, { col: 1, row: 0 }), new RegExp(`^M${2 * (g.boxW + g.gap)} .*H${2 * g.boxW + g.gap}$`));
});
