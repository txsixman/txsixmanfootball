import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkLive } from "../load.mjs";
import { ADMIN, as, asFan, db, fan, fans, KEYS, newId, sudo, YEAR } from "./posts-helpers.mjs";

// Moderation core and game comments (migration 0013, ADR 0018): the word list, links, rate limits, flags, mutes, edits,
// The owner's overrides and account deletion. Everything is enforced by the database; the site's copy is a convenience.
const lib = new URL("../../../apps/web/lib/moderation/", import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, lib), "utf8"));
const comment = (d, text, key = KEYS.playoff) => d.query("select add_comment($1, $2) as id", [key, text]).then((r) => r.rows[0].id);
const visible = async (d, key = KEYS.playoff) => (await d.query("select * from list_comments($1)", [key])).rows;

test("the database's word list is the site's word list, row for row", async () => {
  const d = await db({ games: false });
  const list = read("wordlist.json");
  const { rows } = await d.query("select kind, term from moderation_term order by kind, term");
  const want = ["word", "squash", "threat"].flatMap((k) => list[k].map((t) => ({ kind: k, term: t })));
  assert.deepEqual(rows, want.sort((a, b) => (a.kind + a.term < b.kind + b.term ? -1 : 1)));
});

test("the database folds and checks text exactly as the site does (shared vectors)", async () => {
  const d = await db({ games: false });
  const v = read("vectors.json");
  for (const x of v.blocked) {
    assert.equal((await d.query("select moderation_blocked($1) as b", [x.text])).rows[0].b, x.blocked, JSON.stringify(x.text));
  }
  for (const x of v.links) {
    assert.equal((await d.query("select post_link_count($1) as n", [x.text])).rows[0].n, x.links, JSON.stringify(x.text));
  }
});

test("every invisible or combining character, and every look-alike pair, is folded as the site folds it", async () => {
  const d = await db({ games: false });
  const v = read("vectors.json");
  const fold = read("fold.json");
  const codes = v.invisible.flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
  const bad = await d.query("select c from unnest($1::int[]) c where moderation_normalize('k' || chr(c) || 'ike') <> 'kike'", [codes]);
  assert.deepEqual(bad.rows, []);
  const pairs = [...fold.from].map((c, i) => [c, fold.to[i]]);
  const off = await d.query("select f from unnest($1::text[], $2::text[]) as t(f, w) where moderation_normalize(f) <> w", [pairs.map((p) => p[0]), pairs.map((p) => p[1])]);
  assert.deepEqual(off.rows, []);
});

test("display names: create_profile refuses a name the word list blocks or one reserved for the site, as the site's check does", async () => {
  const d = await db({ games: false });
  for (const { name, problem } of read("vectors.json").names) {
    await asFan(d, newId());
    const call = d.query("select create_profile($1, $2, false)", [name, YEAR - 30]);
    if (problem === null) await call;
    else await assert.rejects(call, (e) => e.code === "23514" && (problem === "blocked" ? /name_not_allowed/ : /name_reserved/).test(e.message), name);
  }
  await asFan(d, newId());
  await assert.rejects(d.query("select create_profile('Old Enough', $1, false)", [YEAR - 5]), /under 13/);
});

test("slurs and threats are refused before the post is saved; ordinary talk goes through", async () => {
  const d = await db();
  const id = await fan(d, "Bobcat Fan");
  await asFan(d, id);
  for (const bad of ["you are a n1gg3r", "I will kill you", "k y s", "gonna shoot up the stadium"]) {
    await assert.rejects(comment(d, bad), /blocked_text/, bad);
  }
  await assert.rejects(comment(d, "   "), /bad_text/);
  await assert.rejects(comment(d, "x".repeat(2001)), /bad_text/);
  await assert.rejects(comment(d, "bell\u0007"), /bad_text/);
  // Spelling tricks: marks, fullwidth and look-alike letters, hidden characters.
  for (const bad of ["\u1e31ike", "k\u0456ke", "\uff4b\uff49\uff4b\uff45", "ki\u202eke", "k\ufe0fike", "ki\u2061ke"]) {
    await assert.rejects(comment(d, bad), /blocked_text|bad_text/, JSON.stringify(bad));
  }
  // Nothing to read, or text that reads backwards.
  for (const bad of ["\u200b\u200b", "!!! ??? ...", "\ud83d\udd25", "good \u202egame", "a\u2066b", "x\u2069"]) {
    await assert.rejects(comment(d, bad), /bad_text/, JSON.stringify(bad));
  }
  await comment(d, "Great game, we will beat you 50-0 next year");
  assert.equal((await sudo(d, "select count(*)::int as n from post")).rows[0].n, 1);
});

test("a comment needs a real game: the sample games and made-up addresses are refused", async () => {
  const d = await db();
  await asFan(d, await fan(d, "Bobcat Fan"));
  for (const key of ["sample-game", "2026-bi-district-gamma-at-alpha", "2026-09-04-alpha-at-beta", "x", "2026-DROP TABLE", "2026-09-04-beta-at-alpha'--"]) {
    await assert.rejects(comment(d, "hello", key), /unknown_game/, key);
  }
  await comment(d, "hello", KEYS.regular);
  await comment(d, "hello", KEYS.played);
});

test("accounts under 7 days old may not post links; older accounts may, up to two", async () => {
  const d = await db();
  const young = await fan(d, "Young Fan", { old: false });
  await asFan(d, young);
  await assert.rejects(comment(d, "see https://example.com"), /links_not_allowed/);
  await assert.rejects(comment(d, "see example.com"), /links_not_allowed/);
  await assert.rejects(comment(d, "see example dot com"), /links_not_allowed/);
  // However the address is dressed: brackets, a colon, a hidden character, no-break spaces, fullwidth letters.
  for (const t of ["(https://evil.ai/x)", "x:https://evil.tk", "ht\u200btps://a", "w\u200bww.x", "\uff57\uff57\uff57\uff0ex", "a\u00a0b.com", "https://a.com'https://b.com"]) {
    await assert.rejects(comment(d, t), /links_not_allowed/, JSON.stringify(t));
  }
  await comment(d, "no link here");
  const old = await fan(d, "Old Fan", { old: true });
  await asFan(d, old);
  await comment(d, "see https://example.com/a and www.example.org");
  await assert.rejects(comment(d, "a.com b.com c.com"), /too_many_links/);
  // Counted over the whole text, not word by word: nothing hides a third address.
  for (const t of ["(https://a.ai) x:https://b.tk https://c.com", "https://a.com'https://b.com'https://c.com", "https://a.com\u00a0https://b.com\u3000https://c.com", "a.com,b.com,c.com"]) {
    await assert.rejects(comment(d, t), /too_many_links/, JSON.stringify(t));
  }
  await comment(d, "(https://evil.ai/x) and x:https://evil.tk");
});

test("every account is rate limited, a new one more tightly; edits count as posts", async () => {
  const d = await db();
  const young = await fan(d, "Young Fan", { old: false });
  await asFan(d, young);
  const first = await comment(d, "one");
  await comment(d, "two");
  await d.query("select edit_post($1, 'one, edited')", [first]);
  await assert.rejects(comment(d, "four"), /rate_limited/);
  await assert.rejects(d.query("select edit_post($1, 'one, edited again')", [first]), /rate_limited/);
  const old = await fan(d, "Old Fan", { old: true });
  await asFan(d, old);
  for (let i = 0; i < 8; i++) await comment(d, `post ${i}`);
  await assert.rejects(comment(d, "nine"), /rate_limited/);
  // Ten minutes later the short window clears, the daily one still counts.
  await sudo(d, "update post set created_at = now() - interval '11 minutes' where author_id = $1", [old]);
  await asFan(d, old);
  await comment(d, "later");
  await sudo(d, "update post set created_at = now() - interval '2 hours' where author_id = $1", [old]);
  await asFan(d, old);
  for (let i = 0; i < 91; i++) await sudo(d, "insert into post (author_id, game_key, body, created_at) select $1, $2, 'x', now() - interval '3 hours'", [old, KEYS.playoff]);
  await asFan(d, old);
  await assert.rejects(comment(d, "over the day"), /rate_limited/);
});

test("only a signed-in fan with a profile, not banned and not muted, can post, flag or edit", async () => {
  const d = await db();
  await as(d, "anon");
  await assert.rejects(comment(d, "hi"), /permission denied/);
  await as(d, "authenticated", "");
  await assert.rejects(comment(d, "hi"), /sign_in_required/);
  await as(d, "authenticated", "bbbbbbbb-0000-4000-8000-000000000001");
  await assert.rejects(comment(d, "hi"), /profile_required/);
  const muted = await fan(d, "Muted Fan", { muted: true });
  const banned = await fan(d, "Banned Fan");
  await sudo(d, "update profile set banned = true where user_id = $1", [banned]);
  const other = await fan(d, "Other Fan");
  await asFan(d, other);
  const pid = await comment(d, "a post");
  for (const [id, code] of [[muted, /muted/], [banned, /banned/]]) {
    await asFan(d, id);
    await assert.rejects(comment(d, "hi"), code);
    await assert.rejects(d.query("select flag_post($1)", [pid]), code);
    await assert.rejects(d.query("select edit_post($1, 'x')", [pid]), code);
  }
});

test("every table is locked: no direct reads or writes, and the API roles run only the listed functions", async () => {
  const d = await db();
  const id = await fan(d, "Bobcat Fan");
  await asFan(d, id);
  await comment(d, "hello");
  for (const t of ["post", "post_edit", "post_flag", "moderation_term"]) {
    await assert.rejects(d.query(`select * from ${t}`), /permission denied/, t);
    await assert.rejects(d.exec(`delete from ${t}`), /permission denied/, t);
  }
  await assert.rejects(d.exec("update post set hidden_at = null"), /permission denied/);
  await assert.rejects(d.exec("insert into post (author_id, game_key, body) values (auth.uid(), 'x-xxxxxx', 'y')"), /permission denied/);
  for (const internal of ["moderation_strip('x')", "moderation_reserved_name('x')", "moderation_name_blocked('x')", "post_link_count('x')", "moderation_blocked('x')", "fan_actor()", "post_evaluate(gen_random_uuid())", "resolve_game_key('x')", "admin_guard()"]) {
    await assert.rejects(d.query(`select ${internal}`), /permission denied/, internal);
  }
  await d.exec("reset role");
  const rls = await d.query("select relname from pg_class where relname in ('post','post_edit','post_flag','moderation_term') and not relrowsecurity");
  assert.deepEqual(rls.rows, []);
  assert.deepEqual(await checkLive(d), []);
});

test("the public read returns a display name, the text, a time and an edited flag, to anyone, and nothing else", async () => {
  const d = await db();
  const id = await fan(d, "Bobcat Fan");
  await asFan(d, id);
  const pid = await comment(d, "first");
  await d.query("select edit_post($1, 'first, edited')", [pid]);
  await comment(d, "second");
  await as(d, "anon");
  const rows = await visible(d);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["author", "body", "created_at", "edited", "id", "total"]);
  assert.deepEqual(rows.map((r) => [r.author, r.body, r.edited, r.total]), [["Bobcat Fan", "first, edited", true, 2], ["Bobcat Fan", "second", false, 2]]);
  assert.equal((await d.query("select * from list_comments($1, 1, 1)", [KEYS.playoff])).rows.length, 1);
  assert.equal((await visible(d, KEYS.regular)).length, 0);
});

test("edits keep every earlier version, only the author may edit, and the edit is checked again", async () => {
  const d = await db();
  const [a, b] = [await fan(d, "Author Fan"), await fan(d, "Reader Fan")];
  await asFan(d, a);
  const pid = await comment(d, "version one");
  await d.query("select edit_post($1, 'version two')", [pid]);
  await d.query("select edit_post($1, 'version two')", [pid]); // no change, no new version
  await d.query("select edit_post($1, 'version three')", [pid]);
  await assert.rejects(d.query("select edit_post($1, 'you are a nigger')", [pid]), /blocked_text/);
  await asFan(d, b);
  await assert.rejects(d.query("select edit_post($1, 'mine now')", [pid]), /not_found/);
  const { rows } = await sudo(d, "select body from post_edit where post_id = $1 order by id", [pid]);
  assert.deepEqual(rows.map((r) => r.body), ["version one", "version two"]);
  assert.equal((await d.query("select body, edited_at is not null as e from post where id = $1", [pid])).rows[0].e, true);
});

test("a post flagged by 3 different established accounts is hidden; fewer, repeats, new and muted accounts do not count", async () => {
  const d = await db();
  const author = await fan(d, "Author Fan");
  await asFan(d, author);
  const pid = await comment(d, "a post people may dislike");
  const [f1, f2, f3, f4] = await fans(d, 4);
  const young = await fan(d, "Young Fan", { old: false });
  const flag = async (id) => { await asFan(d, id); await d.query("select flag_post($1)", [pid]); };
  await flag(f1);
  await flag(f1); // the same account again counts once
  await flag(young); // a new account's flag is recorded but does not count
  await flag(f2);
  assert.equal((await visible(d)).length, 1);
  // A flagger muted afterwards stops counting; a muted account cannot flag at all.
  await sudo(d, "update profile set muted_until = now() + interval '1 day' where user_id = $1", [f2]);
  await flag(f3);
  assert.equal((await visible(d)).length, 1, "f1 and f3 count; f2 is muted now, young never counted");
  await sudo(d, "update profile set muted_until = null where user_id = $1", [f2]);
  await flag(f4);
  assert.equal((await visible(d)).length, 0, "3 counting flaggers hide it");
  assert.equal((await sudo(d, "select count(*)::int as n from post_flag where post_id = $1", [pid])).rows[0].n, 5);
  const muted = await fan(d, "Muted Fan", { muted: true });
  await asFan(d, muted);
  await assert.rejects(d.query("select flag_post($1)", [pid]), /muted/);
  await asFan(d, author);
  await assert.rejects(d.query("select edit_post($1, 'trying to sneak it back')", [pid]), /post_hidden/);
});

test("you cannot flag your own post, and a missing post is not found", async () => {
  const d = await db();
  const a = await fan(d, "Author Fan");
  await asFan(d, a);
  const pid = await comment(d, "mine");
  await assert.rejects(d.query("select flag_post($1)", [pid]), /own_post/);
  await assert.rejects(d.query("select flag_post(gen_random_uuid())"), /not_found/);
});

test("flagging is rate limited too", async () => {
  const d = await db();
  const author = await fan(d, "Author Fan");
  await asFan(d, author);
  const pids = [];
  for (let i = 0; i < 6; i++) {
    await sudo(d, "update post set created_at = now() - interval '1 day' - make_interval(mins => $2) where author_id = $1", [author, i]);
    await asFan(d, author);
    pids.push(await comment(d, `post ${i}`));
  }
  const young = await fan(d, "Young Fan", { old: false });
  await asFan(d, young);
  for (let i = 0; i < 5; i++) await d.query("select flag_post($1)", [pids[i]]);
  await assert.rejects(d.query("select flag_post($1)", [pids[5]]), /rate_limited/);
});

test("3 hidden posts in 30 days mute the author; older hidden posts do not count; a muted account cannot post", async () => {
  const d = await db();
  const author = await fan(d, "Author Fan");
  const flaggers = await fans(d, 3);
  const hide = async (pid) => {
    for (const f of flaggers) { await asFan(d, f); await d.query("select flag_post($1)", [pid]); }
  };
  const posts = [];
  for (let i = 0; i < 3; i++) { await asFan(d, author); posts.push(await comment(d, `post ${i}`)); }
  await hide(posts[0]);
  await hide(posts[1]);
  const muteOf = async () => (await sudo(d, "select muted_until from profile where user_id = $1", [author])).rows[0].muted_until;
  assert.equal(await muteOf(), null, "two hidden posts: not muted");
  await hide(posts[2]);
  const until = await muteOf();
  assert.ok(until && new Date(until) > new Date(Date.now() + 6 * 864e5), "muted for about 7 days");
  await asFan(d, author);
  await assert.rejects(comment(d, "again"), /muted/);

  // Two hidden posts 31 days ago and one now: only one counts.
  const author2 = await fan(d, "Second Author");
  const old = [];
  for (let i = 0; i < 3; i++) { await asFan(d, author2); old.push(await comment(d, `old ${i}`)); }
  await hide(old[0]);
  await hide(old[1]);
  await sudo(d, "update post set hidden_at = now() - interval '31 days' where id = any($1)", [[old[0], old[1]]]);
  await hide(old[2]);
  assert.equal((await sudo(d, "select muted_until from profile where user_id = $1", [author2])).rows[0].muted_until, null);
});

test("the owner's overrides refuse everyone who is not the admin, and each writes an audit row", async () => {
  const d = await db();
  const author = await fan(d, "Author Fan");
  const flaggers = await fans(d, 3);
  await asFan(d, author);
  const pid = await comment(d, "hidden soon");
  for (const f of flaggers) { await asFan(d, f); await d.query("select flag_post($1)", [pid]); }
  assert.equal((await visible(d)).length, 0);
  const calls = [`select admin_unhide_post('${pid}')`, `select admin_unmute('${author}')`, `select admin_set_ban('${author}', true)`, "select admin_moderation_overview()"];
  for (const who of [author, flaggers[0]]) {
    await asFan(d, who);
    for (const c of calls) await assert.rejects(d.query(c), /admin_only/, c);
  }
  await as(d, "anon");
  await assert.rejects(d.query(calls[0]), /permission denied/);
  await as(d, "authenticated", "");
  await assert.rejects(d.query(calls[0]), /admin_only/);

  await asFan(d, ADMIN);
  const overview = (await d.query("select admin_moderation_overview() as o")).rows[0].o;
  assert.equal(overview.hidden_posts.length, 1);
  assert.equal(overview.hidden_posts[0].flags, 3);
  await d.query("select admin_unhide_post($1, 'fine')", [pid]);
  assert.equal((await visible(d)).length, 1);
  // Cleared: more flags never hide it again.
  const more = await fans(d, 3);
  for (const f of more) { await asFan(d, f); await d.query("select flag_post($1)", [pid]); }
  assert.equal((await visible(d)).length, 1);

  await sudo(d, "update profile set muted_until = now() + interval '3 days' where user_id = $1", [author]);
  await asFan(d, ADMIN);
  await d.query("select admin_unmute($1, 'ok')", [author]);
  await assert.rejects(d.query("select admin_unmute($1)", [author]), /not_found/);
  await d.query("select admin_set_ban($1, true, 'spam')", [author]);
  assert.equal((await visible(d)).length, 0, "a banned account's comments are not shown");
  await asFan(d, author);
  await assert.rejects(comment(d, "hi"), /banned/);
  await asFan(d, ADMIN);
  await d.query("select admin_set_ban($1, false)", [author]);
  assert.equal((await visible(d)).length, 1);

  const audit = (await sudo(d, "select actor, entity, entity_id, before, after, reason from audit_log where entity in ('post', 'profile') order by id")).rows;
  assert.deepEqual(audit.map((r) => [r.entity, r.reason]), [["post", "fine"], ["profile", "ok"], ["profile", "spam"], ["profile", null]]);
  assert.ok(audit.every((r) => r.actor === ADMIN));
  assert.ok(!JSON.stringify(audit).includes("hidden soon"), "the audit row never holds the text");
});

test("deleting an account removes the fan's posts, edits and flags, and no one else's", async () => {
  const d = await db();
  const [a, b] = [await fan(d, "Leaving Fan"), await fan(d, "Staying Fan")];
  await asFan(d, a);
  const mine = await comment(d, "mine");
  await d.query("select edit_post($1, 'mine, edited')", [mine]);
  await asFan(d, b);
  const theirs = await comment(d, "theirs");
  await d.query("select flag_post($1)", [mine]);
  await asFan(d, a);
  await d.query("select flag_post($1)", [theirs]);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  assert.deepEqual((await d.query("select body from post")).rows, [{ body: "theirs" }]);
  assert.equal((await d.query("select count(*)::int as n from post_edit")).rows[0].n, 0);
  assert.equal((await d.query("select count(*)::int as n from post_flag")).rows[0].n, 0);
});

test("one account's writes take a lock on that account until the transaction ends, so parallel requests cannot share a count", async () => {
  const d = await db();
  const id = await fan(d, "Bobcat Fan");
  assert.equal((await sudo(d, "select provolatile from pg_proc where proname = 'fan_actor'")).rows[0].provolatile, "v", "volatile: it runs on its own snapshot after the wait");
  const held = `select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
    and ((classid::bigint << 32) | objid::bigint) = hashtextextended('${id}', 0)`;
  await asFan(d, id);
  await d.query("begin");
  assert.equal((await sudo(d, held)).rows[0].n, 0);
  await asFan(d, id);
  await comment(d, "one");
  assert.equal((await sudo(d, held)).rows[0].n, 1, "taken by the comment");
  await d.query("commit");
  assert.equal((await sudo(d, held)).rows[0].n, 0, "released with the transaction");
  // The other writers take it too: a flag, a thread (forums), a score report all start with fan_actor().
  const src = (await sudo(d, "select string_agg(prosrc, ' ') as s from pg_proc where proname in ('add_comment','edit_post','flag_post','submit_score_report','create_thread','reply_to_thread')")).rows[0].s;
  assert.equal((src.match(/fan_actor\(\)/g) ?? []).length, 6);
});

test("an edit takes back the owner's clearance: the new words can be flagged and hidden again", async () => {
  const d = await db();
  const author = await fan(d, "Author Fan");
  const flaggers = await fans(d, 4);
  await asFan(d, author);
  const pid = await comment(d, "words the owner will read");
  for (const f of flaggers.slice(0, 3)) { await asFan(d, f); await d.query("select flag_post($1)", [pid]); }
  assert.equal((await visible(d)).length, 0);
  await asFan(d, ADMIN);
  await d.query("select admin_unhide_post($1)", [pid]);
  assert.notEqual((await sudo(d, "select cleared_at from post where id = $1", [pid])).rows[0].cleared_at, null);
  await asFan(d, author);
  await d.query("select edit_post($1, 'words the owner will read, and then some')", [pid]);
  assert.equal((await sudo(d, "select cleared_at from post where id = $1", [pid])).rows[0].cleared_at, null);
  await asFan(d, flaggers[3]);
  await d.query("select flag_post($1)", [pid]);
  assert.equal((await visible(d)).length, 0, "three counting flags hide the edited post again");
});
