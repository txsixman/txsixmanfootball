// The duplicate-game rule the reader, the site and check-data share (lib/duplicate-game.ts) gives the answers the ratings'
// rule (services/ratings/rows.py classify) is tested against: one shared table, so the two cannot drift.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NO_CORRECTIONS } from "../lib/corrections.ts";
import { duplicateRows } from "../lib/duplicate-game.ts";
import { buildSeasonResults } from "../lib/season-results.ts";

const { cases } = JSON.parse(readFileSync(new URL("../lib/duplicate-cases.json", import.meta.url), "utf8"));
const asRows = (rows) => rows.map(([game_date, home, away, hs, as]) => ({ game_date, home, away, home_score: String(hs), away_score: String(as) }));

for (const c of cases) {
  test(`shared case: ${c.name}`, () => {
    assert.deepEqual([...duplicateRows(asRows(c.rows)).keys()].sort(), c.duplicates);
  });
}

test("a copy names the row it copies; a row with no score is never a game, so never a copy", () => {
  const rows = asRows([["2021-09-10", "A", "B", 1, 2], ["2021-09-09", "A", "B", 1, 2]]);
  assert.deepEqual([...duplicateRows(rows)], [[0, 1]]);
  const unplayed = [{ game_date: "2026-09-04", home: "A", away: "B", home_score: "", away_score: "" }, { game_date: "2026-09-04", home: "A", away: "B", home_score: "", away_score: "" }];
  assert.equal(duplicateRows(unplayed).size, 0);
});

test("a season's results list a game listed twice once, so a team never lists more games than its record counts", () => {
  const text = [
    "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period",
    "I,season,2030-09-09,Happy,Earth,false,36,68,unknown,",
    "I,season,2030-09-10,Happy,Earth,false,36,68,unknown,",
    "I,season,2030-09-16,Happy,Kress,false,36,68,unknown,",
  ].join("\n");
  const key = (date, a, b) => [date, ...[a, b].sort()].join("|");
  const { results, duplicates } = buildSeasonResults(2030, text, NO_CORRECTIONS, new Map(), key);
  assert.deepEqual(results.map((r) => r.date), ["2030-09-09", "2030-09-16"]);
  assert.equal(duplicates, 1);
});
