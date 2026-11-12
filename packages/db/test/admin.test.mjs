import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";

// Admin console (migration 0010): one signed-in admin may append to audit_log, only through record_admin_audit(); nobody
// can touch the table directly, read it back, or change it.
const ADMIN = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const ENTITY = "22222222-3333-4333-8333-444444444444";
const audit = (reason = "test") => `select record_admin_audit('game_correction', '${ENTITY}', '{"home":1}', '{"home":2}', '${reason}') as id`;

async function db() {
  const d = new PGlite();
  // What Supabase has: the two API roles and auth.uid(), which reads the caller's JWT subject (here, a setting).
  await d.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await migrate(d);
  await d.query("insert into admin_user (user_id) values ($1)", [ADMIN]);
  return d;
}
const as = (d, role, sub) => d.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role}`);
const nextId = async (d) => {
  await d.exec("reset role");
  return Number((await d.query("select last_value::bigint as v, is_called from audit_log_id_seq")).rows[0].v);
};

test("migration 0010 inserts no admin: admin_user is empty until the owner adds his id by hand", async () => {
  const d = new PGlite();
  await migrate(d);
  assert.equal((await d.query("select count(*)::int as n from admin_user")).rows[0].n, 0);
});

test("the admin's call appends an audit row as themselves and returns its id", async () => {
  const d = await db();
  await as(d, "authenticated", ADMIN);
  assert.equal((await d.query("select is_admin() as a")).rows[0].a, true);
  const { rows: [{ id }] } = await d.query(audit());
  assert.equal(Number(id), 1);
  await d.exec("reset role");
  const { rows } = await d.query("select actor, entity, entity_id, before, after, reason from audit_log");
  assert.deepEqual(rows, [{ actor: ADMIN, entity: "game_correction", entity_id: ENTITY, before: { home: 1 }, after: { home: 2 }, reason: "test" }]);
});

test("a signed-in stranger (public sign-ups on) is not an admin and is refused, and the id sequence does not advance", async () => {
  const d = await db();
  await as(d, "authenticated", STRANGER);
  assert.equal((await d.query("select is_admin() as a")).rows[0].a, false);
  const before = await nextId(d);
  await as(d, "authenticated", STRANGER);
  await assert.rejects(d.query(audit()), /not allowed/);
  assert.equal(await nextId(d), before, "a refused call burned an id");
  assert.equal((await d.query("select count(*)::int as n from audit_log")).rows[0].n, 0);
});

test("anon and a signed-out caller cannot run the audit function or is_admin()", async () => {
  const d = await db();
  await as(d, "anon");
  await assert.rejects(d.query(audit()), /permission denied/);
  await assert.rejects(d.query("select is_admin()"), /permission denied/);
  await as(d, "authenticated", "");
  assert.equal((await d.query("select is_admin() as a")).rows[0].a, false);
  await assert.rejects(d.query(audit()), /not allowed/);
});

test("the actor is always the caller: the function takes no actor, and cannot be fooled by the arguments", async () => {
  const d = await db();
  await as(d, "authenticated", ADMIN);
  await d.query(`select record_admin_audit('game_correction', '${ENTITY}', '{"actor": "${STRANGER}"}', null, 'x')`);
  await d.exec("reset role");
  assert.equal((await d.query("select actor from audit_log")).rows[0].actor, ADMIN);
});

test("the function bounds what one row may hold", async () => {
  const d = await db();
  await as(d, "authenticated", ADMIN);
  await assert.rejects(d.query(`select record_admin_audit('', null, null, null, 'x')`), /bad input/);
  await assert.rejects(d.query(`select record_admin_audit('${"e".repeat(65)}', null, null, null, 'x')`), /bad input/);
  await assert.rejects(d.query(audit("r".repeat(501))), /bad input/);
  await assert.rejects(d.query(`select record_admin_audit('x', null, '{"a": "${"b".repeat(20000)}"}', null, 'x')`), /bad input/);
});

test("nobody can insert into, read, update, delete or truncate audit_log directly, the admin included", async () => {
  const d = await db();
  for (const [role, sub] of [["authenticated", ADMIN], ["authenticated", STRANGER], ["anon", ""]]) {
    await as(d, role, sub);
    const before = await nextId(d);
    await as(d, role, sub);
    for (const sql of [
      `insert into audit_log (actor, entity, reason) values ('${ADMIN}', 'game', 'direct')`,
      "select * from audit_log",
      "update audit_log set reason = 'x'",
      "delete from audit_log",
      "truncate audit_log",
    ]) {
      await assert.rejects(d.exec(sql), /permission denied/, `${role}: ${sql}`);
    }
    assert.equal(await nextId(d), before, `${role}: a refused direct insert burned an id`);
  }
  // And the owner's own attempts still hit the append-only triggers (migration 0001).
  await d.exec("reset role");
  await d.exec(`insert into audit_log (entity) values ('seed')`);
  await assert.rejects(d.exec("update audit_log set reason = 'x'"), /cannot be changed/);
  await assert.rejects(d.exec("delete from audit_log"), /cannot be changed/);
});

test("the API roles cannot touch admin_user, so nobody can make themselves an admin", async () => {
  const d = await db();
  for (const [role, sub] of [["authenticated", ADMIN], ["authenticated", STRANGER], ["anon", ""]]) {
    await as(d, role, sub);
    await assert.rejects(d.exec("select * from admin_user"), /permission denied/);
    await assert.rejects(d.exec(`insert into admin_user values ('${STRANGER}')`), /permission denied/);
    await assert.rejects(d.exec("delete from admin_user"), /permission denied/);
  }
});

test("the live check passes with only the two functions granted, and names every wider route, PUBLIC included", async () => {
  const d = await db();
  assert.deepEqual(await checkLive(d), []);
  // Table rights, direct and through PUBLIC.
  await d.exec("grant select on audit_log to authenticated");
  assert.deepEqual(await checkLive(d), ["authenticated holds SELECT on public.audit_log"]);
  await d.exec("revoke select on audit_log from authenticated; grant select on audit_log to public");
  assert.deepEqual(await checkLive(d), ["anon holds SELECT on public.audit_log", "authenticated holds SELECT on public.audit_log"]);
  await d.exec("revoke select on audit_log from public");
  assert.deepEqual(await checkLive(d), []);
  // Column rights, direct and through PUBLIC.
  await d.exec("grant update (reason) on audit_log to authenticated");
  assert.deepEqual(await checkLive(d), ["authenticated holds column UPDATE on public.audit_log"]);
  await d.exec("revoke update (reason) on audit_log from authenticated; grant insert (reason) on audit_log to public");
  assert.deepEqual(await checkLive(d), ["anon holds column INSERT on public.audit_log", "authenticated holds column INSERT on public.audit_log"]);
  await d.exec("revoke insert (reason) on audit_log from public");
  // Views, and every right on a table.
  await d.exec("create view leaky_view as select 1 as x; grant select on leaky_view to public");
  assert.deepEqual(await checkLive(d), ["anon holds SELECT on public.leaky_view", "authenticated holds SELECT on public.leaky_view"]);
  await d.exec("drop view leaky_view");
  await d.exec("grant truncate, trigger, references on admin_user to anon");
  assert.deepEqual(await checkLive(d), ["anon holds REFERENCES,TRIGGER,TRUNCATE on public.admin_user"]);
  await d.exec("revoke all on admin_user from anon");
  // Functions.
  await d.exec("grant execute on function is_admin() to anon");
  assert.deepEqual(await checkLive(d), ["anon can run public.is_admin()"]);
  await d.exec("revoke execute on function is_admin() from anon");
  await d.exec("grant execute on function record_admin_audit(text, uuid, jsonb, jsonb, text) to public");
  assert.deepEqual(await checkLive(d), ["anon can run public.record_admin_audit(text, uuid, jsonb, jsonb, text)"]);
  await d.exec("revoke execute on function record_admin_audit(text, uuid, jsonb, jsonb, text) from public; grant execute on function record_admin_audit(text, uuid, jsonb, jsonb, text) to authenticated");
  // Sequences, direct and through PUBLIC.
  await d.exec("grant usage on sequence audit_log_id_seq to authenticated");
  assert.deepEqual(await checkLive(d), ["authenticated holds USAGE on sequence public.audit_log_id_seq"]);
  await d.exec("revoke usage on sequence audit_log_id_seq from authenticated; grant select on sequence audit_log_id_seq to public");
  assert.deepEqual(await checkLive(d), ["anon holds SELECT on sequence public.audit_log_id_seq", "authenticated holds SELECT on sequence public.audit_log_id_seq"]);
  await d.exec("revoke select on sequence audit_log_id_seq from public");
  // Any policy at all.
  await d.exec("create policy sneaky on audit_log for select to authenticated using (true)");
  assert.deepEqual(await checkLive(d), ["unexpected policy sneaky on public.audit_log"]);
  // And the ops schema is covered too.
  await d.exec("drop policy sneaky on audit_log; grant usage on schema ops to anon; grant select on ops.schema_migrations to public");
  assert.deepEqual(await checkLive(d), ["anon holds SELECT on ops.schema_migrations", "authenticated holds SELECT on ops.schema_migrations"]);
});
