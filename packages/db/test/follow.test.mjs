import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";

// Account follows (migration 0012, ADR 0018): own rows only, through functions; a cap of 100; gone with the account.
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
const signUp = async (d, sub, name) => {
  await as(d, "authenticated", sub);
  await d.query("select create_profile($1, $2, false)", [name, YEAR - 30]);
};
const mine = async (d) => (await d.query("select program_slug from my_follows()")).rows.map((r) => r.program_slug);

test("a fan follows and unfollows programs, sees only their own, and following twice is harmless", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await signUp(d, OTHER, "Other Fan");
  await as(d, "authenticated", FAN);
  await d.query("select follow_program('jayton')");
  await d.query("select follow_program('guthrie')");
  await d.query("select follow_program('jayton')");
  assert.deepEqual((await mine(d)).sort(), ["guthrie", "jayton"]);
  await as(d, "authenticated", OTHER);
  assert.deepEqual(await mine(d), []);
  await d.query("select follow_program('strawn')");
  await d.query("select unfollow_program('jayton')"); // not theirs: nothing happens to the other fan's row
  await as(d, "authenticated", FAN);
  await d.query("select unfollow_program('guthrie')");
  assert.deepEqual(await mine(d), ["jayton"]);
});

test("nobody reaches the table directly, anon cannot use the functions, and the live check stays clean", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await d.query("select follow_program('jayton')");
  await assert.rejects(d.query("select * from follow"), /permission denied/);
  await assert.rejects(d.exec("insert into follow (user_id, program_slug) values ('" + FAN + "', 'x')"), /permission denied/);
  await assert.rejects(d.exec("delete from follow"), /permission denied/);
  await as(d, "anon");
  await assert.rejects(d.query("select follow_program('jayton')"), /permission denied/);
  await assert.rejects(d.query("select * from my_follows()"), /permission denied/);
  await as(d, "authenticated", "");
  await assert.rejects(d.query("select follow_program('jayton')"), /not signed in/);
  await assert.rejects(d.query("select unfollow_program('jayton')"), /not signed in/);
  await d.exec("reset role");
  assert.deepEqual(await checkLive(d), []);
  assert.equal((await d.query("select relrowsecurity from pg_class where relname = 'follow'")).rows[0].relrowsecurity, true);
});

test("a bad slug is refused, and so is following before sign-up is finished", async () => {
  const d = await db();
  await as(d, "authenticated", FAN);
  await assert.rejects(d.query("select follow_program('jayton')"), /finish sign-up first/);
  await d.query("select create_profile('Bobcat Fan', $1, false)", [YEAR - 30]);
  for (const bad of ["Jayton", "a b", "x/../y", "-a", "a-", "", "a".repeat(81)]) {
    await assert.rejects(d.query("select follow_program($1)", [bad]), /not a program slug/, bad);
  }
  await assert.rejects(d.query("select follow_program(null)"), /not a program slug/);
  assert.deepEqual(await mine(d), []);
});

test("at most 100 follows per account; one already followed can be re-followed, and one unfollowed frees a place", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  for (let i = 0; i < 100; i++) await d.query("select follow_program($1)", [`school-${i}`]);
  await assert.rejects(d.query("select follow_program('one-too-many')"), /at most 100/);
  await d.query("select follow_program('school-7')");
  assert.equal((await mine(d)).length, 100);
  await d.query("select unfollow_program('school-7')");
  await d.query("select follow_program('one-too-many')");
  assert.equal((await mine(d)).length, 100);
  // The cap is per account: another fan has a full allowance.
  await signUp(d, OTHER, "Other Fan");
  await d.query("select follow_program('school-0')");
  assert.deepEqual(await mine(d), ["school-0"]);
});

test("deleting the account removes the fan's follows and no one else's", async () => {
  const d = await db();
  await signUp(d, FAN, "Bobcat Fan");
  await d.query("select follow_program('jayton')");
  await signUp(d, OTHER, "Other Fan");
  await d.query("select follow_program('guthrie')");
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  assert.deepEqual((await d.query("select user_id, program_slug from follow")).rows, [{ user_id: FAN, program_slug: "jayton" }]);
  await as(d, "authenticated", FAN);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  assert.equal((await d.query("select count(*)::int as n from follow")).rows[0].n, 0);
});
