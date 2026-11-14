// Standings by level (lib/standings-levels.ts, ADR 0048): the bi-district pair rule against UIL's 2026-28 alignment PDFs,
// and the grouping into areas and regions. Invented schools for the grouping; the real alignment file for the pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { areaPair, levelsOf, ranked, regionsOf } from "../lib/standings-levels.ts";

// The bi-district pairs in the 2026-28 PDFs, Division I and Division II alike: W1 v R2 and W2 v R1, and so on.
const PDF_PAIRS = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16]];

test("a district's area is its bi-district crossover pair, as the 2026-28 PDFs pair them", () => {
  for (const [a, b] of PDF_PAIRS) {
    assert.deepEqual(areaPair(a), [a, b]);
    assert.deepEqual(areaPair(b), [a, b]);
  }
  assert.throws(() => areaPair(0));
  assert.throws(() => areaPair(1.5));
});

test("in the 2026-28 UIL alignment, both districts of every pair are in one region, four districts a region", () => {
  const rows = readFileSync(new URL("../../../data/seed/uil-2026-28/alignments.csv", import.meta.url), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  for (const division of ["I", "II"]) {
    const regionOf = new Map(rows.filter((r) => r[1] === division).map((r) => [Number(r[3]), r[2]]));
    assert.deepEqual([...regionOf.keys()].sort((a, b) => a - b), PDF_PAIRS.flat(), `Division ${division}: districts 1 to 16`);
    for (const [a, b] of PDF_PAIRS) assert.equal(regionOf.get(a), regionOf.get(b), `Division ${division}: districts ${a} and ${b}`);
    for (const [d, region] of regionOf) assert.equal(region, String(Math.ceil(d / 4)), `Division ${division}: district ${d} is in Region ${Math.ceil(d / 4)}`);
  }
});

const rec = (won, lost, tied = 0) => ({ won, lost, tied });
const team = (school, region, district, overall, pf, pa) => ({ school: { school, region, district, league: "UIL", division: "I", slug: school.toLowerCase() }, district: rec(0, 0), overall, pointsFor: pf, pointsAgainst: pa });
const districtOf = (region, district, rows, districtPlay = true) => ({ key: `UIL Division I|${district}`, title: "", league: "UIL", division: "I", districtPlay, rows });

test("areas and regions: every team of their districts, by overall win %, then point difference", () => {
  const d1 = districtOf("1", "1", [team("Cedar Gap", "1", "1", rec(8, 1), 400, 100), team("Salt Fork", "1", "1", rec(4, 5), 200, 300)]);
  const d2 = districtOf("1", "2", [team("Dry Wash", "1", "2", rec(8, 1), 450, 100), team("Mesa Verde", "1", "2", rec(1, 8), 80, 400)]);
  const d3 = districtOf("1", "3", [team("Far Hill", "1", "3", rec(9, 0), 500, 90)]);
  const d5 = districtOf("2", "5", [team("Low Creek", "2", "5", rec(5, 4), 250, 250)]);
  assert.deepEqual(levelsOf([d1, d2, d3, d5]), ["district", "area", "region"]);
  const regions = regionsOf([d5, d3, d2, d1], "t");
  assert.deepEqual(regions.map((r) => r.label), ["Region 1", "Region 2"]);
  assert.deepEqual(regions[0].areas.map((a) => a.label), ["Region 1 · Area 1 (Districts 1–2)", "Region 1 · Area 2 (District 3)"], "a district whose pair has no teams stands alone");
  assert.deepEqual(regions[1].areas.map((a) => a.label), ["Region 2 · Area 1 (District 5)"]);
  // 8-1 and 8-1: the larger point difference first.
  assert.deepEqual(regions[0].areas[0].rows.map((r) => [r.school.school, r.districtNumber]), [["Dry Wash", "2"], ["Cedar Gap", "1"], ["Salt Fork", "1"], ["Mesa Verde", "2"]]);
  assert.deepEqual(regions[0].rows.map((r) => r.school.school), ["Far Hill", "Dry Wash", "Cedar Gap", "Salt Fork", "Mesa Verde"]);
  assert.deepEqual(regions[0].areas.map((a) => a.id), ["t-r1-a1", "t-r1-a2"]);
  assert.equal(ranked([d1]).length, 2);
});

test("only the levels an alignment holds: districts with no regions, regions with no districts", () => {
  const noRegion = districtOf("", "1", [team("Cedar Gap", "", "1", rec(1, 0), 10, 0)]);
  assert.deepEqual(levelsOf([noRegion]), ["district"]);
  const noDistricts = districtOf("North", "0", [team("Cedar Gap", "North", "0", rec(1, 0), 10, 0)], false);
  assert.deepEqual(levelsOf([noDistricts]), ["region"]);
  assert.deepEqual(levelsOf([]), ["district"]);
});
