import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLive } from "../load.mjs";
import { BOARDS } from "../../../apps/web/lib/forum-boards.ts";
import { as, asFan, db, fan, fans, sudo } from "./posts-helpers.mjs";

// Forums (migration 0015, ADR 0018): boards, threads and replies on the post rules of migration 0013.
const thread = (d, title, body, board = "general") => d.query("select create_thread($1, $2, $3) as id", [board, title, body]).then((r) => r.rows[0].id);
const reply = (d, tid, body) => d.query("select reply_to_thread($1, $2) as id", [tid, body]).then((r) => r.rows[0].id);
const threads = async (d, board = "general") => (await d.query("select * from forum_threads($1)", [board])).rows;
const posts = async (d, tid) => (await d.query("select * from forum_posts($1)", [tid])).rows;

test("the boards in the database are the boards the site lists", async () => {
  const d = await db({ games: false });
  const { rows } = await d.query("select slug, name, description from forum_board order by sort");
  assert.deepEqual(rows, BOARDS.map(({ slug, name, description }) => ({ slug, name, description })));
});

test("a thread is its opening post and its replies, oldest first, with the date joined and nothing else", async () => {
  const d = await db({ games: false });
  const [a, b] = [await fan(d, "Starter Fan"), await fan(d, "Replier Fan")];
  await asFan(d, a);
  const tid = await thread(d, "Who wins Division II?", "Thoughts?");
  await asFan(d, b);
  await reply(d, tid, "Cedar Gap looks strong");
  await asFan(d, a);
  await reply(d, tid, "Agreed");
  await as(d, "anon");
  const rows = await posts(d, tid);
  assert.deepEqual(rows.map((r) => [r.author, r.body]), [["Starter Fan", "Thoughts?"], ["Replier Fan", "Cedar Gap looks strong"], ["Starter Fan", "Agreed"]]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["author", "body", "created_at", "edited", "id", "joined", "total"]);
  assert.match(rows[0].joined, /^[A-Z][a-z]{2} \d{4}$/);
  const info = (await d.query("select * from forum_thread_info($1)", [tid])).rows[0];
  assert.deepEqual([info.board, info.board_name, info.title, info.total], ["general", "General", "Who wins Division II?", 3]);
  const list = await threads(d);
  assert.deepEqual(list.map((t) => [t.title, t.author, t.replies, t.total]), [["Who wins Division II?", "Starter Fan", 2, 1]]);
  assert.deepEqual(Object.keys(list[0]).sort(), ["author", "created_at", "id", "last_post_at", "replies", "title", "total"]);
  const boards = (await d.query("select slug, threads from forum_boards()")).rows;
  assert.deepEqual(boards.map((x) => x.threads), [1, 0, 0, 0, 0]);
});

test("the newest activity comes first, and boards page", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Starter Fan");
  await asFan(d, a);
  const first = await thread(d, "First", "one");
  await sudo(d, "update forum_thread set last_post_at = now() - interval '1 hour'");
  await asFan(d, a);
  const second = await thread(d, "Second", "two");
  await sudo(d, "update forum_thread set last_post_at = now() - interval '30 minutes' where id = $1", [second]);
  await asFan(d, a);
  await reply(d, first, "bump");
  assert.deepEqual((await threads(d)).map((t) => t.title), ["First", "Second"]);
  assert.equal((await d.query("select * from forum_threads('general', 1, 1)")).rows.length, 1);
  assert.equal((await threads(d, "playoffs")).length, 0);
});

test("every post rule applies: word list, links under 7 days, rate limits, who may post, real boards only", async () => {
  const d = await db({ games: false });
  const young = await fan(d, "Young Fan", { old: false });
  await asFan(d, young);
  await assert.rejects(thread(d, "you are a n1gg3r", "text"), /blocked_text/);
  await assert.rejects(thread(d, "Title", "I will kill you"), /blocked_text/);
  await assert.rejects(thread(d, "Title", "see example.com"), /links_not_allowed/);
  await assert.rejects(thread(d, "", "text"), /bad_text/);
  await assert.rejects(thread(d, "x".repeat(121), "text"), /bad_text/);
  await assert.rejects(thread(d, "Title", "text", "no-such-board"), /unknown_board/);
  const tid = await thread(d, "Hello", "first thread");
  await assert.rejects(thread(d, "Another", "second thread"), /rate_limited/, "a new account: one thread in 10 minutes");
  await assert.rejects(reply(d, tid, "see https://example.com"), /links_not_allowed/);
  await assert.rejects(reply(d, "00000000-0000-4000-8000-000000000000", "hi"), /not_found/);
  const old = await fan(d, "Old Fan");
  await asFan(d, old);
  await reply(d, tid, "see https://example.com");
  await as(d, "anon");
  await assert.rejects(thread(d, "T", "b"), /permission denied/);
  await assert.rejects(reply(d, tid, "b"), /permission denied/);
  await asFan(d, await fan(d, "Muted Fan", { muted: true }));
  await assert.rejects(thread(d, "T", "b"), /muted/);
  await assert.rejects(reply(d, tid, "b"), /muted/);
});

test("3 flags hide a reply; 3 flags on the opening post take the whole thread off the board", async () => {
  const d = await db({ games: false });
  const [a, b] = [await fan(d, "Starter Fan"), await fan(d, "Replier Fan")];
  const flaggers = await fans(d, 3);
  await asFan(d, a);
  const tid = await thread(d, "A thread", "opening post");
  await asFan(d, b);
  const r = await reply(d, tid, "a reply");
  const hide = async (pid) => { for (const f of flaggers) { await asFan(d, f); await d.query("select flag_post($1)", [pid]); } };
  await hide(r);
  assert.deepEqual((await posts(d, tid)).map((x) => x.body), ["opening post"]);
  assert.equal((await threads(d))[0].replies, 0);
  const opening = (await sudo(d, "select id from post where thread_id = $1 and title is not null", [tid])).rows[0].id;
  await hide(opening);
  await as(d, "anon");
  assert.deepEqual(await threads(d), []);
  assert.deepEqual(await posts(d, tid), []);
  assert.equal((await d.query("select * from forum_thread_info($1)", [tid])).rows.length, 0);
  assert.equal((await d.query("select threads from forum_boards() where slug = 'general'")).rows[0].threads, 0);
  await asFan(d, b);
  await assert.rejects(reply(d, tid, "into the void"), /not_found/);
});

test("a title can be edited with the post, and the earlier title and text are kept", async () => {
  const d = await db({ games: false });
  const a = await fan(d, "Starter Fan");
  await asFan(d, a);
  const tid = await thread(d, "Old title", "old text");
  const opening = (await sudo(d, "select id from post where thread_id = $1 and title is not null", [tid])).rows[0].id;
  await asFan(d, a);
  await d.query("select edit_post($1, 'new text', 'New title')", [opening]);
  await assert.rejects(d.query("select edit_post($1, 'new text 2', 'you are a nigger')", [opening]), /blocked_text/);
  assert.deepEqual((await threads(d)).map((t) => t.title), ["New title"]);
  assert.equal((await posts(d, tid))[0].edited, true);
  const kept = (await sudo(d, "select title, body from post_edit where post_id = $1", [opening])).rows;
  assert.deepEqual(kept, [{ title: "Old title", body: "old text" }]);
});

test("deleting an account removes its posts; a thread goes with its opening post; a banned author's threads are not shown", async () => {
  const d = await db({ games: false });
  const [a, b] = [await fan(d, "Starter Fan"), await fan(d, "Replier Fan")];
  await asFan(d, a);
  const mine = await thread(d, "Mine", "opening");
  await asFan(d, b);
  const theirs = await thread(d, "Theirs", "opening two");
  await reply(d, mine, "reply in a's thread");
  await asFan(d, a);
  await reply(d, theirs, "reply in b's thread");
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  assert.deepEqual((await d.query("select count(*)::int as n from forum_thread")).rows, [{ n: 1 }], "a's thread went with a's opening post");
  assert.deepEqual((await d.query("select body from post order by body")).rows, [{ body: "opening two" }], "b's reply in a thread that went, and a's reply, are gone too");
  await sudo(d, "update profile set banned = true where user_id = $1", [b]);
  await as(d, "anon");
  assert.deepEqual(await threads(d), []);
});

test("the forum's tables are locked and its functions are the only way in", async () => {
  const d = await db({ games: false });
  await asFan(d, await fan(d, "Starter Fan"));
  await thread(d, "T", "b");
  for (const t of ["forum_board", "forum_thread"]) {
    await assert.rejects(d.query(`select * from ${t}`), /permission denied/, t);
    await assert.rejects(d.exec(`delete from ${t}`), /permission denied/, t);
  }
  await assert.rejects(d.exec("insert into forum_board (slug, name, description, sort) values ('spam', 'Spam', 'x', 9)"), /permission denied/);
  await assert.rejects(d.query("select forum_thread_visible(gen_random_uuid())"), /permission denied/);
  await d.exec("reset role");
  assert.deepEqual((await d.query("select relname from pg_class where relname in ('forum_board', 'forum_thread') and not relrowsecurity")).rows, []);
  assert.deepEqual(await checkLive(d), []);
});
