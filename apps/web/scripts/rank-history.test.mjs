// A team's season week by week and the biggest movers (lib/rank-history.ts, ADR 0091).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { biggestMovers, historySummary, rankChart, rankMatrix, weekLabel } from "../lib/rank-history.ts";

const team = (name, trend, rated_trend) => ({ team: name, trend, rated_trend });
const table = {
  weeks: ["2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"],
  teams: [
    team("A", [10, 20, 30, 40], [1, 2, 3, 4]),
    team("B", [30, 25, 20, 15], [1, 2, 3, 4]),
    team("C", [null, 50, 45, 60], [0, 1, 2, 4]), // first rated in week 2, ranked only from week 4
    team("Other", [99, 99, 99, 99], [4, 4, 4, 4]), // another organization
  ],
};
const few = 4;

test("a rank counts only teams with enough rated games that week, and only the group's own", () => {
  const m = rankMatrix(table, (t) => t !== "Other", few);
  assert.deepEqual(m.get("A").map((p) => [p.rank, p.of]), [[null, 0], [null, 0], [null, 0], [2, 3]]);
  assert.deepEqual(m.get("C").map((p) => [p.week, p.rank]), [["2026-09-20", null], ["2026-09-27", null], ["2026-10-04", 1]]);
  assert.equal(m.get("C")[0].rating, 50); // a rating is kept while the team is not ranked
  assert.equal(m.has("Other"), false);
});

test("the chart's text alternative gives the first, last and best, for rank and rating", () => {
  const points = [
    { week: "2026-09-13", rating: 5, rank: null, of: 3 },
    { week: "2026-09-20", rating: 12, rank: 9, of: 30 },
    { week: "2026-09-27", rating: 20.04, rank: 4, of: 30 },
    { week: "2026-10-04", rating: 15, rank: 6, of: 30 },
  ];
  assert.equal(
    historySummary(points, "UIL"),
    "Rank in UIL from #9 in the week of Sep 14 to #6 in the week of Sep 28; best #4. Rating from +5.0 in the week of Sep 7 to +15.0 in the week of Sep 28; highest +20.0. Zero is an average team.",
  );
  // A week is named by its Monday, never as "ending" on a Sunday that may not have come yet (a week still being played).
  assert.doesNotMatch(historySummary(points, "UIL"), /ending/);
  assert.match(historySummary(points.map((p) => ({ ...p, rank: null })), "UIL"), /^Not ranked in UIL in any of these weeks\. Rating from/);
});

test("a week is labelled by its Monday, across a month or year change", () => {
  assert.equal(weekLabel("2026-11-22"), "Nov 16"); // the Sunday after Nov 21: the week of Nov 16
  assert.equal(weekLabel("2026-11-01"), "Oct 26");
  assert.equal(weekLabel("2027-01-03"), "Dec 28");
});

test("rankChart puts 1 at the top, breaks the line where a week has no rank, and pads the axis", () => {
  const box = { width: 400, height: 94, left: 52, right: 14, top: 8, bottom: 8 };
  const c = rankChart([{ x: 0, y: 9 }, { x: 1, y: 4 }, { x: 2, y: null }, { x: 3, y: 6 }, { x: 4, y: 5 }], box);
  assert.equal(c.runs.length, 2); // 0 to 1, then 3 to 4; the lone week between is a gap
  const y = (rank) => c.dots.find((d) => d.rank === rank).cy;
  assert.ok(y(4) < y(5) && y(5) < y(6) && y(6) < y(9)); // a better rank is higher up the drawing
  assert.ok(c.yTicks[0].rank <= 4 && c.yTicks[1].rank >= 9 && c.yTicks[0].rank >= 1);
  const one = rankChart([{ x: 0, y: 3 }, { x: 1, y: 3 }], box); // a team that never moved still gets a drawable axis
  assert.ok(one.yTicks[1].rank > one.yTicks[0].rank);
});

test("biggest movers: risers and fallers by places, steady and new teams in neither, at most n", () => {
  // `ranked` best first; `moved` is lib/ratings.ts movement(): places gained, 0 for steady, "new" for a team unrated a week ago.
  const row = (t, rating, was) => ({ team: t, rating, was });
  const ranked = [row("Up", 80, 60), row("Steady", 70, 69), row("Down", 60, 85), row("Mid", 50, 40), row("Fresh", 40, null), row("Slip", 30, 45)];
  const moved = new Map([["Up", 2], ["Steady", 0], ["Down", -2], ["Mid", 1], ["Fresh", "new"], ["Slip", -1]]);
  const { risers, fallers } = biggestMovers(ranked, moved);
  assert.deepEqual(risers.map((m) => [m.team, m.place, m.before, m.places]), [["Up", 1, 3, 2], ["Mid", 4, 5, 1]]);
  assert.deepEqual(fallers.map((m) => [m.team, m.place, m.before, m.places]), [["Down", 3, 1, -2], ["Slip", 6, 5, -1]]);
  assert.equal(risers[0].change, 20);
  assert.deepEqual(biggestMovers(ranked, undefined), { risers: [], fallers: [] }); // no week-earlier ratings: nothing to say
  assert.equal(biggestMovers(ranked, moved, 1).risers.length, 1);
  // Two teams that gained the same places: the bigger rating rise goes first, then the name.
  const tie = biggestMovers([row("B", 60, 50), row("A", 55, 40), row("C", 50, 45)], new Map([["B", 1], ["A", 1], ["C", 0]]));
  assert.deepEqual(tie.risers.map((m) => m.team), ["A", "B"]);
});
