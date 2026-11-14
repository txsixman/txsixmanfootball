import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";

// Push alerts tied to the account (migration 0023, ADR 0054): a signed-in fan's browser is linked to auth.uid(); the
// account's follows then drive its alerts. Sign-out unlinks, deleting the account deletes the subscriptions.
const FAN = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const NO_PROFILE = "55555555-5555-4555-8555-555555555555";
const YEAR = Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/Chicago" }).format(new Date()));
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const endpoint = (id) => `https://fcm.googleapis.com/fcm/send/${id}`;

async function db() {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await migrate(d);
  return d;
}
const as = (d, role, sub) => d.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role}`);
const signUp = async (d, sub, name) => {
  await as(d, "authenticated", sub);
  await d.query("select create_profile($1, $2, false)", [name, YEAR - 30]);
};
const link = async (d, id) => (await d.query("select link_push_subscription($1, $2, $3) as left_over", [endpoint(id), P256DH, AUTH])).rows[0].left_over;
const unlink = (d, id) => d.query("select unlink_push_subscription($1)", [endpoint(id)]);
const rows = async (d) => {
  await d.exec("reset role");
  return (await d.query("select endpoint, programs, user_id from push_subscription order by endpoint")).rows.map((r) => ({ id: r.endpoint.split("/").at(-1), programs: r.programs, user: r.user_id }));
};
const mine = async (d) => (await d.query("select program_slug from my_follows()")).rows.map((r) => r.program_slug).sort();
const browserFollows = (d, id, programs) => d.query("select push_follow($1, $2, $3, $4)", [endpoint(id), P256DH, AUTH, programs]);

test("a signed-in fan links a browser that has no follows of its own: one row on the account, no programs, nothing for anon to see", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  assert.deepEqual(await link(d, "laptop"), []);
  assert.deepEqual(await rows(d), [{ id: "laptop", programs: [], user: FAN }]);
  // Linking again (every page view may) changes nothing but the keys and the time.
  await as(d, "authenticated", FAN);
  assert.deepEqual(await link(d, "laptop"), []);
  assert.equal((await rows(d)).length, 1);
});

test("the browser's own follows move onto the account when it is linked: none is lost, the account is the one list", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await d.query("select follow_program('jayton')");
  await d.exec("reset role");
  await browserFollows(d, "laptop", ["jayton", "strawn", "guthrie"]); // followed signed out, before
  await as(d, "authenticated", FAN);
  assert.deepEqual(await link(d, "laptop"), []);
  assert.deepEqual(await mine(d), ["guthrie", "jayton", "strawn"]);
  assert.deepEqual(await rows(d), [{ id: "laptop", programs: [], user: FAN }]);
});

test("when the account is full the browser's extra follows stay on the browser (returned), and an unfollow clears them", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  for (let i = 0; i < 99; i++) await d.query("select follow_program($1)", [`school-${i}`]);
  await d.exec("reset role");
  await browserFollows(d, "laptop", ["school-5", "strawn", "guthrie"]); // one already on the account, two new for the last place
  await as(d, "authenticated", FAN);
  // Stored sorted: guthrie takes the 100th place, school-5 is already followed, strawn does not fit.
  assert.deepEqual(await link(d, "laptop"), ["strawn"]);
  assert.equal((await mine(d)).length, 100);
  assert.ok((await mine(d)).includes("guthrie") && !(await mine(d)).includes("strawn"));
  assert.deepEqual((await rows(d))[0].programs, ["strawn"]);
});

test("an unfollow also drops the program from the account's linked browsers' own lists", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  for (let i = 0; i < 100; i++) await d.query("select follow_program($1)", [`school-${i}`]);
  await d.exec("reset role");
  await browserFollows(d, "laptop", ["extra-one", "extra-two"]);
  await as(d, "authenticated", FAN);
  assert.deepEqual(await link(d, "laptop"), ["extra-one", "extra-two"]);
  await d.query("select unfollow_program('extra-one')");
  assert.deepEqual((await rows(d))[0].programs, ["extra-two"]);
  await as(d, "authenticated", FAN);
  await d.query("select unfollow_program('school-3')"); // an account follow is not in the browser's list: nothing to strip
  assert.deepEqual((await rows(d))[0].programs, ["extra-two"]);
});

test("linking needs a signed-in fan with a profile, and anon cannot call it", async () => {
  const d = await db();
  await as(d, "anon");
  await assert.rejects(link(d, "laptop"), /permission denied/);
  await assert.rejects(unlink(d, "laptop"), /permission denied/);
  await as(d, "authenticated", "");
  await assert.rejects(link(d, "laptop"), /not signed in/);
  await assert.rejects(unlink(d, "laptop"), /not signed in/);
  await as(d, "authenticated", NO_PROFILE);
  await assert.rejects(link(d, "laptop"), /finish sign-up first/);
  assert.deepEqual(await rows(d), []);
});

test("a bad endpoint or keys are refused by the table's own checks", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  const bad = (e, k, a) => d.query("select link_push_subscription($1, $2, $3)", [e, k, a]);
  await assert.rejects(bad("https://evil.example.com/push/1", P256DH, AUTH), /check constraint/);
  await assert.rejects(bad(endpoint("x"), "short", AUTH), /check constraint/);
  await assert.rejects(bad(null, P256DH, AUTH), /null value|check constraint/);
  assert.deepEqual(await rows(d), []);
});

test("sign-out unlinks only the caller's own browser: another account's, or a made-up, endpoint changes nothing", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await signUp(d, OTHER, "Other Fan");
  await as(d, "authenticated", FAN);
  await link(d, "laptop");
  await as(d, "authenticated", OTHER);
  await link(d, "other-laptop");
  await unlink(d, "laptop"); // OTHER names FAN's endpoint
  await unlink(d, "never-seen");
  assert.deepEqual((await rows(d)).map((r) => r.id), ["laptop", "other-laptop"]);
  await as(d, "authenticated", FAN);
  await unlink(d, "laptop"); // its own: no follows of its own left, so the row is deleted
  assert.deepEqual(await rows(d), [{ id: "other-laptop", programs: [], user: OTHER }]);
});

test("sign-out keeps a browser's own leftover follows (unlinked, as a signed-out browser) and deletes it when none are left", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  for (let i = 0; i < 100; i++) await d.query("select follow_program($1)", [`school-${i}`]);
  await d.exec("reset role");
  await browserFollows(d, "laptop", ["extra-one"]);
  await as(d, "authenticated", FAN);
  await link(d, "laptop");
  await link(d, "tablet");
  await unlink(d, "laptop");
  await unlink(d, "tablet");
  assert.deepEqual(await rows(d), [{ id: "laptop", programs: ["extra-one"], user: null }]);
  // The follows of the account itself are untouched by signing out.
  await as(d, "authenticated", FAN);
  assert.equal((await mine(d)).length, 100);
});

test("a browser linked to one account and linked by another changes hands without handing over what the first followed", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await signUp(d, OTHER, "Other Fan");
  await as(d, "authenticated", FAN);
  for (let i = 0; i < 100; i++) await d.query("select follow_program($1)", [`school-${i}`]);
  await d.exec("reset role");
  await browserFollows(d, "shared", ["secret-team"]);
  await as(d, "authenticated", FAN);
  await link(d, "shared"); // overflow: FAN's browser keeps secret-team
  assert.deepEqual((await rows(d))[0].programs, ["secret-team"]);
  await as(d, "authenticated", OTHER);
  assert.deepEqual(await link(d, "shared"), []);
  assert.deepEqual(await mine(d), []); // the other account did not receive FAN's follow
  assert.deepEqual(await rows(d), [{ id: "shared", programs: [], user: OTHER }]);
  await as(d, "authenticated", FAN);
  assert.equal((await mine(d)).length, 100); // and FAN lost no account follow
});

test("push_follow on a linked browser keeps the link; push_unfollow (Stop alerts) still deletes the row", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await link(d, "laptop");
  await d.exec("reset role");
  await browserFollows(d, "laptop", ["strawn"]);
  assert.deepEqual(await rows(d), [{ id: "laptop", programs: ["strawn"], user: FAN }]);
  await d.query("select push_unfollow($1)", [endpoint("laptop")]);
  assert.deepEqual(await rows(d), []);
});

test("an unlinked row still needs a program; a linked one may have none", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await d.exec("reset role");
  await assert.rejects(browserFollows(d, "laptop", []), /check constraint/);
  await assert.rejects(d.query("insert into push_subscription (endpoint, p256dh, auth, programs) values ($1, $2, $3, '{}')", [endpoint("x"), P256DH, AUTH]), /unlinked_has_programs/);
  await d.query("insert into push_subscription (endpoint, p256dh, auth, programs, user_id) values ($1, $2, $3, '{}', $4)", [endpoint("x"), P256DH, AUTH, FAN]);
});

test("at most 5 browsers an account: a sixth link replaces the least recently active one", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  for (let i = 1; i <= 5; i++) {
    await as(d, "authenticated", FAN);
    await link(d, `b${i}`);
  }
  await d.exec("reset role");
  await d.query("update push_subscription set updated_at = timestamptz '2026-11-01' + (substr(endpoint, length(endpoint))::int * interval '1 day')");
  await as(d, "authenticated", FAN);
  await link(d, "b6");
  await link(d, "b3"); // an already linked browser is not a new one: nothing is replaced
  assert.deepEqual((await rows(d)).map((r) => r.id), ["b2", "b3", "b4", "b5", "b6"]);
});

test("a full table makes room for a new link as push_follow does, and refuses only when all 5,000 are confirmed", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await d.exec("reset role");
  await d.query(
    `insert into push_subscription (endpoint, p256dh, auth, programs, updated_at)
     select 'https://fcm.googleapis.com/fcm/send/flood' || i, $1, $2, array['jayton'], timestamptz '2026-11-01' + i * interval '1 minute'
       from generate_series(1, 5000) i`,
    [P256DH, AUTH],
  );
  await as(d, "authenticated", FAN);
  await link(d, "laptop");
  await d.exec("reset role");
  assert.equal((await d.query("select count(*)::int as n from push_subscription")).rows[0].n, 5000);
  assert.equal((await d.query("select 1 from push_subscription where endpoint like '%flood1'")).rows.length, 0, "the oldest unconfirmed row went");
  await d.query("update push_subscription set confirmed_at = now()");
  await as(d, "authenticated", FAN);
  await assert.rejects(link(d, "tablet"), /no room for new subscriptions/);
  await link(d, "laptop"); // an existing row needs no room
});

test("deleting the account deletes its push subscriptions (explicitly, and by cascade), and nothing else's", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await signUp(d, OTHER, "Other Fan");
  await as(d, "authenticated", OTHER);
  await d.query("select follow_program('strawn')");
  await link(d, "other-laptop");
  await d.exec("reset role");
  await browserFollows(d, "signed-out", ["strawn"]);
  await as(d, "authenticated", FAN);
  await d.query("select follow_program('jayton')");
  await link(d, "laptop");
  await link(d, "phone");
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  assert.deepEqual((await rows(d)).map((r) => r.id), ["other-laptop", "signed-out"]);
  assert.equal((await d.query("select count(*)::int as n from profile where user_id = $1", [FAN])).rows[0].n, 0);
  assert.equal((await d.query("select count(*)::int as n from follow where user_id = $1", [FAN])).rows[0].n, 0);
  // The cascade alone does it too: a profile removed another way (the account's Auth user going) takes the subscriptions.
  await as(d, "authenticated", OTHER);
  await d.exec("reset role");
  await d.query("delete from profile where user_id = $1", [OTHER]);
  assert.deepEqual((await rows(d)).map((r) => r.id), ["signed-out"]);
});

test("delete_my_account still clears Supabase Auth's own copies (migration 0012) where those tables exist", async () => {
  const d = await db();
  await d.exec(`create table auth.users (id uuid primary key);
    create table auth.flow_state (id serial primary key, user_id uuid);
    create table auth.audit_log_entries (id serial primary key, payload jsonb);`);
  await d.query("insert into auth.users values ($1)", [FAN]);
  await signUp(d, FAN, "Bobcat Fan");
  await d.exec("reset role");
  await d.query("insert into auth.flow_state (user_id) values ($1)", [FAN]);
  await d.query("insert into auth.audit_log_entries (payload) values ($1::jsonb)", [JSON.stringify({ actor_id: FAN })]);
  await as(d, "authenticated", FAN);
  await link(d, "laptop");
  await d.exec("reset role"); // the function runs as its owner; grants on auth tables are Supabase's business
  await as(d, "authenticated", FAN);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  for (const t of ["auth.users", "auth.flow_state", "auth.audit_log_entries", "push_subscription", "profile"]) {
    assert.equal((await d.query(`select count(*)::int as n from ${t}`)).rows[0].n, 0, t);
  }
});

test("the API roles hold no rights on the table, cannot read who a browser belongs to, and the live check stays clean", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await link(d, "laptop");
  for (const role of ["anon", "authenticated"]) {
    await as(d, role, FAN);
    await assert.rejects(d.query("select user_id from push_subscription"), /permission denied/, role);
    await assert.rejects(d.query("update push_subscription set user_id = null"), /permission denied/, role);
    await assert.rejects(d.query("delete from push_subscription"), /permission denied/, role);
  }
  await d.exec("reset role");
  assert.deepEqual(await checkLive(d), []);
  const fns = await d.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated, p.prosecdef
       from pg_proc p where p.proname in ('link_push_subscription', 'unlink_push_subscription') order by 1`,
  );
  assert.deepEqual(fns.rows, [
    { proname: "link_push_subscription", anon: false, authenticated: true, prosecdef: true },
    { proname: "unlink_push_subscription", anon: false, authenticated: true, prosecdef: true },
  ]);
});
