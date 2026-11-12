import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const dir = new URL("../migrations/", import.meta.url);
let db, home, away, otherSeason;

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const teamSeason = async (slug, season) => {
  const program = await one("insert into program (slug) values ($1) returning id", [slug]);
  const row = await one(
    "insert into team_season (program_id, season, league, format) values ($1, $2, 'TEST', 6) returning id",
    [program.id, season],
  );
  return row.id;
};
const newGame = () =>
  one("insert into game (season, home_ts, away_ts) values (2026, $1, $2) returning id", [home, away]);

before(async () => {
  db = new PGlite();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  home = await teamSeason("test-home", 2026);
  away = await teamSeason("test-away", 2026);
  otherSeason = await teamSeason("test-other", 2025);
});

test("every table has row-level security", async () => {
  const { rows } = await db.query(
    "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
  );
  assert.deepEqual(rows, []);
});

test("a program can have two predecessors", async () => {
  const [a, b, c] = await Promise.all(
    ["merge-a", "merge-b", "merge-c"].map((slug) =>
      one("insert into program (slug) values ($1) returning id", [slug]),
    ),
  );
  const source = await one("insert into source_document (url, retrieved_on) values ('https://x.test/merge', '2026-11-10') returning id");
  for (const predecessor of [a, b]) {
    await db.query(
      "insert into program_lineage (predecessor_id, successor_id, event, season, source_document_id) values ($1, $2, 'consolidation', 2020, $3)",
      [predecessor.id, c.id, source.id],
    );
  }
  await assert.rejects(
    db.query("insert into program_lineage (predecessor_id, successor_id, event, season) values ($1, $2, 'rename', 2021)", [c.id, a.id]),
    /source_document_id/,
    "a lineage row must cite a source",
  );
  const row = await one("select count(*)::int as n from program_lineage where successor_id = $1", [c.id]);
  assert.equal(row.n, 2);
});

test("a final needs an end reason and both scores", async () => {
  const game = await newGame();
  await assert.rejects(db.query("update game set status = 'final', home_score = 50, away_score = 0 where id = $1", [game.id]), /final_is_complete/);
  await db.query(
    "update game set status = 'final', end_reason = 'mercy_half', home_score = 50, away_score = 0 where id = $1",
    [game.id],
  );
});

test("an end reason is refused before the game is final", async () => {
  const game = await newGame();
  await assert.rejects(db.query("update game set end_reason = 'regulation' where id = $1", [game.id]), /end_reason_only_on_final/);
});

test("extreme real scores are not blocked by the database", async () => {
  const game = await newGame();
  await db.query(
    "update game set status = 'final', end_reason = 'regulation', home_score = 99, away_score = 98 where id = $1",
    [game.id],
  );
});

test("a team cannot play itself", async () => {
  await assert.rejects(db.query("insert into game (season, home_ts, away_ts) values (2026, $1, $1)", [home]), /check/);
});

test("a game's teams must belong to its season", async () => {
  await assert.rejects(
    db.query("insert into game (season, home_ts, away_ts) values (2026, $1, $2)", [home, otherSeason]),
    /foreign key/,
  );
});

test("the same submission key is stored once", async () => {
  const game = await newGame();
  const insert = "insert into score_submission (game_id, channel, payload, weight, idempotency_key) values ($1, 'reporter_app', '{}', 0.7, 'k1')";
  await db.query(insert, [game.id]);
  await assert.rejects(db.query(insert, [game.id]), /unique/);
});

test("score submissions can change status but are never deleted", async () => {
  const game = await newGame();
  const row = await one(
    "insert into score_submission (game_id, channel, payload, weight) values ($1, 'sms', '{}', 0.15) returning id",
    [game.id],
  );
  await db.query("update score_submission set status = 'confirmed' where id = $1", [row.id]);
  await assert.rejects(db.query("delete from score_submission where id = $1", [row.id]), /cannot be changed/);
  await assert.rejects(db.exec("truncate score_submission"), /cannot be changed/);
});

test("the audit log is append-only", async () => {
  const row = await one("insert into audit_log (entity, reason) values ('game', 'test') returning id");
  await assert.rejects(db.query("update audit_log set reason = 'x' where id = $1", [row.id]), /cannot be changed/);
  await assert.rejects(db.query("delete from audit_log where id = $1", [row.id]), /cannot be changed/);
  await assert.rejects(db.exec("truncate audit_log"), /cannot be changed/);
});
