import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN, as, asFan, db, fan, KEYS, sudo } from "./posts-helpers.mjs";

// The owner's list of recent posts (migration 0032, ADR 0084): every post still showing from the last 7 days, newest first, so
// one nobody reported can be hidden. Admin-only and read-only.
const comment = (d, text, key = KEYS.playoff) => d.query("select add_comment($1, $2) as id", [key, text]).then((r) => r.rows[0].id);
const recent = async (d) => (await d.query("select admin_recent_posts() as l")).rows[0].l;

test("the owner sees the newest posts still showing, unreported ones included, and can hide one; a fan or anon cannot read it", async () => {
  const d = await db();
  const one = await fan(d, "First Poster");
  const two = await fan(d, "Second Poster");
  await asFan(d, one);
  const older = await comment(d, "an ordinary comment");
  await asFan(d, two);
  const newer = await comment(d, "rude but on no list, and nobody reports it");
  await sudo(d, "update post set created_at = now() - interval '1 minute' where id = $1", [older]);

  await asFan(d, two);
  await assert.rejects(recent(d), /admin_only/);
  await as(d, "anon");
  await assert.rejects(recent(d), /permission denied/);

  await asFan(d, ADMIN);
  const list = await recent(d);
  assert.deepEqual(list.map((p) => p.id), [newer, older]);
  assert.deepEqual(Object.keys(list[0]).sort(), ["author", "author_id", "body", "created_at", "flags", "game_key", "id", "thread_id", "title"]);
  assert.deepEqual([list[0].author, list[0].author_id, list[0].flags, list[0].game_key], ["Second Poster", two, 0, KEYS.playoff]);
  assert.doesNotMatch(JSON.stringify(list), /birth|email|@/);

  await d.query("select admin_hide_post($1, 'rude')", [newer]);
  assert.deepEqual((await recent(d)).map((p) => p.id), [older]);
});

test("a post older than 7 days, a hidden post and a banned author's post are left out; at most 100, newest first", async () => {
  const d = await db();
  const f = await fan(d, "Busy Poster");
  const banned = await fan(d, "Banned Poster");
  await asFan(d, banned);
  await comment(d, "from someone about to be banned");
  await asFan(d, ADMIN);
  await d.query("select admin_set_ban($1, true, 'x')", [banned]);
  // 103 posts straight into the table (the per-day limit would stop one account at 30): post i is 102 - i minutes old, the first 8 days.
  const ids = (
    await sudo(
      d,
      "insert into post (author_id, game_key, body, created_at) select $1, $2, 'comment ' || i, now() - make_interval(mins => 102 - i) from generate_series(0, 102) i returning id, body",
      [f, KEYS.playoff],
    )
  ).rows.sort((a, b) => Number(a.body.split(" ")[1]) - Number(b.body.split(" ")[1])).map((r) => r.id);
  await sudo(d, "update post set created_at = now() - interval '8 days' where id = $1", [ids[0]]);
  await asFan(d, ADMIN);
  const list = await recent(d);
  assert.equal(list.length, 100);
  assert.equal(list[0].id, ids[102]);
  assert.ok(!list.some((p) => p.id === ids[0]), "8 days old");
  assert.ok(!list.some((p) => p.author === "Banned Poster"));
});
