// A program's history (lib/program-history.ts) and the numbers behind its rating line (lib/line-chart.ts).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { lineChart, niceTicks } from "../lib/line-chart.ts";
import { opponentRecords, ratingSeries, seasonLine, seasonsWithGames, tally } from "../lib/program-history.ts";

const meet = (opponent, date, us, them, forfeit = false) => ({ opponent, date, us, them, forfeit });

test("tally counts the higher score as the win, equal scores as ties", () => {
  assert.deepEqual(tally([{ us: 40, them: 6 }, { us: 6, them: 40 }, { us: 0, them: 0 }, { us: 2, them: 0 }]), { won: 2, lost: 1, tied: 1 });
  assert.deepEqual(tally([]), { won: 0, lost: 0, tied: 0 });
});

test("opponentRecords: the record against each, most played first, then latest, then name; a forfeit counts and is marked", () => {
  const rows = opponentRecords([
    meet("Roby", "2021-10-01", 64, 22),
    meet("Roby", "2023-10-06", 20, 28),
    meet("Roby", "2025-10-03", 41, 41),
    meet("Aspermont", "2021-09-02", 45, 0),
    meet("Aspermont", "2022-09-02", 2, 0, true),
    meet("Wilson", "2024-09-09", 56, 0),
    meet("Benjamin", "2021-11-11", 52, 41),
  ]);
  assert.deepEqual(rows.map((r) => [r.opponent, r.games, r.won, r.lost, r.tied]), [
    ["Roby", 3, 1, 1, 1],
    ["Aspermont", 2, 2, 0, 0],
    ["Wilson", 1, 1, 0, 0], // met in 2024, after Benjamin in 2021
    ["Benjamin", 1, 1, 0, 0],
  ]);
  assert.equal(rows[0].last.date, "2025-10-03");
  assert.equal(rows[1].last.forfeit, true);
  assert.deepEqual(opponentRecords([]), []);
});

test("seasonLine: the ratings table's record and rating, else the games' record with no rating, else nothing", () => {
  const playoff = { round: "regional", league: "UIL" };
  const full = seasonLine({ season: 2025, row: { won: 10, lost: 2, tied: 0, rating: 31.4 }, meetings: [{ us: 1, them: 0 }], rank: 3, of: 40, playoff });
  assert.deepEqual(full, { season: 2025, games: 1, record: { won: 10, lost: 2, tied: 0 }, rating: 31.4, rank: 3, of: 40, playoff });
  // A team with too few games has a rating and a record but no rank.
  assert.equal(seasonLine({ season: 2024, row: { won: 1, lost: 1, tied: 0, rating: -2 }, meetings: [], of: 40 }).rank, null);
  // No table row: the record comes from the games, and there is no rating or rank to guess.
  const noRow = seasonLine({ season: 2023, meetings: [{ us: 7, them: 0 }, { us: 0, them: 7 }, { us: 3, them: 0 }], rank: 5, of: 40 });
  assert.deepEqual([noRow.record, noRow.rating, noRow.rank, noRow.playoff], [{ won: 2, lost: 1, tied: 0 }, null, null, null]);
  // Nothing at all: every figure is null, so the page shows dashes.
  const none = seasonLine({ season: 2022, meetings: [], of: 40 });
  assert.deepEqual([none.games, none.record, none.rating, none.rank], [0, null, null, null]);
});

test("ratingSeries is oldest first and keeps the gaps", () => {
  const lines = [2025, 2024, 2023].map((season, i) => seasonLine({ season, row: i === 1 ? undefined : { won: 1, lost: 0, tied: 0, rating: 10 + i }, meetings: [], of: 1 }));
  assert.deepEqual(ratingSeries(lines), [{ season: 2023, rating: 12 }, { season: 2024, rating: null }, { season: 2025, rating: 10 }]);
});

test("niceTicks covers the range with round values, and never collapses on a flat series", () => {
  assert.deepEqual(niceTicks(-3, 41), [-20, 0, 20, 40, 60]);
  const flat = niceTicks(12, 12);
  assert.ok(flat.length >= 2 && flat[0] < 12 && flat.at(-1) > 12);
  assert.deepEqual(niceTicks(0, 100), [0, 25, 50, 75, 100]);
});

test("lineChart: a gap breaks the line, every known point gets a dot, zero is drawn only when inside", () => {
  const box = { width: 400, height: 170, left: 56, right: 16, top: 12, bottom: 30 };
  const c = lineChart(
    [{ x: 2021, y: 15 }, { x: 2022, y: null }, { x: 2023, y: 20 }, { x: 2024, y: 30 }, { x: 2025, y: null }, { x: 2026, y: 18 }],
    box,
  );
  assert.equal(c.runs.length, 1); // 2023-2024; the points either side of a gap stand alone as dots
  assert.equal(c.dots.length, 4);
  assert.equal(c.xTicks.length, 6);
  assert.equal(c.xTicks[0].cx, 56);
  assert.equal(c.xTicks.at(-1).cx, 384);
  assert.ok(c.zeroY === null, "all ratings are above zero and the first tick is above it too");
  const below = lineChart([{ x: 2021, y: -8 }, { x: 2022, y: 14 }], box);
  assert.ok(below.zeroY !== null && below.zeroY > below.plot.top && below.zeroY < below.plot.bottom);
  // Higher ratings sit higher on the page (smaller y).
  assert.ok(below.dots[1].cy < below.dots[0].cy);
  assert.equal(below.runs.length, 1);
});

test("the history is drawn on the server: no client component in the page, the line or the lists", () => {
  for (const file of ["../app/programs/season-ratings.tsx", "../app/programs/[slug]/page.tsx", "../lib/program-seasons.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /^\s*["']use client["']/m, file);
  }
});

test("seasonsWithGames: the seasons a school has a game in, newest first; none for a school with no game", () => {
  const teams = new Map([
    [2021, new Set(["Jayton", "Roby"])],
    [2023, new Set(["Roby"])],
    [2025, new Set(["Jayton"])],
  ]);
  assert.deepEqual(seasonsWithGames("Jayton", teams), [2025, 2021]);
  assert.deepEqual(seasonsWithGames("Roby", teams), [2023, 2021]);
  assert.deepEqual(seasonsWithGames("Dell City", teams), []);
});
