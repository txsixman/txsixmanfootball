import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";

// Fan profiles (migration 0011, ADR 0018): own row only, through functions; under 13 refused and nothing stored.
const FAN = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const YEAR = Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/Chicago" }).format(new Date()));

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
const count = async (d) => (await d.exec("reset role"), (await d.query("select count(*)::int as n from profile")).rows[0].n);

test("a fan of 13 or older makes a profile and reads it back without the birth year", async () => {
  const d = await db();
  await as(d, "authenticated", FAN);
  await d.query("select create_profile($1, $2, false)", ["Bobcat Fan", YEAR - 20]);
  const { rows } = await d.query("select * from my_profile()");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, "Bobcat Fan");
  assert.ok(!("birth_year" in rows[0]));
});

test("under 13 is refused and nothing is stored; the 13th birth year needs the birthday to have passed", async () => {
  const d = await db();
  await as(d, "authenticated", FAN);
  await assert.rejects(d.query("select create_profile('Kid', $1, true)", [YEAR - 12]), /under 13/);
  await assert.rejects(d.query("select create_profile('Kid', $1, false)", [YEAR - 13]), /under 13/);
  assert.equal(await count(d), 0);
  await as(d, "authenticated", FAN);
  await d.query("select create_profile('Teen', $1, true)", [YEAR - 13]);
  assert.equal(await count(d), 1);
});

test("display names are unique regardless of case and shaped (no links, no symbols)", async () => {
  const d = await db();
  await as(d, "authenticated", FAN);
  await d.query("select create_profile('Bobcat Fan', $1, false)", [YEAR - 30]);
  await as(d, "authenticated", OTHER);
  await assert.rejects(d.query("select create_profile('bobcat fan', $1, false)", [YEAR - 30]), /duplicate/);
  await assert.rejects(d.query("select create_profile('x.com/spam', $1, false)", [YEAR - 30]), /check constraint/);
});

test("nobody reads or writes the table directly; signed-out callers cannot use the functions", async () => {
  const d = await db();
  await as(d, "authenticated", FAN);
  await d.query("select create_profile('Bobcat Fan', $1, false)", [YEAR - 30]);
  await assert.rejects(d.query("select * from profile"), /permission denied/);
  await assert.rejects(d.exec("update profile set banned = false"), /permission denied/);
  await as(d, "anon");
  await assert.rejects(d.query("select * from my_profile()"), /permission denied/);
  await as(d, "authenticated", "");
  await assert.rejects(d.query("select create_profile('Ghost', $1, false)", [YEAR - 30]), /not signed in/);
  await d.exec("reset role");
  assert.deepEqual(await checkLive(d), []);
});

test("delete my account removes the fan's profile only", async () => {
  const d = await db();
  await as(d, "authenticated", FAN);
  await d.query("select create_profile('Bobcat Fan', $1, false)", [YEAR - 30]);
  await as(d, "authenticated", OTHER);
  await d.query("select create_profile('Other Fan', $1, false)", [YEAR - 30]);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  const { rows } = await d.query("select display_name from profile");
  assert.deepEqual(rows, [{ display_name: "Bobcat Fan" }]);
});

test("unfinished sign-ups are erased only after the first fan profile exists, and never the admin, older accounts or fresh ones", async () => {
  const { purgeUnfinishedSignups } = await import("../load.mjs");
  const d = await db();
  const ADMIN = "55555555-5555-4555-8555-555555555555";
  const BEFORE = "66666666-6666-4666-8666-666666666666"; // made before launch (the owner's admin account before his id is in admin_user)
  const STALE = "77777777-7777-4777-8777-777777777777";
  const FRESH = "88888888-8888-4888-8888-888888888888";
  const ADMIN_LATE = "99999999-9999-4999-8999-999999999999";
  await d.exec("reset role");
  assert.equal(await purgeUnfinishedSignups(d), 0); // no auth.users table here yet: nothing to do
  await d.exec(`create table auth.users (id uuid primary key, created_at timestamptz not null default now());
    insert into auth.users values ('${BEFORE}', now() - interval '60 days'), ('${ADMIN}', now() - interval '60 days'),
      ('${FAN}', now() - interval '30 days'), ('${STALE}', now() - interval '20 days'), ('${FRESH}', now() - interval '1 day'),
      ('${ADMIN_LATE}', now() - interval '20 days');
    insert into admin_user values ('${ADMIN}'), ('${ADMIN_LATE}');`);
  // No fan profile yet: nothing is erased, however old.
  assert.equal(await purgeUnfinishedSignups(d), 0);
  assert.equal((await d.query("select count(*)::int as n from auth.users")).rows[0].n, 6);
  await as(d, "authenticated", FAN);
  await d.query("select create_profile('Bobcat Fan', $1, false)", [YEAR - 30]);
  await d.exec("reset role");
  await d.exec(`update profile set created_at = now() - interval '25 days'`); // the first fan finished 25 days ago
  // STALE (20 days, after the first profile, no profile) goes; BEFORE predates it; ADMIN_LATE is in admin_user; FRESH is new.
  assert.equal(await purgeUnfinishedSignups(d), 1);
  const { rows } = await d.query("select id from auth.users order by id");
  assert.deepEqual(rows.map((r) => r.id).sort(), [BEFORE, ADMIN, FAN, FRESH, ADMIN_LATE].sort());
});

test("erasing an account or an unfinished sign-up also clears Supabase's flow_state and audit log copies", async () => {
  const { purgeUnfinishedSignups } = await import("../load.mjs");
  const d = await db();
  const GONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const KEPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await d.exec("reset role");
  await d.exec(`create table auth.users (id uuid primary key, created_at timestamptz not null default now());
    create table auth.flow_state (id uuid primary key default gen_random_uuid(), user_id uuid);
    create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json);
    insert into auth.users values ('${FAN}', now() - interval '30 days'), ('${OTHER}', now() - interval '30 days'),
      ('${GONE}', now() - interval '20 days'), ('${KEPT}', now() - interval '20 days');
    insert into auth.flow_state (user_id) values ('${FAN}'), ('${OTHER}'), ('${GONE}'), ('${KEPT}');
    insert into auth.audit_log_entries (payload) values
      ('{"actor_id":"${FAN}","action":"login"}'), ('{"actor_id":"${OTHER}","action":"login"}'),
      ('{"actor_id":"x","action":"user_signedup","traits":{"user_id":"${GONE}"}}'), ('{"actor_id":"${GONE}","action":"login"}'),
      ('{"actor_id":"${KEPT}","action":"login"}');
    insert into admin_user values ('${KEPT}');`);
  // delete_my_account: the fan's own rows go, nobody else's.
  await as(d, "authenticated", FAN);
  await d.query("select create_profile('Bobcat Fan', $1, false)", [YEAR - 30]);
  await as(d, "authenticated", OTHER);
  await d.query("select create_profile('Other Fan', $1, false)", [YEAR - 30]);
  await d.exec(`reset role; update profile set created_at = now() - interval '25 days'`);
  await as(d, "authenticated", FAN);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  assert.deepEqual((await d.query("select id from auth.users where id = '" + FAN + "'")).rows, []);
  assert.deepEqual((await d.query("select user_id from auth.flow_state where user_id = '" + FAN + "'")).rows, []);
  assert.equal((await d.query("select count(*)::int as n from auth.audit_log_entries where payload->>'actor_id' = '" + FAN + "'")).rows[0].n, 0);
  assert.equal((await d.query("select count(*)::int as n from auth.flow_state")).rows[0].n, 3);
  assert.equal((await d.query("select count(*)::int as n from auth.audit_log_entries")).rows[0].n, 4);
  // The purge does the same for an unfinished sign-up (GONE: profile-less, 20 days old, after the first profile).
  assert.equal(await purgeUnfinishedSignups(d), 1);
  assert.deepEqual((await d.query("select user_id from auth.flow_state order by 1")).rows.map((r) => r.user_id).sort(), [KEPT, OTHER].sort());
  assert.deepEqual((await d.query("select payload->>'actor_id' as a from auth.audit_log_entries order by 1")).rows.map((r) => r.a).sort(), [KEPT, OTHER].sort());
  assert.equal((await d.query("select count(*)::int as n from auth.users")).rows[0].n, 2);
});
