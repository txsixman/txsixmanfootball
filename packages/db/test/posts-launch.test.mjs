import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN, as, asFan, cool, db, fan, fans, KEYS, sudo } from "./posts-helpers.mjs";

// The posts launch round (migration 0027, ADRs 0060 to 0062): the per-minute limit, betting talk refused, the owner's hide,
// mute and flagged list, the fan score report list, and what an account deletion leaves behind.
const comment = (d, text, key = KEYS.playoff) => d.query("select add_comment($1, $2) as id", [key, text]).then((r) => r.rows[0].id);
const visible = async (d, key = KEYS.playoff) => (await d.query("select * from list_comments($1)", [key])).rows;
const overview = async (d) => (await d.query("select admin_moderation_overview() as o")).rows[0].o;
const audit = async (d, entity, id) =>
  (await sudo(d, "select before, after, reason from audit_log where entity = $1 and entity_id = $2 order by id", [entity, id])).rows;

test("a thread is limited per minute too: an established account starts 2 a minute", async () => {
  const d = await db();
  const f = await fan(d, "Thread Fan");
  await asFan(d, f);
  const thread = (t) => d.query("select create_thread('general', $1, 'body text')", [t]);
  await thread("One");
  await thread("Two");
  await assert.rejects(thread("Three"), /rate_limited/);
  await cool(d, f);
  await asFan(d, f);
  await thread("Three");
});

test("betting talk is refused in a comment, a thread's title and body, a reply and an edit; ordinary football talk is not", async () => {
  const d = await db();
  const f = await fan(d, "Clean Fan");
  await asFan(d, f);
  for (const t of ["What are the 0dds on Friday?", "Who covered the spread", "parlay anyone", "Over/under is 80"]) {
    await assert.rejects(comment(d, t), /betting_text/, t);
    await cool(d, f);
    await asFan(d, f);
  }
  await assert.rejects(d.query("select create_thread('general', 'Best odds', 'hello')"), /betting_text/);
  await assert.rejects(d.query("select create_thread('general', 'Hello', 'any sportsbook taking this?')"), /betting_text/);
  const pid = await comment(d, "I bet their spread offense and offensive line win it. Pick six!");
  await assert.rejects(d.query("select edit_post($1, 'now with odds')", [pid]), /betting_text/);
  const tid = (await d.query("select create_thread('general', 'Friday', 'who wins')")).rows[0].create_thread;
  await cool(d, f);
  await asFan(d, f);
  await assert.rejects(d.query("select reply_to_thread($1, 'taking bets')", [tid]), /betting_text/);
  // Slurs are still checked first.
  await assert.rejects(comment(d, "odds kike"), /blocked_text/);
});

test("the owner hides a post and mutes an account by hand, each refused to anyone else and written to the audit log", async () => {
  const d = await db();
  const author = await fan(d, "Author Fan");
  await asFan(d, author);
  const pid = await comment(d, "rude but not on the list");
  const calls = [`select admin_hide_post('${pid}', 'x')`, `select admin_mute('${author}', 3, 'x')`, "select admin_fan_score_reports()"];
  await asFan(d, author);
  for (const c of calls) await assert.rejects(d.query(c), /admin_only/, c);
  await as(d, "anon");
  for (const c of calls) await assert.rejects(d.query(c), /permission denied/, c);

  await asFan(d, ADMIN);
  await d.query("select admin_hide_post($1, 'rude')", [pid]);
  assert.equal((await visible(d)).length, 0);
  await assert.rejects(d.query("select admin_hide_post($1)", [pid]), /not_found/, "already hidden");
  assert.deepEqual(await audit(d, "post", pid), [{ before: { hidden: false }, after: { hidden: true, by: "owner" }, reason: "rude" }]);
  await asFan(d, ADMIN);
  assert.equal((await overview(d)).hidden_posts[0].id, pid);
  await d.query("select admin_unhide_post($1, 'fine after all')", [pid]);
  assert.equal((await visible(d)).length, 1);

  await assert.rejects(d.query("select admin_mute($1, 0)", [author]), /bad_days/);
  await assert.rejects(d.query("select admin_mute($1, 91)", [author]), /bad_days/);
  await d.query("select admin_mute($1, 3, 'cool off')", [author]);
  const until = (await sudo(d, "select muted_until from profile where user_id = $1", [author])).rows[0].muted_until;
  assert.ok(new Date(until) > new Date(Date.now() + 2.9 * 864e5) && new Date(until) < new Date(Date.now() + 3.1 * 864e5));
  await asFan(d, ADMIN);
  await assert.rejects(d.query("select admin_mute($1, 1)", [author]), /not_found/, "a longer mute is kept");
  const rows = await audit(d, "profile", author);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].before.muted_until, null);
  assert.equal(rows[0].reason, "cool off");
  await asFan(d, author);
  await assert.rejects(comment(d, "muted now"), /muted/);
  // No row of the audit log holds a post's text.
  assert.equal((await sudo(d, "select count(*)::int as n from audit_log where before::text like '%rude but%' or after::text like '%rude but%'")).rows[0].n, 0);
});

test("every flag reaches the owner's flagged list, a new account's too; hidden and cleared posts leave it", async () => {
  const d = await db();
  const author = await fan(d, "Author Fan");
  await asFan(d, author);
  const pid = await comment(d, "flag me");
  const other = await comment(d, "leave me");
  const young = await fan(d, "Young Fan", { old: false });
  await asFan(d, young);
  await d.query("select flag_post($1)", [pid]);
  await asFan(d, ADMIN);
  let o = await overview(d);
  assert.equal(o.flagged_posts.length, 1);
  assert.equal(o.flagged_posts[0].id, pid);
  assert.equal(o.flagged_posts[0].flags, 1);
  assert.equal(o.flagged_posts[0].counted, 0, "a new account's flag does not count toward hiding");
  assert.equal(o.flagged_posts[0].body, "flag me");
  assert.ok(!JSON.stringify(o.flagged_posts).includes(young), "never who flagged");
  assert.ok(!o.flagged_posts.some((p) => p.id === other));

  // Cleared by the owner: it leaves the list until someone flags it again.
  await sudo(d, "update post set cleared_at = now() where id = $1", [pid]);
  await asFan(d, ADMIN);
  assert.equal((await overview(d)).flagged_posts.length, 0);
  const [f1, f2, f3] = await fans(d, 3);
  await asFan(d, f1);
  await d.query("select flag_post($1)", [pid]);
  await asFan(d, ADMIN);
  o = await overview(d);
  assert.equal(o.flagged_posts[0].flags, 1);
  assert.equal(o.flagged_posts[0].counted, 1);
  // Hidden by flags (an uncleared post): it moves to the hidden list.
  await asFan(d, author);
  const third = await comment(d, "hide me");
  for (const f of [f1, f2, f3]) { await asFan(d, f); await d.query("select flag_post($1)", [third]); }
  await asFan(d, ADMIN);
  o = await overview(d);
  assert.ok(!o.flagged_posts.some((p) => p.id === third));
  assert.ok(o.hidden_posts.some((p) => p.id === third));
});

test("fan score reports never change a game; the owner's list shows them, with the ones that disagree with the final marked", async () => {
  const d = await db();
  await sudo(d, "update game set kickoff = now() - interval '3 hours' where playoff_round = 'bi-district'");
  const [a, b] = await fans(d, 2);
  const young = await fan(d, "Young Fan", { old: false });
  for (const [f, home, away] of [[a, 42, 14], [b, 42, 14], [young, 40, 14]]) {
    await asFan(d, f);
    await d.query("select submit_score_report($1, $2, $3)", [KEYS.playoff, home, away]);
  }
  const game = async () => (await sudo(d, "select status, home_score, away_score from game where playoff_round = 'bi-district'")).rows[0];
  assert.deepEqual(await game(), { status: "scheduled", home_score: null, away_score: null }, "two agreeing fans never write the game");

  // The Results watch then reads a different final: the reports stay where they are, and the game keeps its own score.
  await sudo(d, "update game set status = 'final', end_reason = 'regulation', home_score = 40, away_score = 14 where playoff_round = 'bi-district'");
  await asFan(d, a);
  await assert.rejects(d.query("select submit_score_report($1, 36, 14)", [KEYS.playoff]), /game_closed/);
  assert.deepEqual(await game(), { status: "final", home_score: 40, away_score: 14 });

  await asFan(d, ADMIN);
  const list = (await d.query("select admin_fan_score_reports() as l")).rows[0].l;
  assert.equal(list.length, 1);
  assert.equal(list[0].game_key, KEYS.playoff);
  assert.equal(list[0].status, "final");
  const by = Object.fromEntries(list[0].scores.map((s) => [`${s.home_score}-${s.away_score}`, s]));
  assert.deepEqual(by["42-14"], { home_score: 42, away_score: 14, reports: 2, counted: 2, disagrees: true });
  assert.deepEqual(by["40-14"], { home_score: 40, away_score: 14, reports: 1, counted: 0, disagrees: false });
  for (const id of [a, b, young]) assert.ok(!JSON.stringify(list).includes(id), "never who reported");
});

test("a deleted account's posts, edits and flags are erased; its score reports stay with no reporter", async () => {
  const d = await db();
  await sudo(d, "update game set kickoff = now() - interval '3 hours' where playoff_round = 'bi-district'");
  const gone = await fan(d, "Leaving Fan");
  const stay = await fan(d, "Staying Fan");
  await asFan(d, stay);
  const theirs = await comment(d, "a post to flag");
  await asFan(d, gone);
  const pid = await comment(d, "my post");
  await d.query("select edit_post($1, 'my post, edited')", [pid]);
  await d.query("select flag_post($1)", [theirs]);
  await d.query("select submit_score_report($1, 42, 14)", [KEYS.playoff]);
  await d.query("select delete_my_account()");
  const count = async (sql) => (await sudo(d, sql, [gone])).rows[0].n;
  assert.equal(await count("select count(*)::int as n from post where author_id = $1"), 0);
  assert.equal(await count("select count(*)::int as n from post_edit e where not exists (select 1 from post p where p.id = e.post_id) and $1::uuid is not null"), 0);
  assert.equal(await count("select count(*)::int as n from post_flag where flagger_id = $1"), 0);
  assert.equal(await count("select count(*)::int as n from fan_score_report where reporter_id = $1"), 0);
  assert.equal((await sudo(d, "select count(*)::int as n from fan_score_report where reporter_id is null")).rows[0].n, 1);
  await as(d, "anon");
  assert.deepEqual((await visible(d)).map((r) => r.body), ["a post to flag"]);
});
