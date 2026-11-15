import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";
import { runWeeklyDigest } from "../../../tools/email/send-weekly-digest.mjs";

// The weekly digest (migration 0025, ADR 0055): the opt-in is the fan's own, adults only, never on by default; who is due a week's
// digest; never twice for a week; its own unsubscribe token; only the sender role reaches the one new function.
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

const optins = async (d) => (await sudo(d, "select user_id, kind::text, program_slug from email_optin order by 1, 2, 3")).rows;
const tokenOf = async (d, uid, kind = "weekly_digest") => (await sudo(d, "select token from email_unsubscribe_token where user_id = $1 and kind = $2", [uid, kind])).rows[0]?.token;
const WEEK = "2026-w47";
const pending = async (d, week = WEEK) => (await as(d, "email_sender"), (await d.query("select * from email_pending_digests($1, 500)", [week])).rows);
const mark = async (d, uid, week = WEEK, outcome = "sent") => (await as(d, "email_sender"), d.query("select email_mark_sent($1, 'weekly_digest', $2, $3)", [uid, week, outcome]));

test("a fan opts in to the digest for all the teams they follow, or some of them, and turns it off; nothing is on until they do, and game alerts are separate", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha", "beta"] });
  assert.deepEqual(await settings(d, a), [{ eligible: true, kind: null, program_slug: null }]); // never on by default
  await optIn(d, a, ["*"], "weekly_digest");
  assert.deepEqual((await settings(d, a)).map((r) => [r.kind, r.program_slug]), [["weekly_digest", "*"]]);
  await optIn(d, a, ["alpha"], "game_alerts");
  assert.deepEqual((await settings(d, a)).map((r) => [r.kind, r.program_slug]), [["game_alerts", "alpha"], ["weekly_digest", "*"]]);
  await optIn(d, a, ["beta"], "weekly_digest");
  await optIn(d, a, [], "game_alerts"); // turning one kind off leaves the other
  assert.deepEqual((await settings(d, a)).map((r) => [r.kind, r.program_slug]), [["weekly_digest", "beta"]]);
  await optIn(d, a, [], "weekly_digest");
  assert.deepEqual(await optins(d), []);
});

test("the digest opt-in uses the same age rule: 17 years back is refused, 18 is eligible, a banned account is refused, and anon cannot", async () => {
  const d = await db();
  const kid = await fan(d, "Seventeen", { age: 17, follows: ["alpha"] });
  const adult = await fan(d, "Eighteen", { age: 18, follows: ["alpha"] });
  await assert.rejects(optIn(d, kid, ["*"], "weekly_digest"), /not available/);
  await optIn(d, adult, ["*"], "weekly_digest");
  await assert.rejects(optIn(d, adult, ["gamma"], "weekly_digest"), /follow the team first/);
  await as(d, "anon");
  await assert.rejects(d.query("select email_set_optins('weekly_digest', '{*}')"), /permission denied/);
  await sudo(d, "update profile set banned = true where user_id = $1", [adult]);
  await assert.rejects(optIn(d, adult, ["alpha"], "weekly_digest"), /not available/);
});

test("who is due a week's digest: opted in, an adult, confirmed, not banned, not already recorded for that week; their followed teams only", async () => {
  const d = await db();
  const all = await fan(d, "All Teams", { follows: ["alpha", "beta", "gamma"] });
  const some = await fan(d, "Some Teams", { follows: ["alpha", "beta", "gamma"] });
  const alertsOnly = await fan(d, "Alerts Only", { follows: ["alpha"] });
  const never = await fan(d, "Never Opted", { follows: ["alpha"] });
  const kid = await fan(d, "Kid", { follows: ["alpha"] });
  const unconfirmed = await fan(d, "Unconfirmed", { follows: ["alpha"], confirmed: false });
  const banned = await fan(d, "Banned", { follows: ["alpha"] });
  const unfollowed = await fan(d, "Unfollowed", { follows: ["alpha"] });
  for (const f of [all, kid, unconfirmed, banned, unfollowed]) await optIn(d, f, ["*"], "weekly_digest");
  await optIn(d, some, ["gamma", "alpha"], "weekly_digest");
  await optIn(d, alertsOnly, ["*"], "game_alerts");
  await as(d, "authenticated", unfollowed);
  await d.query("select unfollow_program('alpha')");
  await sudo(d, "update profile set birth_year = $2 where user_id = $1", [kid, YEAR - 15]);
  await sudo(d, "update profile set banned = true where user_id = $1", [banned]);
  const rows = await pending(d);
  const who = (id) => ({ [all]: "all", [some]: "some", [unfollowed]: "unfollowed" })[id] ?? "other";
  assert.deepEqual(rows.map((r) => [who(r.user_id), r.followed_slugs]).sort(), [["all", ["alpha", "beta", "gamma"]], ["some", ["alpha", "gamma"]], ["unfollowed", []]]);
  assert.deepEqual(rows.find((r) => r.user_id === all).email, "all.teams@example.test");
  // A team followed after the opt-in is covered by "*"; one unfollowed stops. A chosen team that is no longer followed drops out.
  await as(d, "authenticated", all);
  await d.query("select follow_program('delta')");
  await d.query("select unfollow_program('beta')");
  await as(d, "authenticated", some);
  await d.query("select unfollow_program('gamma')");
  const again = await pending(d);
  assert.deepEqual(again.map((r) => [who(r.user_id), r.followed_slugs]).sort(), [["all", ["alpha", "delta", "gamma"]], ["some", ["alpha"]], ["unfollowed", []]]);
});

test("a week is sent once: recorded for that week it is no longer due, a refusal for good is not tried again, the next week is due again, twice is fine", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  const b = await fan(d, "Fan B", { follows: ["alpha"] });
  await optIn(d, a, ["*"], "weekly_digest");
  await optIn(d, b, ["*"], "weekly_digest");
  assert.equal((await pending(d)).length, 2);
  await mark(d, a);
  await mark(d, a); // twice is fine
  await mark(d, b, WEEK, "rejected");
  assert.deepEqual(await pending(d), []);
  assert.equal((await pending(d, "2026-w48")).length, 2);
  // A game alert recorded under the same text, or another fan's record, never hides a digest.
  await as(d, "email_sender");
  await d.query("select email_mark_sent($1, 'game_alerts', $2)", [a, "2026-w49"]);
  assert.equal((await pending(d, "2026-w49")).length, 2);
  assert.deepEqual((await sudo(d, "select user_id, kind::text, item, outcome from email_sent where kind = 'weekly_digest' order by user_id")).rows.map((r) => [r.kind, r.item, r.outcome]), [["weekly_digest", WEEK, "sent"], ["weekly_digest", WEEK, "rejected"]]);
});

test("the sender's query returns each fan's own digest token (not the game-alert token), and no other function returns one", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await optIn(d, a, ["*"], "game_alerts");
  await optIn(d, a, ["*"], "weekly_digest");
  const [row] = await pending(d);
  assert.equal(row.unsubscribe_token, await tokenOf(d, a));
  assert.notEqual(row.unsubscribe_token, await tokenOf(d, a, "game_alerts"));
  const returning = await sudo(d, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (pg_get_function_result(p.oid) ilike '%token%') order by 1`);
  assert.deepEqual(returning.rows.map((r) => r.proname), ["email_pending_digests", "email_pending_game_alerts"]);
});

test("the digest's token unsubscribes the digest only, with no session, and an old email's link keeps answering", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await optIn(d, a, ["*"], "game_alerts");
  await optIn(d, a, ["*"], "weekly_digest");
  const token = await tokenOf(d, a);
  await as(d, "anon");
  await d.query("select email_unsubscribe($1)", [token]);
  await d.query("select email_unsubscribe($1)", [token]);
  assert.deepEqual((await optins(d)).map((r) => r.kind), ["game_alerts"]);
  assert.deepEqual(await pending(d), []); // no longer due
  assert.equal(await tokenOf(d, a), token);
  await optIn(d, a, ["*"], "weekly_digest"); // opting in again keeps the same token
  assert.equal(await tokenOf(d, a), token);
  assert.equal((await pending(d)).length, 1);
});

test("only the sender role reaches the new function, a bad week is refused, and the live check stays clean", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await optIn(d, a, ["*"], "weekly_digest");
  for (const role of ["anon", "authenticated"]) {
    await as(d, role, a);
    await assert.rejects(d.query("select * from email_pending_digests('2026-w47', 1)"), /permission denied/, role);
  }
  for (const bad of ["2026-47", "2026-w00", "2026-w54", "", "2026-w4", "x", null]) await assert.rejects(pending(d, bad), /not an ISO week|permission|invalid/, String(bad));
  await as(d, "email_sender");
  for (const table of ["email_optin", "email_sent", "email_unsubscribe_token", "follow", "auth.users"]) await assert.rejects(d.query(`select * from ${table}`), /permission denied/, table);
  const { rows } = await sudo(d, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'email%' and has_function_privilege('email_sender', p.oid, 'execute') order by 1`);
  assert.deepEqual(rows.map((r) => r.proname), ["email_mark_sent", "email_pending_digests", "email_pending_game_alerts", "email_record_game_events"]); // exactly one more than 0022 gave it
  await sudo(d, "reset role");
  assert.deepEqual(await checkLive(d), []);
});

test("the whole send over the real function: due fans get one digest each, a failure is counted, a repeat sends nothing", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  const b = await fan(d, "Fan B", { follows: ["alpha"] });
  const c = await fan(d, "Fan C", { follows: ["beta"] }); // a team with nothing to report
  for (const f of [a, b, c]) await optIn(d, f, ["*"], "weekly_digest");
  const sections = {
    alpha: { slug: "alpha", name: "Alpha", last: { kind: "none" }, ranking: undefined, next: { home: "Alpha", away: "Beta", round: "area", homeChance: 0.6 } },
    beta: { slug: "beta", name: "Beta", last: { kind: "none" }, ranking: undefined, next: undefined },
  };
  const sent = [];
  const send = async (m) => (sent.push(m), { outcome: m.to === "fan.b@example.test" ? "rejected" : "sent", status: 200 });
  const client = { query: async (sql, p) => (await as(d, "email_sender"), d.query(sql, p)) };
  const run = () => runWeeklyDigest({ db: client, data: { forTeam: (s) => sections[s] }, week: WEEK, postal: { lines: ["<postal address>"] }, from: "A <a@example.test>", apiKey: "k", send, sleep: async () => {}, paceMs: 0 });
  const r = await run();
  assert.deepEqual([r.due, r.sent, r.rejected, r.empty], [3, 1, 1, 1]);
  assert.deepEqual(sent.map((m) => m.to).sort(), ["fan.a@example.test", "fan.b@example.test"]);
  sent.length = 0;
  const again = await run();
  assert.deepEqual([again.due, again.sent, sent.length], [1, 0, 0]); // fan C still has nothing, and A and B are done for the week
});

test("deleting the account removes the digest opt-in, its token and what was sent", async () => {
  const d = await db();
  const a = await fan(d, "Fan A", { follows: ["alpha"] });
  await optIn(d, a, ["*"], "weekly_digest");
  await mark(d, a);
  assert.ok(await tokenOf(d, a));
  await as(d, "authenticated", a);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  for (const t of ["email_optin", "email_sent", "email_unsubscribe_token", "profile"]) assert.equal((await d.query(`select count(*)::int as n from ${t}`)).rows[0].n, 0, t);
});
