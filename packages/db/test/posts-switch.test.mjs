import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLive } from "../load.mjs";
import { as, asFan, db, fan, KEYS, sudo } from "./posts-helpers.mjs";

// The posts switch (migration 0024, ADR 0052): the database refuses every posting function while the switch is closed,
// whatever route the call came by, because a signed-in fan can call Supabase's functions without going through the site.
const refused = /posts_closed/;

async function closedDb() {
  const d = await db({ posts: false });
  await sudo(d, "update game set game_date = current_date - 1 where playoff_round = 'bi-district'");
  return d;
}

test("a fresh database has the posts switch closed, and an old fan with a profile still cannot post", async () => {
  const d = await closedDb();
  assert.deepEqual((await d.query("select name, is_on from site_switch where name = 'posts'")).rows, [{ name: "posts", is_on: false }]);
  const old = await fan(d, "Old Fan");
  const second = await fan(d, "Second Fan");
  await asFan(d, old);
  await assert.rejects(d.query("select add_comment($1, 'hello')", [KEYS.playoff]), refused);
  await assert.rejects(d.query("select create_thread('general', 'A title', 'A body')"), refused);
  await assert.rejects(d.query("select reply_to_thread('00000000-0000-4000-8000-000000000000', 'A reply')"), refused);
  await assert.rejects(d.query("select submit_score_report($1, 21, 14)", [KEYS.playoff]), refused);
  await assert.rejects(d.query("select flag_post('00000000-0000-4000-8000-000000000000')"), refused);
  await assert.rejects(d.query("select edit_post('00000000-0000-4000-8000-000000000000', 'new words')"), refused);
  await asFan(d, second);
  await assert.rejects(d.query("select add_comment($1, 'hello')", [KEYS.playoff]), refused);
  const left = await sudo(d, "select (select count(*) from post)::int as posts, (select count(*) from fan_score_report)::int as reports, (select count(*) from forum_thread)::int as threads");
  assert.deepEqual(left.rows[0], { posts: 0, reports: 0, threads: 0 });
});

test("the refusal comes before the profile is looked up: a signed-in account with no profile gets the same answer", async () => {
  const d = await closedDb();
  await asFan(d, "bbbbbbbb-0000-4000-8000-000000000001");
  await assert.rejects(d.query("select add_comment($1, 'hello')", [KEYS.playoff]), refused);
});

test("opening the switch lets the same calls through, closing it stops them again, and each change is logged", async () => {
  const d = await closedDb();
  const f = await fan(d, "Old Fan");
  await sudo(d, "update site_switch set is_on = true where name = 'posts'");
  await asFan(d, f);
  const made = await d.query("select add_comment($1, 'hello') as id", [KEYS.playoff]);
  assert.ok(made.rows[0].id);
  const tid = (await d.query("select create_thread('general', 'A title', 'A body') as id")).rows[0].id;
  await d.query("select reply_to_thread($1, 'A reply')", [tid]);
  await d.query("select submit_score_report($1, 21, 14)", [KEYS.playoff]);
  await sudo(d, "update site_switch set is_on = false where name = 'posts'");
  await asFan(d, f);
  await assert.rejects(d.query("select add_comment($1, 'again')", [KEYS.playoff]), refused);
  const log = await sudo(d, "select before, after from audit_log where entity = 'site_switch' order by id");
  assert.deepEqual(log.rows, [
    { before: { name: "posts", on: false }, after: { name: "posts", on: true } },
    { before: { name: "posts", on: true }, after: { name: "posts", on: false } },
  ]);
});

test("closed, the public reads and the owner's overrides still work", async () => {
  const d = await db();
  const f = await fan(d, "Old Fan");
  await sudo(d, "update game set game_date = current_date - 1 where playoff_round = 'bi-district'");
  await asFan(d, f);
  const id = (await d.query("select add_comment($1, 'visible') as id", [KEYS.playoff])).rows[0].id;
  await sudo(d, "update site_switch set is_on = false where name = 'posts'");
  await as(d, "anon");
  assert.deepEqual((await d.query("select body from list_comments($1)", [KEYS.playoff])).rows.map((r) => r.body), ["visible"]);
  assert.equal((await d.query("select * from forum_boards()")).rows.length, 5);
  await sudo(d, "update post set hidden_at = now() where id = $1", [id]);
  await asFan(d, "11111111-1111-4111-8111-111111111111");
  assert.equal((await d.query("select admin_unhide_post($1, 'fine')", [id])).rows.length, 1);
});

test("the switch table is locked to the API roles, cannot be deleted, and the live check passes", async () => {
  const d = await closedDb();
  for (const role of ["anon", "authenticated"]) {
    await as(d, role);
    await assert.rejects(d.query("select * from site_switch"), /permission denied/);
    await assert.rejects(d.query("update site_switch set is_on = true"), /permission denied/);
  }
  await d.exec("reset role");
  await assert.rejects(d.query("delete from site_switch"), /cannot be changed/);
  await assert.rejects(d.query("truncate site_switch"), /cannot be changed/);
  assert.deepEqual(await checkLive(d), []);
});
