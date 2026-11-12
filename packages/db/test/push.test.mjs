import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";

// Push subscriptions (migration 0008): only an endpoint, two keys and program slugs; reached by the API roles only
// through push_follow and push_unfollow.
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
  assert.deepEqual(cols.rows.map((r) => r.column_name), ["endpoint", "p256dh", "auth", "programs", "created_at", "updated_at"]);
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
  assert.deepEqual(routines.rows, [{ proname: "push_follow", anon: true }, { proname: "push_unfollow", anon: true }]);
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
});
