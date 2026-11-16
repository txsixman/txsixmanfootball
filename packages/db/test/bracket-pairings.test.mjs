import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, loadBracketPairings } from "../load.mjs";
import { as, asFan, cool, db, fan, KEYS, sudo } from "./posts-helpers.mjs";

// Comments on bracket-set games (migration 0030, ADR 0079): add_comment takes a key resolve_game_key does not know when it
// is a stored playoff game the other way round, or a bracket-set pairing no listing has yet. Score reports still need the
// stored game in its stored order.
const comment = (d, key, text = "Big game Friday") => d.query("select add_comment($1, $2) as id", [key, text]).then((r) => r.rows[0].id);
const swapped = "2026-bi-district-alpha-at-beta"; // KEYS.playoff with home and away reversed
const pairings = async (d, season = 2026) => (await sudo(d, "select game_key from bracket_pairing where season = $1 order by 1", [season])).rows.map((r) => r.game_key);

test("a stored playoff game takes comments under its page key in either order; made-up and regular-season keys are still refused", async () => {
  const d = await db();
  await asFan(d, await fan(d, "Bobcat Fan"));
  await comment(d, KEYS.playoff);
  await comment(d, swapped);
  for (const key of ["2026-bi-district-gamma-at-alpha", "2026-area-beta-at-alpha", "2025-bi-district-alpha-at-beta", "2026-09-04-alpha-at-beta", "2026-bi-district-alpha-at-beta'--"]) {
    await assert.rejects(comment(d, key), /unknown_game/, key);
  }
});

test("a bracket-set pairing takes comments only while it is in bracket_pairing", async () => {
  const d = await db();
  await asFan(d, await fan(d, "Bobcat Fan"));
  const key = "2026-area-gamma-at-delta";
  await assert.rejects(comment(d, key), /unknown_game/);
  await sudo(d, "insert into bracket_pairing (season, game_key) values (2026, $1)", [key]);
  await asFan(d, (await sudo(d, "select user_id from profile")).rows[0].user_id);
  await comment(d, key);
  await sudo(d, "delete from bracket_pairing");
  await asFan(d, (await sudo(d, "select user_id from profile")).rows[0].user_id);
  await assert.rejects(comment(d, key), /unknown_game/);
});

test("score reports keep the database's order: a swapped key and a bracket-set key are refused", async () => {
  const d = await db();
  await sudo(d, "update game set game_date = current_date - 1 where playoff_round = 'bi-district'");
  await sudo(d, "insert into bracket_pairing (season, game_key) values (2026, '2026-area-gamma-at-delta')");
  await asFan(d, await fan(d, "Old Fan"));
  for (const key of [swapped, "2026-area-gamma-at-delta"]) {
    await assert.rejects(d.query("select submit_score_report($1, 21, 14)", [key]), /unknown_game/, key);
    assert.equal((await d.query("select * from fan_score_status($1)", [key])).rows[0]?.reports ?? 0, 0, key);
  }
  await d.query("select submit_score_report($1, 21, 14)", [KEYS.playoff]);
  await cool(d);
});

test("the pairing load stores both orders of each bracket-set game of the committed 2026 data, and replaces the season's rows", async () => {
  const d = await db({ games: false });
  const out = await loadBracketPairings(d);
  assert.equal(out.season, 2026);
  assert.ok(out.pairings >= 19, `only ${out.pairings} pairings`);
  assert.equal(out.keys, out.pairings * 2);
  const keys = await pairings(d);
  assert.equal(keys.length, out.keys);
  // A UIL area game in both orders, and one whose bracket order is the reverse of its listing's.
  for (const k of ["2026-area-hermleigh-at-nazareth", "2026-area-nazareth-at-hermleigh", "2026-area-oglesby-at-gilmer-union-hill", "2026-area-gilmer-union-hill-at-oglesby"]) {
    assert.ok(keys.includes(k), k);
  }
  assert.ok(keys.some((k) => k.startsWith("2026-final-")), "a TAPPS or TCAF final, closed from its semifinals");
  // A row for another season stays; a pairing the bracket no longer sets (a stale row) goes on the next load.
  await sudo(d, "insert into bracket_pairing (season, game_key) values (2025, '2025-area-old-at-news'), (2026, '2026-area-stale-at-pairing')");
  assert.deepEqual(await loadBracketPairings(d), out);
  const after = await pairings(d);
  assert.deepEqual(after, keys);
  assert.deepEqual(await pairings(d, 2025), ["2025-area-old-at-news"]);
  // And fans can comment on them through add_comment.
  await asFan(d, await fan(d, "Bobcat Fan"));
  await comment(d, "2026-area-hermleigh-at-nazareth");
  await comment(d, "2026-area-nazareth-at-hermleigh", "Another view");
});

test("without the table (the per-read load runs no migrations) the pairing load says so and never throws", async () => {
  const out = await loadBracketPairings(new PGlite());
  assert.equal(out.season, 2026);
  assert.match(out.skipped, /migration 0030/);
});

test("bracket_pairing is closed to the API roles, and so is the helper", async () => {
  const d = await db({ games: false });
  await loadBracketPairings(d);
  await asFan(d, await fan(d, "Bobcat Fan"));
  for (const role of ["authenticated", "anon"]) {
    await as(d, role, "");
    await assert.rejects(d.query("select * from bracket_pairing"), /permission denied/, role);
    await assert.rejects(d.exec("insert into bracket_pairing (season, game_key) values (2026, '2026-area-aa-at-bb')"), /permission denied/, role);
    await assert.rejects(d.exec("delete from bracket_pairing"), /permission denied/, role);
    await assert.rejects(d.query("select comment_game_known('2026-area-aa-at-bb')"), /permission denied/, role);
  }
  await d.exec("reset role");
  assert.equal((await d.query("select relrowsecurity from pg_class where relname = 'bracket_pairing'")).rows[0].relrowsecurity, true);
  assert.deepEqual(await checkLive(d), []);
});
