import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLive } from "../load.mjs";
import { as, asFan, db, fan, KEYS, sudo, YEAR } from "./posts-helpers.mjs";

// The Account Center (migration 0026, ADR 0058): the display name's 30-day rule, devices and their labels, per-team mutes on one
// browser, the data export and the activity list. Every function acts on auth.uid()'s own rows; none returns the birth year, a
// push endpoint or key, or an email unsubscribe token.
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const endpoint = (id) => `https://fcm.googleapis.com/fcm/send/${id}`;
const link = (d, id) => d.query("select link_push_subscription($1, $2, $3)", [endpoint(id), P256DH, AUTH]);
const label = (d, id, text) => d.query("select label_push_subscription($1, $2)", [endpoint(id), text]);
const devices = async (d) => (await d.query("select * from my_devices()")).rows;
const account = async (d) => (await d.query("select * from my_account()")).rows[0];
const rename = (d, name) => d.query("select change_display_name($1) as next", [name]).then((r) => r.rows[0].next);
const mutes = async (d, id) => (await d.query("select my_push_mutes($1) as m", [endpoint(id)])).rows[0].m;
const mute = async (d, id, slug, on = true) => (await d.query("select set_push_mute($1, $2, $3) as m", [endpoint(id), slug, on])).rows[0].m;
const rowCount = async (d) => (await sudo(d, "select count(*)::int as n from push_subscription")).rows[0].n;
const DAY = 24 * 60 * 60 * 1000;

test("my_account: the name, when they joined, when it last changed, and when the next change opens; no birth year", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, a);
  const row = await account(d);
  assert.deepEqual(Object.keys(row).sort(), ["display_name", "joined_at", "name_changed_at", "next_name_change_at"]);
  assert.equal(row.display_name, "Bobcat Fan");
  assert.equal(row.name_changed_at, null);
  assert.equal(row.next_name_change_at, null);
  assert.ok(row.joined_at instanceof Date);
});

test("the first rename is free; a second one inside 30 days is refused with the date; after 30 days it works again", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, a);
  const next = await rename(d, "Wildcat Fan");
  assert.ok(Math.abs(next.getTime() - (Date.now() + 30 * DAY)) < 60_000, "the answer is the day the next change opens");
  const row = await account(d);
  assert.equal(row.display_name, "Wildcat Fan");
  assert.ok(row.name_changed_at instanceof Date);
  assert.equal(row.next_name_change_at.getTime(), next.getTime());

  await assert.rejects(rename(d, "Tiger Fan"), (e) => e.code === "55000" && /name_too_soon/.test(e.message) && !Number.isNaN(Date.parse(e.detail)));
  assert.equal((await account(d)).display_name, "Wildcat Fan");

  // 29 days on: still refused. 31 days on: allowed, and the clock starts again.
  await sudo(d, "update profile set name_changed_at = now() - interval '29 days' where user_id = $1", [a]);
  await asFan(d, a);
  await assert.rejects(rename(d, "Tiger Fan"), /name_too_soon/);
  await sudo(d, "update profile set name_changed_at = now() - interval '31 days' where user_id = $1", [a]);
  await asFan(d, a);
  assert.equal((await account(d)).next_name_change_at, null);
  await rename(d, "Tiger Fan");
  const again = await account(d);
  assert.equal(again.display_name, "Tiger Fan");
  assert.ok(again.next_name_change_at > new Date());
});

test("naming the name already held changes nothing and does not use the change", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, a);
  assert.equal(await rename(d, "  Bobcat Fan "), null);
  assert.equal((await account(d)).name_changed_at, null);
  await rename(d, "Wildcat Fan");
  // Now inside the 30 days: the same name again is still just a no-op, with the date it opens.
  assert.ok((await rename(d, "Wildcat Fan")) instanceof Date);
});

test("a rename holds to sign-up's rules: shape, the word list, reserved names, and a name taken (any case); a refusal does not use the change", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await fan(d, "Taken Name");
  await asFan(d, a);
  for (const bad of ["ab", "-Leading", "Trailing-", "Has!Punctuation", "x".repeat(25), "", null]) {
    await assert.rejects(rename(d, bad), (e) => e.code === "23514" && /name_shape/.test(e.message), `shape: ${bad}`);
  }
  await assert.rejects(rename(d, "Nazi Fan"), (e) => e.code === "23514" && /name_not_allowed/.test(e.message));
  for (const reserved of ["Admin", "The Moderator", "txsixman"]) {
    await assert.rejects(rename(d, reserved), (e) => e.code === "23514" && /name_reserved/.test(e.message), reserved);
  }
  await assert.rejects(rename(d, "taken name"), (e) => e.code === "23505" && /name_taken/.test(e.message));
  await assert.rejects(rename(d, "TAKEN NAME"), /name_taken/);
  const row = await account(d);
  assert.deepEqual([row.display_name, row.name_changed_at], ["Bobcat Fan", null], "no refusal used the one change");
  // Only its own case changes: allowed, and counts as the change.
  await rename(d, "bobcat fan");
  assert.equal((await account(d)).display_name, "bobcat fan");
});

test("a rename needs a profile and an account that is not banned, and a signed-in caller", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, "99999999-9999-4999-8999-999999999999");
  await assert.rejects(rename(d, "Someone Else"), /finish sign-up first/);
  assert.deepEqual((await d.query("select * from my_account()")).rows, []);
  await sudo(d, "update profile set banned = true where user_id = $1", [a]);
  await asFan(d, a);
  await assert.rejects(rename(d, "Someone Else"), /banned/);
  await as(d, "authenticated", "");
  await assert.rejects(rename(d, "Someone Else"), /not signed in/);
});

test("a rename changes the name everywhere it is shown (the name is read live from the profile)", async () => {
  const d = await db();
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, a);
  await d.query("select add_comment($1, 'Good game')", [KEYS.regular]);
  await rename(d, "Wildcat Fan");
  await as(d, "anon");
  assert.deepEqual((await d.query("select author from list_comments($1)", [KEYS.regular])).rows, [{ author: "Wildcat Fan" }]);
});

test("devices: a label and a linked date, listed without the endpoint or keys, most recently used first", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, a);
  await link(d, "laptop");
  await label(d, "laptop", "Chrome on Mac");
  await link(d, "phone");
  await sudo(d, "update push_subscription set updated_at = now() - interval '1 day' where endpoint = $1", [endpoint("laptop")]);
  await asFan(d, a);
  const rows = await devices(d);
  assert.deepEqual(rows.map((r) => r.label), ["A browser", "Chrome on Mac"]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["id", "label", "last_used_at", "linked_at"]);
  assert.ok(rows.every((r) => /^[0-9a-f-]{36}$/.test(r.id) && r.linked_at instanceof Date && r.last_used_at instanceof Date));
  assert.ok(!JSON.stringify(rows).includes("fcm.googleapis.com") && !JSON.stringify(rows).includes(P256DH));
  // Labelling stamps the linked date once; relabelling keeps it.
  const stamp = (await sudo(d, "select linked_at from push_subscription where endpoint = $1", [endpoint("laptop")])).rows[0].linked_at;
  assert.ok(stamp instanceof Date);
  await asFan(d, a);
  await label(d, "laptop", "Safari on Mac");
  assert.equal((await sudo(d, "select linked_at from push_subscription where endpoint = $1", [endpoint("laptop")])).rows[0].linked_at.getTime(), stamp.getTime());
});

test("a label is short plain text; null keeps the label; nobody can label a browser that is not their own linked one", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  const b = await fan(d, "Other Fan");
  await asFan(d, a);
  await link(d, "laptop");
  for (const bad of ["x".repeat(41), "<script>alert(1)</script>", "Chrome\non Mac", ""]) {
    await assert.rejects(label(d, "laptop", bad), /not a label/, JSON.stringify(bad));
  }
  await label(d, "laptop", "x".repeat(40));
  await label(d, "laptop", null);
  assert.equal((await devices(d))[0].label, "x".repeat(40));
  await assert.rejects(sudo(d, "update push_subscription set device_label = $1", ["y".repeat(41)]), /check constraint/);
  // Another account's call, an unknown endpoint and an unlinked browser change nothing.
  await asFan(d, b);
  await label(d, "laptop", "Hacked");
  await label(d, "nowhere", "Hacked");
  await d.query("select push_follow($1, $2, $3, $4)", [endpoint("signed-out"), P256DH, AUTH, ["jayton"]]);
  await label(d, "signed-out", "Hacked");
  const stored = (await sudo(d, "select endpoint, device_label from push_subscription order by endpoint")).rows.map((r) => [r.endpoint.split("/").at(-1), r.device_label]);
  assert.deepEqual(stored, [["laptop", "x".repeat(40)], ["signed-out", null]]);
});

test("this_device names this browser's device id for its own account only, and never returns the endpoint", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  const b = await fan(d, "Other Fan");
  await asFan(d, a);
  await link(d, "laptop");
  const id = (await d.query("select this_device($1) as id", [endpoint("laptop")])).rows[0].id;
  assert.equal(id, (await devices(d))[0].id);
  assert.equal((await d.query("select this_device($1) as id", [endpoint("elsewhere")])).rows[0].id, null);
  await asFan(d, b);
  assert.equal((await d.query("select this_device($1) as id", [endpoint("laptop")])).rows[0].id, null, "another account's endpoint is not mine");
});

test("remove a device: only my own row goes; another account's device id, and an unknown id, change nothing", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  const b = await fan(d, "Other Fan");
  await asFan(d, a);
  await link(d, "laptop");
  await link(d, "phone");
  await asFan(d, b);
  await link(d, "theirs");
  const theirs = (await devices(d))[0].id;
  await asFan(d, a);
  const [one, two] = await devices(d);
  await d.query("select remove_my_device($1)", [theirs]);
  await d.query("select remove_my_device('00000000-0000-4000-8000-000000000000')");
  assert.equal(await rowCount(d), 3);
  await asFan(d, a);
  await d.query("select remove_my_device($1)", [one.id]);
  assert.deepEqual((await devices(d)).map((r) => r.id), [two.id]);
  assert.equal(await rowCount(d), 2);
});

test("remove all my devices: every linked browser of mine goes and the count says so; others' and unlinked browsers stay", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  const b = await fan(d, "Other Fan");
  await asFan(d, b);
  await link(d, "theirs");
  await d.query("select push_follow($1, $2, $3, $4)", [endpoint("signed-out"), P256DH, AUTH, ["jayton"]]);
  await asFan(d, a);
  await link(d, "laptop");
  await link(d, "phone");
  await link(d, "tablet");
  assert.equal((await d.query("select remove_all_my_devices() as n")).rows[0].n, 3);
  assert.deepEqual(await devices(d), []);
  assert.equal((await d.query("select remove_all_my_devices() as n")).rows[0].n, 0);
  assert.deepEqual((await sudo(d, "select endpoint from push_subscription order by 1")).rows.map((r) => r.endpoint.split("/").at(-1)), ["signed-out", "theirs"]);
});

test("mute a team on this browser: it round-trips sorted and without repeats, unmutes, and leaves the follow alone", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, a);
  await link(d, "laptop");
  await link(d, "phone");
  await d.query("select follow_program('strawn')");
  assert.deepEqual(await mutes(d, "laptop"), []);
  assert.deepEqual(await mute(d, "laptop", "strawn"), ["strawn"]);
  assert.deepEqual(await mute(d, "laptop", "abbott"), ["abbott", "strawn"]);
  assert.deepEqual(await mute(d, "laptop", "strawn"), ["abbott", "strawn"], "muting twice is fine");
  assert.deepEqual(await mutes(d, "laptop"), ["abbott", "strawn"]);
  assert.deepEqual(await mutes(d, "phone"), [], "the other browser is not muted");
  assert.deepEqual(await mute(d, "laptop", "abbott", false), ["strawn"]);
  assert.deepEqual(await mute(d, "laptop", "never-muted", false), ["strawn"]);
  assert.deepEqual((await d.query("select program_slug from my_follows()")).rows, [{ program_slug: "strawn" }]);
});

test("a mute needs the caller's own linked browser and a slug; at most 100 teams", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  const b = await fan(d, "Other Fan");
  await asFan(d, a);
  await link(d, "laptop");
  for (const bad of ["Not A Slug", "", "-x", "x".repeat(81), null]) {
    await assert.rejects(mute(d, "laptop", bad), /not a program slug/, String(bad));
  }
  await assert.rejects(d.query("select set_push_mute($1, 'strawn', null)", [endpoint("laptop")]), /not a program slug/);
  await sudo(d, "update push_subscription set muted = (select array_agg('team-' || i) from generate_series(1, 100) i)");
  await asFan(d, a);
  await assert.rejects(mute(d, "laptop", "one-more"), /at most 100/);
  assert.equal((await mutes(d, "laptop")).length, 100);
  assert.equal((await mute(d, "laptop", "team-1", false)).length, 99);
  // Someone else's endpoint, an unknown one and an unlinked browser: null, and nothing changes.
  await asFan(d, b);
  await d.query("select push_follow($1, $2, $3, $4)", [endpoint("signed-out"), P256DH, AUTH, ["jayton"]]);
  assert.equal(await mute(d, "laptop", "strawn"), null);
  assert.equal(await mute(d, "signed-out", "strawn"), null);
  assert.equal(await mute(d, "nowhere", "strawn"), null);
  assert.equal(await mutes(d, "laptop"), null);
  assert.equal((await sudo(d, "select cardinality(muted)::int as n from push_subscription where endpoint = $1", [endpoint("laptop")])).rows[0].n, 99);
  assert.deepEqual((await sudo(d, "select muted from push_subscription where endpoint = $1", [endpoint("signed-out")])).rows[0].muted, []);
});

test("a browser that leaves an account, or goes to another one, starts clean: no label, no mutes, no linked date of the earlier account", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  const b = await fan(d, "Other Fan");
  await asFan(d, a);
  await link(d, "shared");
  await label(d, "shared", "Chrome on Windows");
  await mute(d, "shared", "strawn");
  await link(d, "shared"); // the same account again (every page view may): nothing resets
  assert.deepEqual(await mutes(d, "shared"), ["strawn"]);
  assert.equal((await devices(d))[0].label, "Chrome on Windows");
  await asFan(d, b);
  await link(d, "shared");
  const mine = (await devices(d))[0];
  assert.equal(mine.label, "A browser");
  assert.deepEqual(await mutes(d, "shared"), []);
  await asFan(d, a);
  assert.deepEqual(await devices(d), [], "the first account no longer has it");
  // Sign-out with programs left on the browser: the row stays, unlinked, and forgets the account's label and mutes.
  await asFan(d, b);
  await label(d, "shared", "Edge on Windows");
  await mute(d, "shared", "abbott");
  await sudo(d, "update push_subscription set programs = array['jayton']");
  await asFan(d, b);
  await d.query("select unlink_push_subscription($1)", [endpoint("shared")]);
  const row = (await sudo(d, "select user_id, device_label, linked_at, muted from push_subscription")).rows[0];
  assert.deepEqual(row, { user_id: null, device_label: null, linked_at: null, muted: [] });
});

test("every existing subscription got its own device id, and ids are unique", async () => {
  const d = await db({ games: false });
  await sudo(d, "select 1");
  await d.query("select push_follow($1, $2, $3, $4)", [endpoint("one"), P256DH, AUTH, ["jayton"]]);
  await d.query("select push_follow($1, $2, $3, $4)", [endpoint("two"), P256DH, AUTH, ["jayton"]]);
  const ids = (await d.query("select id from push_subscription")).rows.map((r) => r.id);
  assert.equal(new Set(ids).size, 2);
  await assert.rejects(d.query("update push_subscription set id = $1", [ids[0]]), /duplicate key|unique/);
  await assert.rejects(d.query("update push_subscription set id = null"), /not-null|null value/);
});

/** A signed-in fan with something of everything: a follow, a linked browser, an email opt-in, a comment, a thread, a reply and a score report. */
async function busyFan(d, name = "Bobcat Fan") {
  const a = await fan(d, name);
  await sudo(d, "update game set game_date = current_date - 1 where playoff_round = 'bi-district'");
  await asFan(d, a);
  await d.query("select follow_program('alpha')");
  await link(d, "mine");
  await label(d, "mine", "Chrome on Mac");
  await mute(d, "mine", "alpha");
  await d.query("select email_set_optins('game_alerts', array['alpha'])");
  await d.query("select add_comment($1, 'Great game')", [KEYS.regular]);
  const tid = (await d.query("select create_thread('general', 'My thread', 'Opening words') as id")).rows[0].id;
  await d.query("select reply_to_thread($1, 'A reply of mine')", [tid]);
  await d.query("select submit_score_report($1, 21, 14)", [KEYS.playoff]);
  return { a, tid };
}

test("the export holds my own data and none of the secrets: no birth year, endpoint, keys or unsubscribe token", async () => {
  const d = await db();
  const { a, tid } = await busyFan(d);
  const { b } = { b: await fan(d, "Other Fan") };
  await asFan(d, b);
  await d.query("select follow_program('beta')");
  await d.query("select add_comment($1, 'Not mine')", [KEYS.regular]);
  await link(d, "theirs");
  await asFan(d, a);
  const out = (await d.query("select export_my_data() as j")).rows[0].j;
  assert.deepEqual(Object.keys(out).sort(), ["account", "comments", "devices", "email_settings", "exported_at", "follows", "forum_replies", "forum_threads", "score_reports"]);
  assert.deepEqual(Object.keys(out.account).sort(), ["birth_year", "display_name", "joined_at", "name_changed_at"]);
  assert.equal(out.account.display_name, "Bobcat Fan");
  assert.match(out.account.birth_year, /stored/i);
  assert.deepEqual(out.follows.map((f) => f.program), ["alpha"]);
  assert.deepEqual(out.devices.map((x) => [x.label, x.muted_teams]), [["Chrome on Mac", ["alpha"]]]);
  assert.deepEqual(Object.keys(out.devices[0]).sort(), ["label", "last_used_at", "linked_at", "muted_teams"]);
  assert.deepEqual(out.email_settings.map((x) => [x.kind, x.team]), [["game_alerts", "alpha"]]);
  assert.deepEqual(out.comments.map((x) => [x.game, x.text, x.hidden]), [[KEYS.regular, "Great game", false]]);
  assert.deepEqual(out.forum_threads.map((x) => [x.board, x.title, x.text]), [["general", "My thread", "Opening words"]]);
  assert.deepEqual(out.forum_replies.map((x) => [x.thread, x.text]), [[tid, "A reply of mine"]]);
  assert.deepEqual(out.score_reports.map((x) => [x.game, x.home_score, x.away_score]), [[KEYS.playoff, 21, 14]]);
  // Nothing secret anywhere in it, at any depth.
  const text = JSON.stringify(out);
  const token = (await sudo(d, "select token from email_unsubscribe_token where user_id = $1", [a])).rows[0].token;
  for (const secret of ["fcm.googleapis.com", P256DH, AUTH, token, String(YEAR - 30), "Not mine", "theirs", "Other Fan"]) {
    assert.ok(!text.includes(secret), `the export leaks ${secret}`);
  }
  assert.ok(!/"birth_year":\s*\d/.test(text));
});

test("the export includes a post a moderator hid, flagged hidden: it is the person's own text", async () => {
  const d = await db();
  const { a } = await busyFan(d);
  await sudo(d, "update post set hidden_at = now() where body = 'Great game'");
  await asFan(d, a);
  const out = (await d.query("select export_my_data() as j")).rows[0].j;
  assert.deepEqual(out.comments.map((x) => [x.text, x.hidden]), [["Great game", true]]);
});

test("the export of a fan with nothing yet is empty lists, not errors", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Quiet Fan");
  await asFan(d, a);
  const out = (await d.query("select export_my_data() as j")).rows[0].j;
  for (const key of ["follows", "devices", "email_settings", "comments", "forum_threads", "forum_replies", "score_reports"]) assert.deepEqual(out[key], [], key);
});

test("my activity: my comments, threads, replies and score reports, newest first, each with its page; nobody else's", async () => {
  const d = await db();
  const { a, tid } = await busyFan(d);
  const b = await fan(d, "Other Fan");
  await asFan(d, b);
  await d.query("select add_comment($1, 'Not mine')", [KEYS.regular]);
  await asFan(d, a);
  const rows = (await d.query("select * from my_activity(20)")).rows;
  assert.deepEqual(Object.keys(rows[0]).sort(), ["body_excerpt", "created_at", "href", "id", "kind"]);
  assert.deepEqual(rows.map((r) => r.kind).sort(), ["comment", "reply", "score_report", "thread"]);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  assert.deepEqual([by.comment.body_excerpt, by.comment.href], ["Great game", `/scores/${KEYS.regular}`]);
  assert.deepEqual([by.thread.body_excerpt, by.thread.href], ["My thread", `/forums/thread/${tid}`]);
  assert.deepEqual([by.reply.body_excerpt, by.reply.href], ["A reply of mine", `/forums/thread/${tid}`]);
  assert.deepEqual([by.score_report.body_excerpt, by.score_report.href], ["Score report: beta 14, alpha 21", `/scores/${KEYS.playoff}`]);
  const times = rows.map((r) => r.created_at.getTime());
  assert.deepEqual(times, [...times].sort((x, y) => y - x));
});

test("my activity hides what the public cannot see: a hidden post, a banned account, a reply in a hidden thread; and it limits and trims", async () => {
  const d = await db();
  const { a, tid } = await busyFan(d);
  await sudo(d, "update post set hidden_at = now() where body = 'Great game'");
  await asFan(d, a);
  assert.deepEqual((await d.query("select kind from my_activity(20)")).rows.map((r) => r.kind).sort(), ["reply", "score_report", "thread"]);
  // The opening post of the thread is hidden: the thread and my reply in it disappear together.
  await sudo(d, "update post set hidden_at = now() where thread_id = $1 and title is not null", [tid]);
  await asFan(d, a);
  assert.deepEqual((await d.query("select kind from my_activity(20)")).rows.map((r) => r.kind), ["score_report"]);
  // A banned account's posts are not public, so they are not listed either.
  await sudo(d, "update post set hidden_at = null");
  await sudo(d, "update profile set banned = true where user_id = $1", [a]);
  await asFan(d, a);
  assert.deepEqual((await d.query("select kind from my_activity(20)")).rows.map((r) => r.kind), ["score_report"]);
  await sudo(d, "update profile set banned = false where user_id = $1", [a]);
  await asFan(d, a);
  assert.equal((await d.query("select * from my_activity(2)")).rows.length, 2);
  assert.equal((await d.query("select * from my_activity(0)")).rows.length, 1, "at least one");
  assert.equal((await d.query("select * from my_activity(null)")).rows.length, 4, "null means the default");
  assert.equal((await d.query("select * from my_activity()")).rows.length, 4);
  // Long text is trimmed to 140 characters ending in dots, white space is squeezed.
  await sudo(d, "update post set body = $1 where body = 'Great game'", [`word  ${"y".repeat(300)}`]);
  await asFan(d, a);
  const trimmed = (await d.query("select body_excerpt from my_activity(20) where kind = 'comment'")).rows[0].body_excerpt;
  assert.equal(trimmed.length, 140);
  assert.ok(trimmed.startsWith("word y") && trimmed.endsWith("..."));
});

test("every account function refuses anon, and a signed-out caller; the live check stays clean", async () => {
  const d = await db({ games: false });
  const calls = [
    "select * from my_account()",
    "select change_display_name('Some Name')",
    `select label_push_subscription('${endpoint("x")}', 'Chrome on Mac')`,
    "select * from my_devices()",
    `select this_device('${endpoint("x")}')`,
    "select remove_my_device('00000000-0000-4000-8000-000000000000')",
    "select remove_all_my_devices()",
    `select set_push_mute('${endpoint("x")}', 'strawn', true)`,
    `select my_push_mutes('${endpoint("x")}')`,
    "select export_my_data()",
    "select * from my_activity(5)",
  ];
  for (const sql of calls) {
    await as(d, "anon");
    await assert.rejects(d.query(sql), /permission denied/, `anon: ${sql}`);
    await as(d, "authenticated", "");
    await assert.rejects(d.query(sql), /not signed in/, `signed out: ${sql}`);
  }
  await sudo(d, "select 1");
  assert.deepEqual(await checkLive(d), []);
});

test("deleting the account removes its devices and mutes with it (the cascade)", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Bobcat Fan");
  await asFan(d, a);
  await link(d, "laptop");
  await mute(d, "laptop", "strawn");
  await d.query("select delete_my_account()");
  assert.equal(await rowCount(d), 0);
});
