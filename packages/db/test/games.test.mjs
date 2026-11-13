import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { scoreFlags } from "../../core/six-man.mjs";
import { parseGames, seedGames } from "../games.mjs";
import { seedAlignments } from "../seed.mjs";

const dir = new URL("../migrations/", import.meta.url);
const HEADER = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
const SRC = "https://example.test/bracket";
const opts = { season: 2026, retrievedOn: "2026-11-14", reason: "test" };
const csv = (...lines) => [HEADER, ...lines].join("\n");
let db;

const game = async () => (await db.query("select * from game")).rows;

before(async () => {
  db = new PGlite();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  const rows = ["Alpha", "Beta"].map((school) => ({
    league: "TEST", division: "I", district: "1", school, source_url: SRC,
  }));
  await seedAlignments(db, rows, { seasons: [2026], retrievedOn: "2026-11-10", reason: "test" });
});

test("a scheduled game loads without a score, then gains one on re-import", async () => {
  await seedGames(db, parseGames(csv(`I,bi-district,2026-11-13,Alpha,Beta,true,,,,,${SRC},`)), opts);
  assert.equal((await game())[0].status, "scheduled");

  const result = await seedGames(db, parseGames(csv(`I,bi-district,2026-11-13,Alpha,Beta,true,50,0,mercy_half,2,${SRC},`)), opts);
  assert.deepEqual(result, { inserted: 0, updated: 1, unchanged: 0, flags: [] });
  const [row] = await game();
  assert.equal(row.status, "final");
  assert.equal(row.home_score, 50);
  assert.ok(row.source_document_id);
});

test("a suspicious score is stored and reported, not blocked", async () => {
  const result = await seedGames(db, parseGames(csv(`I,area,2026-11-20,Beta,Alpha,true,60,10,regulation,,${SRC},`)), opts);
  assert.equal(result.inserted, 1);
  assert.deepEqual(result.flags.map((f) => f.code), ["margin_45_without_mercy_end"]);
});

test("an unknown team stops the whole import", async () => {
  const lines = csv(`I,regional,2026-11-27,Alpha,Beta,true,,,,,${SRC},`, `I,regional,2026-11-27,Alpha,Gamma,true,,,,,${SRC},`);
  await assert.rejects(seedGames(db, parseGames(lines), opts), /unknown team for 2026: Gamma/);
  const rows = await db.query("select 1 from game where playoff_round = 'regional'");
  assert.equal(rows.rows.length, 0);
});

test("a final with no end reason is refused", async () => {
  await assert.rejects(
    seedGames(db, parseGames(csv(`I,semifinal,2026-12-04,Alpha,Beta,true,40,30,,,${SRC},`)), opts),
    /final_is_complete/,
  );
});

test("a comma in the notes is refused with a clear message", () => {
  assert.throws(() => parseGames(csv(`I,area,2026-11-20,Alpha,Beta,true,,,,,${SRC},one, two`)), /commas are not allowed/);
});

const flags = (home, away, endReason, periods) => scoreFlags({ home, away, endReason, periods });

test("six-man checks follow Appendix B", () => {
  assert.deepEqual(flags(50, 0, "mercy_half"), []);
  assert.deepEqual(flags(1, 0, "forfeit"), []);
  assert.deepEqual(flags(5, 0, "regulation"), ["rare_score"]);
  assert.deepEqual(flags(50, 0, "regulation"), ["margin_45_without_mercy_end"]);
  assert.deepEqual(flags(60, 10, "unknown"), []);
  assert.deepEqual(flags(50, 0, "mercy_2h"), []);
  assert.deepEqual(flags(52, 0, "mercy_2h"), ["second_half_margin_above_50"]);
  assert.deepEqual(flags(30, 0, "mercy_half"), ["mercy_end_below_45"]);
  assert.deepEqual(flags(99, 76, "regulation"), ["extreme_total"]);
});

test("quarter scores must add up to the final", () => {
  const periods = [{ home: 14, away: 8 }, { home: 6, away: 0 }];
  assert.deepEqual(flags(20, 8, "regulation", periods), []);
  assert.deepEqual(flags(21, 8, "regulation", periods), ["quarters_do_not_sum"]);
});

test("a regular-season game has no type or round, and is matched on its date when read again", async () => {
  const line = (score) => csv(`I,season,2026-09-04,Beta,Alpha,false,${score},unknown,,${SRC},`);
  assert.deepEqual(await seedGames(db, parseGames(line("28,22")), opts), { inserted: 1, updated: 0, unchanged: 0, flags: [] });
  assert.deepEqual(await seedGames(db, parseGames(line("28,20")), opts), { inserted: 0, updated: 1, unchanged: 0, flags: [] });
  const rows = (await db.query("select * from game where game_date = '2026-09-04'")).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].game_type, rows[0].playoff_round, rows[0].away_score], [null, null, 20]);
  const later = csv(`I,season,2026-10-16,Alpha,Beta,false,7,6,unknown,,${SRC},`);
  assert.equal((await seedGames(db, parseGames(later), opts)).inserted, 1); // a rematch is a second game
});

test("a 0-0 final is no score: a file row loads unplayed, and one stored by an earlier load is blanked", async () => {
  const at = (date) => db.query("select status, home_score, away_score, end_reason from game where game_date = $1", [date]).then((r) => r.rows);
  // Read now: a 0-0 row with a result loads as not yet played.
  await seedGames(db, parseGames(csv(`I,season,2026-10-23,Alpha,Beta,false,0,0,unknown,,${SRC},`)), opts);
  assert.deepEqual(await at("2026-10-23"), [{ status: "scheduled", home_score: null, away_score: null, end_reason: null }]);
  // Stored by an earlier load as a 0-0 final (here, a 7-7 game set to 0-0): the next load blanks it, though its file
  // no longer lists it; a real tie and a 0-0 forfeit stay.
  await seedGames(db, parseGames(csv(`I,season,2026-10-30,Beta,Alpha,false,7,7,unknown,,${SRC},`, `I,season,2026-10-31,Alpha,Beta,false,7,7,unknown,,${SRC},`, `I,season,2026-11-01,Alpha,Beta,false,7,7,unknown,,${SRC},`)), opts);
  await db.query("update game set home_score = 0, away_score = 0 where game_date in ('2026-10-30', '2026-11-01')");
  await db.query("update game set end_reason = 'forfeit' where game_date = '2026-11-01'");
  const result = await seedGames(db, parseGames(csv(`I,season,2026-10-31,Alpha,Beta,false,7,7,unknown,,${SRC},`)), opts);
  assert.deepEqual([result.updated, result.unchanged], [1, 1]);
  assert.deepEqual(await at("2026-10-30"), [{ status: "scheduled", home_score: null, away_score: null, end_reason: null }]);
  assert.deepEqual(await at("2026-10-31"), [{ status: "final", home_score: 7, away_score: 7, end_reason: "unknown" }]);
  assert.deepEqual(await at("2026-11-01"), [{ status: "final", home_score: 0, away_score: 0, end_reason: "forfeit" }]);
});
