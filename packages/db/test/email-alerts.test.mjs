import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";
import { runGameAlerts } from "../../../tools/email/send-game-alerts.mjs";

// Email alerts (migration 0022, ADR 0053): opt-ins are the fan's own, adults only; who is due which alert; never twice;
// unsubscribe with a token and no session; the sender role can run three functions and read nothing; gone with the account.
const YEAR = Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/Chicago" }).format(new Date()));
let n = 0;
const id = () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function db() {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);`);
  await migrate(d);
  return d;
}
const as = (d, role, sub) => d.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role}`);
const sudo = async (d, sql, params) => (await d.exec("reset role"), d.query(sql, params));

/** A fan with a profile (birth year `age` years back), an address, and follows. */
async function fan(d, name, { age = 30, follows = [], confirmed = true } = {}) {
  const uid = id();
  await sudo(d, "insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)", [uid, `${name.toLowerCase().replace(/ /g, ".")}@example.test`, confirmed ? new Date() : null]);
  await as(d, "authenticated", uid);
  await d.query("select create_profile($1, $2, true)", [name, YEAR - age]);
  for (const s of follows) await d.query("select follow_program($1)", [s]);
  return uid;
}
const optIn = async (d, uid, slugs, kind = "game_alerts") => (await as(d, "authenticated", uid), d.query("select email_set_optins($1, $2::text[])", [kind, slugs]));
const settings = async (d, uid) => (await as(d, "authenticated", uid), (await d.query("select * from email_my_settings()")).rows);

const ev = (alert, key, home, away, extra = {}) => ({
  alert, event_key: key, home_slug: home, away_slug: away, home_name: home.toUpperCase(), away_name: away.toUpperCase(),
  round: null, home_score: null, away_score: null, kickoff_at: null, ...extra,
});
const record = async (d, events, baseline = false) => (await as(d, "email_sender"), (await d.query("select email_record_game_events($1::jsonb, $2) as n", [JSON.stringify(events), baseline])).rows[0].n);
const pending = async (d) => (await as(d, "email_sender"), (await d.query("select * from email_pending_game_alerts(500)")).rows);

test("a fan opts in for followed teams or all of them, changes it, and turns it off; nothing is on until they do", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha", "beta"] });
  assert.deepEqual(await settings(d, a), [{ eligible: true, kind: null, program_slug: null }]);
  await optIn(d, a, ["alpha"]);
  assert.deepEqual((await settings(d, a)).map((r) => [r.kind, r.program_slug]), [["game_alerts", "alpha"]]);
  await optIn(d, a, ["*"]);
  assert.deepEqual((await settings(d, a)).map((r) => r.program_slug), ["*"]);
  await optIn(d, a, ["beta", "alpha"]);
  assert.deepEqual((await settings(d, a)).map((r) => r.program_slug), ["alpha", "beta"]);
  await optIn(d, a, []);
  assert.deepEqual((await settings(d, a)).map((r) => r.program_slug), [null]);
});

test("an opt-in is refused for a team not followed, a bad slug, a bad kind, a signed-out caller, anon, and a minor", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await assert.rejects(optIn(d, a, ["gamma"]), /follow the team first/);
  await assert.rejects(optIn(d, a, ["Not A Slug"]), /not a team/);
  await assert.rejects(optIn(d, a, ["alpha"], "marketing"), /not a kind/);
  await as(d, "authenticated", "");
  await assert.rejects(d.query("select email_set_optins('game_alerts', '{*}')"), /not signed in/);
  await assert.rejects(d.query("select * from email_my_settings()"), /not signed in/);
  await as(d, "anon");
  await assert.rejects(d.query("select email_set_optins('game_alerts', '{*}')"), /permission denied/);
  // 15 and 18 years back are not certain adults; 19 is.
  const kid = await fan(d, "Kid", { age: 15, follows: ["alpha"] });
  const eighteen = await fan(d, "Eighteen", { age: 18, follows: ["alpha"] });
  const adult = await fan(d, "Nineteen", { age: 19, follows: ["alpha"] });
  await assert.rejects(optIn(d, kid, ["*"]), /not available/);
  await assert.rejects(optIn(d, eighteen, ["*"]), /not available/);
  await optIn(d, adult, ["*"]);
  assert.equal((await settings(d, kid))[0].eligible, false);
  await sudo(d, "update profile set banned = true where user_id = $1", [adult]);
  await assert.rejects(optIn(d, adult, ["alpha"]), /not available/);
  await optIn(d, adult, []); // turning off is always allowed
});

test("who gets which alert: opted in, following, an adult, confirmed, not banned, event first seen after the opt-in", async () => {
  const d = await db();
  const all = await fan(d, "All Teams", { follows: ["alpha", "beta"] });
  const one = await fan(d, "One Team", { follows: ["alpha", "beta"] });
  const none = await fan(d, "Never Opted", { follows: ["alpha"] });
  const left = await fan(d, "Unfollowed", { follows: ["alpha"] });
  const kid = await fan(d, "Kid", { follows: ["alpha"] });
  const unconfirmed = await fan(d, "Unconfirmed", { follows: ["alpha"], confirmed: false });
  const banned = await fan(d, "Banned", { follows: ["alpha"] });
  for (const f of [all, left, kid, unconfirmed, banned]) await optIn(d, f, ["*"]);
  await optIn(d, one, ["beta"]);
  await as(d, "authenticated", left);
  await d.query("select unfollow_program('alpha')");
  await sudo(d, "update profile set birth_year = $2 where user_id = $1", [kid, YEAR - 15]);
  await sudo(d, "update profile set banned = true where user_id = $1", [banned]);

  // The first recording ever is a baseline: nothing is due, however many events it holds.
  assert.equal(await record(d, [ev("final", "2026-11-06|alpha|zed", "alpha", "zed", { home_score: 7, away_score: 0 })]), 1);
  assert.deepEqual(await pending(d), []);

  assert.equal(await record(d, [
    ev("final", "2026-11-13|alpha|beta", "alpha", "beta", { home_score: 40, away_score: 14, round: "area" }),
    ev("kickoff", "2026-11-20|beta|yak", "beta", "yak", { kickoff_at: "2026-11-20T01:00:00Z" }),
    ev("next_game", "2026|regional|alpha|zed", "alpha", "zed", { round: "regional" }),
  ]), 3);
  const due = (await pending(d)).map((r) => `${r.user_id === all ? "all" : r.user_id === one ? "one" : "other"}:${r.alert}:${r.followed_slug}`).sort();
  assert.deepEqual(due, [
    "all:final:alpha", // follows both teams of the final: one email, not two
    "all:kickoff:beta", "all:next_game:alpha",
    "one:final:beta", "one:kickoff:beta",
  ]);
  const row = (await pending(d)).find((r) => r.user_id === one && r.alert === "final");
  assert.deepEqual([row.email, row.home_score, row.away_score, row.round], ["one.team@example.test", 40, 14, "area"]);

  // Recorded again: nothing new. Marked sent: no longer due, and a refusal for good is not tried again either.
  assert.equal(await record(d, [ev("final", "2026-11-13|alpha|beta", "alpha", "beta")]), 0);
  await as(d, "email_sender");
  await d.query("select email_mark_sent($1, 'game_alerts', 'final:2026-11-13|alpha|beta')", [all]);
  await d.query("select email_mark_sent($1, 'game_alerts', 'kickoff:2026-11-20|beta|yak', 'rejected')", [all]);
  await d.query("select email_mark_sent($1, 'game_alerts', 'final:2026-11-13|alpha|beta')", [all]); // twice is fine
  assert.equal((await pending(d)).filter((r) => r.user_id === all).length, 1);

  // A fan who opts in afterwards is not sent what happened before; an old event is not sent at all.
  await as(d, "authenticated", none);
  await optIn(d, none, ["*"]);
  assert.equal((await pending(d)).filter((r) => r.user_id === none).length, 0);
  await sudo(d, "update email_game_event set first_seen_at = now() - interval '25 hours'");
  assert.deepEqual(await pending(d), []);
});

test("the whole send: due fans get one email each, a failure is counted and never repeated, nothing is sent twice", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  const b = await fan(d, "Fan B", { follows: ["alpha"] });
  const c = await fan(d, "Fan C", { follows: ["alpha"] });
  for (const f of [a, b, c]) await optIn(d, f, ["*"]);
  const sent = [];
  const outcomes = { "fan.b@example.test": "rejected", "fan.c@example.test": "retry" };
  const send = async (m) => (sent.push(m), { outcome: outcomes[m.to] ?? "sent", status: 200 });
  const client = { query: async (sql, p) => (await as(d, "email_sender"), d.query(sql, p)) };
  const run = (events) => runGameAlerts({ db: client, events, from: "A <a@example.test>", apiKey: "k", send, sleep: async () => {}, paceMs: 0 });
  assert.equal((await run([ev("final", "2026-11-06|alpha|zed", "alpha", "zed", { home_score: 1, away_score: 3 })])).due, 0); // baseline
  const r = await run([ev("final", "2026-11-13|alpha|beta", "alpha", "beta", { home_score: 40, away_score: 14 })]);
  assert.deepEqual([r.recorded, r.due, r.sent, r.rejected, r.retry], [1, 3, 1, 1, 1]);
  assert.equal(sent.length, 3);
  assert.ok(sent.every((m) => m.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && /^[0-9a-f]{64}$/.test(m.key)));
  // Each email's links carry that fan's own token: three fans, three different tokens, none of them the user id.
  const tokens = sent.map((m) => /\?t=([0-9a-f-]{36})/.exec(m.headers["List-Unsubscribe"])[1]);
  assert.equal(new Set(tokens).size, 3);
  assert.ok(tokens.every((t) => ![a, b, c].includes(t)));
  // The next run: the sent one and the refused one are done; only the one to retry is tried again.
  sent.length = 0;
  const again = await run([]);
  assert.deepEqual([again.due, sent.map((m) => m.to)], [1, ["fan.c@example.test"]]);
});

const tokenOf = async (d, uid, kind = "game_alerts") => (await sudo(d, "select token from email_unsubscribe_token where user_id = $1 and kind = $2", [uid, kind])).rows[0]?.token;
const optins = async (d) => (await sudo(d, "select user_id, kind::text, program_slug from email_optin order by 1, 2, 3")).rows;

test("each fan and kind gets one random unsubscribe token at their first opt-in, kept after, and no API role can read it", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  const b = await fan(d, "Fan B", { follows: ["alpha"] });
  assert.equal(await tokenOf(d, a), undefined); // nothing opted in, no token
  await optIn(d, a, ["alpha"]);
  await optIn(d, b, ["*"]);
  const ta = await tokenOf(d, a);
  assert.match(ta, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(ta, await tokenOf(d, b));
  await optIn(d, a, []);
  await optIn(d, a, ["*"]);
  assert.equal(await tokenOf(d, a), ta); // off and on again: the same token, so an old email's link still works
  await optIn(d, a, ["*"], "weekly_digest");
  assert.notEqual(await tokenOf(d, a, "weekly_digest"), ta);
  for (const role of ["anon", "authenticated"]) {
    await as(d, role, a);
    await assert.rejects(d.query("select * from email_unsubscribe_token"), /permission denied/, role);
  }
});

test("one-click unsubscribe needs no session and a token: it is idempotent, turns off one kind of one fan, and a made-up or other fan's id changes nothing", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  const b = await fan(d, "Fan B", { follows: ["alpha"] });
  await optIn(d, a, ["*"]);
  await optIn(d, a, ["*"], "weekly_digest");
  await optIn(d, b, ["*"]);
  const before = await optins(d);
  assert.equal(before.length, 3);
  await as(d, "anon");
  // Nothing but a real token does anything: a random one, a user id, the other kind's token for the wrong fan, a null.
  for (const t of ["00000000-0000-4000-8000-000000000000", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", a, b]) await d.query("select email_unsubscribe($1)", [t]);
  await d.query("select email_unsubscribe(null)");
  assert.deepEqual(await optins(d), before);
  // The old two-argument form (a user id and a kind, no proof) no longer exists.
  await assert.rejects(d.query("select email_unsubscribe($1, 'game_alerts')", [a]), /does not exist/);
  // A's game-alert token turns off A's game alerts only, and again changes nothing more.
  const ta = await tokenOf(d, a);
  await as(d, "anon");
  await d.query("select email_unsubscribe($1)", [ta]);
  await d.query("select email_unsubscribe($1)", [ta]);
  assert.deepEqual((await optins(d)).map((r) => [r.user_id === a ? "a" : "b", r.kind]), [["a", "weekly_digest"], ["b", "game_alerts"]].sort());
  const digest = await tokenOf(d, a, "weekly_digest");
  await as(d, "anon");
  await d.query("select email_unsubscribe($1)", [digest]);
  assert.deepEqual((await optins(d)).map((r) => r.kind), ["game_alerts"]);
  // The token stays, so an old email's link keeps answering the same.
  assert.equal(await tokenOf(d, a), ta);
});

test("the sender's query returns each due fan's own token, and no other function returns one", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await optIn(d, a, ["*"]);
  await record(d, [ev("final", "2026-11-06|alpha|zed", "alpha", "zed", { home_score: 1, away_score: 0 })]); // the baseline
  await record(d, [ev("final", "2026-11-13|alpha|beta", "alpha", "beta", { home_score: 1, away_score: 0 })]);
  const [row] = await pending(d);
  assert.equal(row.unsubscribe_token, await tokenOf(d, a));
  const returning = await sudo(
    d,
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (pg_get_function_result(p.oid) ilike '%token%') order by 1`,
  );
  assert.deepEqual(returning.rows.map((r) => r.proname), ["email_pending_game_alerts"]);
});

test("nobody but the sender role reaches the sender's functions, the sender reaches no table, and the live check stays clean", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await optIn(d, a, ["*"]);
  for (const role of ["anon", "authenticated"]) {
    await as(d, role, a);
    for (const sql of ["select email_record_game_events('[]'::jsonb)", "select * from email_pending_game_alerts(1)", `select email_mark_sent('${a}', 'game_alerts', 'x')`, "select * from email_optin", "select * from email_sent", "select * from email_game_event"]) {
      await assert.rejects(d.query(sql), /permission denied/, `${role}: ${sql}`);
    }
  }
  await as(d, "email_sender");
  for (const table of ["email_optin", "email_sent", "email_game_event", "profile", "follow", "auth.users"]) {
    await assert.rejects(d.query(`select * from ${table}`), /permission denied/, table);
  }
  await assert.rejects(d.query("delete from email_sent"), /permission denied/);
  await assert.rejects(d.query("select email_adult(1990)"), /permission denied/);
  await assert.rejects(d.query("select email_set_optins('game_alerts', '{*}')"), /permission denied/);
  await sudo(d, "reset role");
  assert.deepEqual(await checkLive(d), []);
  const { rows } = await d.query("select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'email_sender'");
  assert.deepEqual(rows, [{ rolcanlogin: false, rolsuper: false, rolbypassrls: false }]);
});

test("the sender refuses events the database would not hold", async () => {
  const d = await db();
  await record(d, [], true);
  for (const bad of [ev("final", "k", "Bad Slug", "zed"), ev("bonus", "k", "alpha", "zed"), { ...ev("final", "k", "alpha", "zed"), home_name: "<b>x</b>" }, ev("final", "has space", "alpha", "zed")]) {
    await assert.rejects(record(d, [bad]));
  }
  await assert.rejects(record(d, { not: "a list" }), /not a list/);
});

test("deleting the account removes the opt-ins and the record of what was sent", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await optIn(d, a, ["*"]);
  await sudo(d, "insert into email_sent (user_id, kind, item) values ($1, 'game_alerts', 'final:x')", [a]);
  assert.ok(await tokenOf(d, a));
  await as(d, "authenticated", a);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  for (const t of ["email_optin", "email_sent", "email_unsubscribe_token", "profile"]) assert.equal((await d.query(`select count(*)::int as n from ${t}`)).rows[0].n, 0, t);
});
