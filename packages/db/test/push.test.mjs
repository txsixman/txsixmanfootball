import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";

// Push subscriptions (migration 0008): only an endpoint, two keys and program slugs; reached by the API roles only
// through push_follow and push_unfollow. Migration 0018: a full table evicts the oldest unconfirmed row, never a confirmed one.
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123:APA91bExample-token_value";
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);

async function db() {
  const d = new PGlite();
  await d.exec("create role anon; create role authenticated;");
  await migrate(d);
  return d;
}

test("follow stores only the endpoint, keys and sorted, unique program slugs; following again replaces them", async () => {
  const d = await db();
  await d.query("select push_follow($1, $2, $3, $4)", [ENDPOINT, P256DH, AUTH, ["jayton", "guthrie", "jayton"]]);
  const cols = await d.query(
    "select column_name from information_schema.columns where table_name = 'push_subscription' order by ordinal_position",
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ["endpoint", "p256dh", "auth", "programs", "created_at", "updated_at", "confirmed_at"]);
  assert.deepEqual((await d.query("select programs from push_subscription")).rows[0].programs, ["guthrie", "jayton"]);
  await d.query("select push_follow($1, $2, $3, $4)", [ENDPOINT, P256DH, AUTH, ["strawn"]]);
  assert.deepEqual((await d.query("select programs from push_subscription")).rows, [{ programs: ["strawn"] }]);
  await d.query("select push_unfollow($1)", [ENDPOINT]);
  assert.equal((await d.query("select count(*)::int as n from push_subscription")).rows[0].n, 0);
});

test("refuses endpoints outside the browsers' push services, bad keys, bad slugs and too many programs", async () => {
  const d = await db();
  const follow = (e, k, a, p) => d.query("select push_follow($1, $2, $3, $4)", [e, k, a, p]);
  await assert.rejects(follow("https://evil.example.com/push/1", P256DH, AUTH, ["jayton"]), /endpoint_check|check constraint/);
  await assert.rejects(follow("http://fcm.googleapis.com/fcm/send/x", P256DH, AUTH, ["jayton"]), /check constraint/);
  await assert.rejects(follow(ENDPOINT, "short", AUTH, ["jayton"]), /check constraint/);
  await assert.rejects(follow(ENDPOINT, P256DH, AUTH, ["Jayton!"]), /not a slug/);
  await assert.rejects(follow(ENDPOINT, P256DH, AUTH, []), /check constraint/);
  await assert.rejects(follow(ENDPOINT, P256DH, AUTH, Array.from({ length: 26 }, (_, i) => `p${i}`)), /check constraint/);
  for (const ok of ["https://updates.push.services.mozilla.com/wpush/v2/gAAAAB", "https://web.push.apple.com/QOk1x", "https://wns2-bn3p.notify.windows.com/w/?token=AQE%3d"]) {
    await follow(ok, P256DH, AUTH, ["jayton"]);
  }
});

test("the API roles can call follow and unfollow, and nothing else: no table rights, no other function", async () => {
  const d = await db();
  const routines = await d.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype order by 1`,
  );
  assert.deepEqual(routines.rows, [
    { proname: "add_comment", anon: false }, // migration 0013: posts, signed-in fans only
    { proname: "admin_guard", anon: false },
    { proname: "admin_moderation_overview", anon: false },
    { proname: "admin_set_ban", anon: false },
    { proname: "admin_unhide_post", anon: false },
    { proname: "admin_unmute", anon: false },
    { proname: "create_profile", anon: false }, // migration 0011: signed-in fans only
    { proname: "create_thread", anon: false }, // migration 0015: signed-in fans only
    { proname: "delete_my_account", anon: false },
    { proname: "edit_post", anon: false },
    { proname: "fan_actor", anon: false },
    { proname: "fan_post_counts", anon: false },
    { proname: "fan_rate_check", anon: false },
    { proname: "fan_score_status", anon: false }, // migration 0014: a public read, granted to anon only where auth.uid() exists (Supabase)
    { proname: "flag_post", anon: false },
    { proname: "follow_program", anon: false }, // migration 0012: signed-in fans' own follows
    { proname: "forum_boards", anon: false }, // migration 0015: public reads, granted to anon only where auth.uid() exists (Supabase)
    { proname: "forum_posts", anon: false },
    { proname: "forum_thread_info", anon: false },
    { proname: "forum_thread_visible", anon: false },
    { proname: "forum_threads", anon: false },
    { proname: "is_admin", anon: false }, // migration 0010: not for anon, ever
    { proname: "list_comments", anon: false }, // migration 0013: a public read, granted to anon only where auth.uid() exists (Supabase)
    { proname: "live_scores", anon: true }, // migration 0016: the games under way, read-only, for anon and signed-in alike
    { proname: "moderation_blocked", anon: false },
    { proname: "moderation_name_blocked", anon: false },
    { proname: "moderation_normalize", anon: false },
    { proname: "moderation_reserved_name", anon: false },
    { proname: "moderation_strip", anon: false },
    { proname: "my_follows", anon: false },
    { proname: "my_profile", anon: false },
    { proname: "post_evaluate", anon: false },
    { proname: "post_link_count", anon: false },
    { proname: "post_text_check", anon: false },
    { proname: "push_follow", anon: true },
    { proname: "push_unfollow", anon: true },
    { proname: "record_admin_audit", anon: false },
    { proname: "reply_to_thread", anon: false },
    { proname: "resolve_game_key", anon: false },
    { proname: "results_read_at", anon: true }, // migration 0017: when the last game-day read finished, read-only, for anon and signed-in alike
    { proname: "submit_score_report", anon: false }, // migration 0014: signed-in fans only
    { proname: "unfollow_program", anon: false },
  ]);
  await d.exec("set role anon");
  await assert.rejects(d.query("select * from push_subscription"), /permission denied/);
  await d.query("select push_follow($1, $2, $3, $4)", [ENDPOINT, P256DH, AUTH, ["jayton"]]);
  await d.exec("reset role");
  assert.equal((await d.query("select count(*)::int as n from push_subscription")).rows[0].n, 1);
  assert.deepEqual(await checkLive(d), []);
  // As on Supabase (rls_auto_enable): an event trigger function cannot be called, so it is no problem.
  await d.exec("create function auto_rls() returns event_trigger language plpgsql as 'begin end'");
  assert.deepEqual(await checkLive(d), []);
  await d.exec("create function leak() returns int language sql as 'select 1'");
  assert.deepEqual(await checkLive(d), ["anon can run public.leak()", "authenticated can run public.leak()"]);
  // An overload of an allowed name is not allowed with it; a security-definer function must pin its search_path.
  await d.exec("drop function leak(); create function is_admin(p int) returns boolean language sql as 'select false'");
  assert.deepEqual(await checkLive(d), ["anon can run public.is_admin(integer)", "authenticated can run public.is_admin(integer)"]);
  await d.exec("drop function is_admin(int); create function unpinned() returns int language sql security definer as 'select 1'");
  assert.deepEqual(await checkLive(d), ["anon can run public.unpinned()", "authenticated can run public.unpinned()", "public.unpinned() is security definer with no search_path"]);
});

// A table of 5,000 made-up rows (as an anonymous flood would leave it): row i was last active i minutes after the first.
async function fullDb() {
  const d = await db();
  await d.query(
    `insert into push_subscription (endpoint, p256dh, auth, programs, created_at, updated_at)
     select 'https://fcm.googleapis.com/fcm/send/flood' || i, $1, $2, array['jayton'],
            timestamptz '2026-11-01' + i * interval '1 minute', timestamptz '2026-11-01' + i * interval '1 minute'
       from generate_series(1, 5000) i`,
    [P256DH, AUTH],
  );
  return d;
}
const count = async (d) => (await d.query("select count(*)::int as n from push_subscription")).rows[0].n;
const has = async (d, endpoint) => (await d.query("select 1 from push_subscription where endpoint = $1", [endpoint])).rows.length === 1;
const flood = (i) => `https://fcm.googleapis.com/fcm/send/flood${i}`;

test("a full table no longer locks new browsers out: the least recently active unconfirmed row makes room", async () => {
  const d = await fullDb();
  await d.exec("set role anon"); // as the site calls it
  await d.query("select push_follow($1, $2, $3, $4)", [ENDPOINT, P256DH, AUTH, ["strawn"]]);
  await d.query("select push_follow($1, $2, $3, $4)", [`${ENDPOINT}2`, P256DH, AUTH, ["strawn"]]);
  await d.exec("reset role");
  assert.equal(await count(d), 5000);
  assert.ok(await has(d, ENDPOINT));
  assert.ok(!(await has(d, flood(1))) && !(await has(d, flood(2))), "the two oldest went");
  assert.ok(await has(d, flood(3)));
});

test("eviction only touches unconfirmed rows: confirmed ones survive even when they are the oldest", async () => {
  const d = await fullDb();
  await d.query("update push_subscription set confirmed_at = now() where endpoint in ($1, $2)", [flood(1), flood(2)]);
  await d.query("select push_follow($1, $2, $3, $4)", [ENDPOINT, P256DH, AUTH, ["strawn"]]);
  assert.equal(await count(d), 5000);
  assert.ok((await has(d, flood(1))) && (await has(d, flood(2))), "confirmed rows stay");
  assert.ok(!(await has(d, flood(3))), "the oldest unconfirmed row went");
  assert.equal((await d.query("select count(*)::int as n from push_subscription where confirmed_at is not null")).rows[0].n, 2);
});

test("when all 5,000 are confirmed the table stays full and refuses a new browser; a known browser can still change its follows", async () => {
  const d = await fullDb();
  await d.query("update push_subscription set confirmed_at = now()");
  await assert.rejects(d.query("select push_follow($1, $2, $3, $4)", [ENDPOINT, P256DH, AUTH, ["strawn"]]), /no room for new subscriptions/);
  assert.equal(await count(d), 5000);
  await d.query("select push_follow($1, $2, $3, $4)", [flood(7), P256DH, AUTH, ["strawn"]]);
  assert.deepEqual((await d.query("select programs from push_subscription where endpoint = $1", [flood(7)])).rows, [{ programs: ["strawn"] }]);
  assert.equal(await count(d), 5000);
});

test("below the cap nothing is evicted, and the API roles still have no table rights", async () => {
  const d = await db();
  await d.query("select push_follow($1, $2, $3, $4)", [ENDPOINT, P256DH, AUTH, ["strawn"]]);
  await d.query("select push_follow($1, $2, $3, $4)", [`${ENDPOINT}2`, P256DH, AUTH, ["strawn"]]);
  assert.equal(await count(d), 2);
  await d.exec("set role anon");
  await assert.rejects(d.query("select confirmed_at from push_subscription"), /permission denied/);
  await assert.rejects(d.query("update push_subscription set confirmed_at = now()"), /permission denied/);
});
