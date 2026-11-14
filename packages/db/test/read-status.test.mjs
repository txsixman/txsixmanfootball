import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";
import { validateLiveRows, writeLive } from "../live.mjs";

// The time of the last game-day read (migration 0017, ADR 0038): one row, written by live.mjs in its own transaction, read by
// the browser only through results_read_at().
const T1 = new Date("2026-11-13T01:10:00Z");
const T2 = new Date("2026-11-13T01:20:00Z");
const readAt = async (d) => (await d.query("select results_read_at() as at")).rows[0].at;
const stored = async (d) => (await d.query("select read_at from read_status")).rows.map((r) => r.read_at.toISOString());

async function supabaseLike() {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;`);
  await migrate(d);
  return d;
}

test("results_read_at() is null until a run has written, then the latest run's time", async () => {
  const d = await supabaseLike();
  assert.equal(await readAt(d), null);
  await writeLive(d, [], T1);
  assert.equal((await readAt(d)).toISOString(), T1.toISOString());
});

test("every run writes the time, with no game under way as well as with one, and a newer run replaces the older", async () => {
  const d = await supabaseLike();
  assert.deepEqual(await writeLive(d, [], T1), { written: 0, removedNotLive: 0, removedStale: 0 });
  assert.deepEqual(await stored(d), [T1.toISOString()]);
  const game = validateLiveRows([{ game_key: "2026-11-13|salt-fork|cedar-gap", home: "salt-fork", away: "cedar-gap", home_score: 7, away_score: 0, period: "Q1", read_at: T2.toISOString() }]);
  await writeLive(d, game, T2);
  assert.deepEqual(await stored(d), [T2.toISOString()]); // still one row: no history
  await writeLive(d, [], T1); // an older run finishing late never moves the time back
  assert.deepEqual(await stored(d), [T2.toISOString()]);
});

test("the table holds exactly one row", async () => {
  const d = await supabaseLike();
  await d.exec("insert into read_status (read_at) values ('2026-11-13T01:10:00Z')");
  await assert.rejects(d.exec("insert into read_status (read_at) values ('2026-11-13T01:20:00Z')"), /duplicate key|unique/);
  await assert.rejects(d.exec("insert into read_status (id, read_at) values (false, now())"), /check/);
  await assert.rejects(d.exec("insert into read_status (id, read_at) values (null, now())"), /null/);
  await assert.rejects(d.exec("update read_status set read_at = null"), /null/);
  assert.equal((await d.query("select count(*)::int as n from read_status")).rows[0].n, 1);
});

test("a failed run rolls back and leaves the earlier time (and the earlier games)", async () => {
  const d = await supabaseLike();
  const good = validateLiveRows([{ game_key: "2026-11-13|salt-fork|cedar-gap", home: "salt-fork", away: "cedar-gap", home_score: 7, away_score: 0, period: "Q1", read_at: new Date().toISOString() }]);
  await writeLive(d, good, T1);
  // A row that skips validateLiveRows and breaks the table's own check, after the time was written inside the transaction.
  const bad = { ...good[0], game_key: "2026-11-13|a|b", home: "a", away: "b", home_score: 999 };
  await assert.rejects(writeLive(d, [bad], T2), /home_score/);
  assert.deepEqual(await stored(d), [T1.toISOString()]);
  assert.equal((await d.query("select count(*)::int as n from live_score where game_key = $1", [good[0].game_key])).rows[0].n, 1);
});

test("anon and authenticated run results_read_at() and cannot touch read_status in any way", async () => {
  const d = await supabaseLike();
  await writeLive(d, [], T1);
  for (const role of ["anon", "authenticated"]) {
    await d.exec(`set role ${role}`);
    assert.equal((await readAt(d)).toISOString(), T1.toISOString());
    await assert.rejects(d.query("select * from read_status"), /permission denied/);
    await assert.rejects(d.exec("insert into read_status (id, read_at) values (true, now())"), /permission denied/);
    await assert.rejects(d.exec("update read_status set read_at = now()"), /permission denied/);
    await assert.rejects(d.exec("delete from read_status"), /permission denied/);
    await assert.rejects(d.exec("truncate read_status"), /permission denied/);
    await d.exec("reset role");
  }
  assert.deepEqual(await stored(d), [T1.toISOString()]);
});

test("the function is read-only, pinned, and closed to PUBLIC; the live check is clean and names a table right or a policy", async () => {
  const d = await supabaseLike();
  const { rows } = await d.query(
    `select p.provolatile, p.prosecdef, p.proconfig, p.prorettype::regtype::text as ret, has_function_privilege('public', p.oid, 'execute') as public_can
       from pg_proc p where p.proname = 'results_read_at'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provolatile, "s");
  assert.equal(rows[0].prosecdef, true);
  assert.deepEqual(rows[0].proconfig, ["search_path=public, pg_temp"]);
  assert.equal(rows[0].ret, "timestamp with time zone");
  assert.equal(rows[0].public_can, false);
  assert.equal((await d.query("select relrowsecurity from pg_class where relname = 'read_status'")).rows[0].relrowsecurity, true);
  assert.deepEqual(await checkLive(d), []);
  await d.exec("grant select on read_status to anon");
  assert.deepEqual(await checkLive(d), ["anon holds SELECT on public.read_status"]);
  await d.exec("revoke select on read_status from anon");
  assert.deepEqual(await checkLive(d), []);
});
