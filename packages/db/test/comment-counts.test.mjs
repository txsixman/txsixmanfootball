import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLive } from "../load.mjs";
import { as, asFan, db, fan, KEYS, sudo } from "./posts-helpers.mjs";

// comment_counts (migration 0029, ADR 0077): the public count of visible comments for up to 200 game keys, under the same
// visibility rule as list_comments (migration 0013): hidden posts and banned authors' posts are never counted.
const counts = async (d, keys) => (await d.query("select * from comment_counts($1)", [keys])).rows;
const post = (d, author, key, n = 1) =>
  sudo(d, `insert into post (author_id, game_key, body) select $1, $2, 'Comment ' || i from generate_series(1, $3) i`, [author, key, n]);

test("counts the visible comments of each key, only keys with at least one, in key order", async () => {
  const d = await db();
  const a = await fan(d, "Counting Fan");
  await asFan(d, a);
  await d.query("select add_comment($1, 'First')", [KEYS.playoff]);
  await d.query("select add_comment($1, 'Second')", [KEYS.playoff]);
  await d.query("select add_comment($1, 'Third')", [KEYS.regular]);
  await as(d, "anon");
  assert.deepEqual(await counts(d, [KEYS.playoff, KEYS.regular, KEYS.played]), [
    { game_key: KEYS.regular, comments: 1 },
    { game_key: KEYS.playoff, comments: 2 },
  ]);
});

test("a hidden post and a banned fan's posts are not counted, exactly as list_comments leaves them out; a muted fan's still counts", async () => {
  const d = await db();
  const [shown, quiet, banned] = [await fan(d, "Shown Fan"), await fan(d, "Quiet Fan", { muted: true }), await fan(d, "Banned Fan")];
  await post(d, shown, KEYS.playoff, 3);
  await post(d, quiet, KEYS.playoff);
  await post(d, banned, KEYS.playoff, 2);
  await post(d, banned, KEYS.regular);
  await sudo(d, "update post set hidden_at = now() where id = (select id from post where author_id = $1 and game_key = $2 order by created_at, id limit 1)", [shown, KEYS.playoff]);
  await sudo(d, "update profile set banned = true where user_id = $1", [banned]);
  await as(d, "anon");
  const [{ comments }] = await counts(d, [KEYS.playoff]);
  assert.equal(comments, 3);
  assert.equal((await d.query("select count(*)::int as n from list_comments($1)", [KEYS.playoff])).rows[0].n, comments, "the same number list_comments shows");
  assert.deepEqual(await counts(d, [KEYS.regular]), [], "a game with only a banned fan's comment has none");
  // The ban lifted: those comments count again, as list_comments shows them again.
  await sudo(d, "update profile set banned = false where user_id = $1", [banned]);
  await as(d, "anon");
  assert.deepEqual(await counts(d, [KEYS.playoff, KEYS.regular]), [
    { game_key: KEYS.regular, comments: 1 },
    { game_key: KEYS.playoff, comments: 5 },
  ]);
});

test("unknown keys, duplicates, nulls, an empty list and no list answer without error", async () => {
  const d = await db();
  await post(d, await fan(d, "Some Fan"), KEYS.playoff, 2);
  await as(d, "anon");
  assert.deepEqual(await counts(d, [KEYS.playoff, KEYS.playoff, null, "no-such-game-key"]), [{ game_key: KEYS.playoff, comments: 2 }]);
  assert.deepEqual(await counts(d, ["no-such-game-key"]), []);
  assert.deepEqual(await counts(d, []), []);
  assert.deepEqual(await counts(d, null), []);
});

test("only the first 200 keys are looked at; the rest are ignored", async () => {
  const d = await db();
  const a = await fan(d, "Cap Fan");
  const keys = Array.from({ length: 201 }, (_, i) => `2026-cap-test-game-${String(i).padStart(3, "0")}`);
  await post(d, a, keys[0]);
  await post(d, a, keys[199]);
  await post(d, a, keys[200]);
  await as(d, "anon");
  assert.deepEqual(await counts(d, keys), [
    { game_key: keys[0], comments: 1 },
    { game_key: keys[199], comments: 1 },
  ]);
  assert.deepEqual(await counts(d, [keys[200]]), [{ game_key: keys[200], comments: 1 }], "it is the 201st position that is dropped, not the key");
});

test("anon and a signed-in fan can run it; it returns only a key and a number; the live role check lists it as allowed", async () => {
  const d = await db();
  const a = await fan(d, "Reader Fan");
  await post(d, a, KEYS.playoff);
  await as(d, "anon");
  const rows = await counts(d, [KEYS.playoff]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["comments", "game_key"]);
  await asFan(d, a);
  assert.equal((await counts(d, [KEYS.playoff]))[0].comments, 1);
  await d.exec("reset role");
  assert.deepEqual(await checkLive(d), []);
  assert.equal((await d.query("select has_function_privilege('public', 'comment_counts(text[])', 'execute') as p")).rows[0].p, false);
  assert.match((await d.query("select pg_get_functiondef('comment_counts(text[])'::regprocedure) as def")).rows[0].def, /SET search_path TO 'public', 'pg_temp'/);
});
