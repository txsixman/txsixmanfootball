import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLive } from "../load.mjs";
import { as, asFan, db, fan, KEYS, sudo } from "./posts-helpers.mjs";

// Fan score reports (migration 0014, ADR 0018). The playoff game is the test game; its day is set by hand so the tests
// do not depend on today's date.
const report = (d, home, away, key = KEYS.playoff) => d.query("select submit_score_report($1, $2, $3)", [key, home, away]);
const status = async (d, key = KEYS.playoff) => (await d.query("select * from fan_score_status($1)", [key])).rows[0];
const reportsOf = async (d) => (await sudo(d, "select count(*)::int as n from fan_score_report")).rows[0].n;

async function gameDay(d, sql = "current_date - 1") {
  await sudo(d, `update game set game_date = ${sql} where playoff_round = 'bi-district'`);
}

test("one account's report shows nothing but a count, however old the account", async () => {
  const d = await db();
  await gameDay(d);
  await asFan(d, await fan(d, "Old Fan"));
  await report(d, 21, 14);
  await as(d, "anon");
  assert.deepEqual(await status(d), { reports: 1, confirmed: false, home_score: null, away_score: null, basis: null });
});

test("two different accounts, each older than 7 days, reporting the same score confirm it", async () => {
  const d = await db();
  await gameDay(d);
  await asFan(d, await fan(d, "Old Fan A"));
  await report(d, 21, 14);
  await asFan(d, await fan(d, "Old Fan B"));
  await report(d, 21, 14);
  await as(d, "anon");
  assert.deepEqual(await status(d), { reports: 2, confirmed: true, home_score: 21, away_score: 14, basis: "two_fans" });
});

test("two new accounts, or one new and one old, never confirm a score", async () => {
  const d = await db();
  await gameDay(d);
  await asFan(d, await fan(d, "New Fan A", { old: false }));
  await report(d, 21, 14);
  await asFan(d, await fan(d, "New Fan B", { old: false }));
  await report(d, 21, 14);
  await asFan(d, await fan(d, "Old Fan A"));
  await report(d, 21, 14);
  await as(d, "anon");
  assert.deepEqual(await status(d), { reports: 3, confirmed: false, home_score: null, away_score: null, basis: null });
});

test("different scores confirm nothing: a score is confirmed only when it is the only one two established accounts back", async () => {
  const d = await db();
  await gameDay(d);
  for (const [name, h, a] of [["Fan A", 21, 14], ["Fan B", 14, 21], ["Fan C", 21, 14], ["Fan D", 14, 21]]) {
    await asFan(d, await fan(d, name));
    await report(d, h, a);
  }
  assert.equal((await status(d)).confirmed, false, "two scores each backed twice is a dispute");
  await asFan(d, await fan(d, "Fan E"));
  await report(d, 21, 14);
  assert.deepEqual(await status(d), { reports: 5, confirmed: false, home_score: null, away_score: null, basis: null }, "3 and 2 are still two backed scores: no guess");
});

test("a report that matches the score the Results watch reads later is confirmed, if an established account made it", async () => {
  const d = await db();
  await gameDay(d);
  await asFan(d, await fan(d, "New Fan", { old: false }));
  await report(d, 28, 7);
  await asFan(d, await fan(d, "Wrong Fan"));
  await report(d, 14, 7);
  const right = await fan(d, "Right Fan");
  await asFan(d, right);
  await report(d, 28, 7);
  // The Results watch reads the game (what seedGames does): the status turns final.
  await sudo(d, "update game set status = 'final', end_reason = 'regulation', home_score = 28, away_score = 7 where playoff_round = 'bi-district'");
  await as(d, "anon");
  assert.deepEqual(await status(d), { reports: 3, confirmed: true, home_score: 28, away_score: 7, basis: "results_watch" });
  // A banned reporter stops counting; with only the new account's report left matching, nothing is confirmed.
  await sudo(d, "update profile set banned = true where user_id = $1", [right]);
  assert.deepEqual(await status(d), { reports: 3, confirmed: false, home_score: null, away_score: null, basis: null });
  await sudo(d, "update profile set banned = false where user_id = $1", [right]);
  // A different read takes precedence: the fans' reports show nothing, even two established ones that agree.
  await sudo(d, "update game set home_score = 35 where playoff_round = 'bi-district'");
  assert.deepEqual(await status(d), { reports: 3, confirmed: false, home_score: null, away_score: null, basis: null });
});

test("a banned account's report does not count toward two fans agreeing, and a ban later lifted counts again", async () => {
  const d = await db();
  await gameDay(d);
  const a = await fan(d, "Old Fan A");
  const b = await fan(d, "Old Fan B");
  for (const id of [a, b]) { await asFan(d, id); await report(d, 21, 14); }
  assert.equal((await status(d)).confirmed, true);
  await sudo(d, "update profile set banned = true where user_id = $1", [b]);
  assert.deepEqual(await status(d), { reports: 2, confirmed: false, home_score: null, away_score: null, basis: null });
  await sudo(d, "update profile set banned = false where user_id = $1", [b]);
  assert.equal((await status(d)).confirmed, true);
});

test("reports open 2 hours after kickoff, or at 6 PM Central on game day when no kickoff is listed", async () => {
  const d = await db();
  await asFan(d, await fan(d, "Old Fan"));
  const rows = async () => (await sudo(d, "select count(*)::int as n from fan_score_report")).rows[0].n;
  await gameDay(d, "current_date + 2");
  await assert.rejects(report(d, 21, 14), /too_early/);
  await gameDay(d, "(now() at time zone 'America/Chicago')::date + 1");
  await assert.rejects(report(d, 21, 14), /too_early/, "tomorrow");
  // Today, no kickoff: closed until 6 PM Central.
  await gameDay(d, "(now() at time zone 'America/Chicago')::date");
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago" }).format(new Date()));
  if (hour < 18) await assert.rejects(report(d, 21, 14), /too_early/, "today before 6 PM Central");
  else {
    await report(d, 21, 14);
    assert.equal(await rows(), 1, "today from 6 PM Central");
    await asFan(d, await fan(d, "Second Fan"));
  }
  const before = await rows();
  // A kickoff decides it: 1 hour ago is too soon, 3 hours ago is open, whatever the date says.
  await sudo(d, "update game set kickoff = now() - interval '1 hour' where playoff_round = 'bi-district'");
  await assert.rejects(report(d, 21, 14), /too_early/, "kickoff 1 hour ago");
  assert.equal(await rows(), before);
  await sudo(d, "update game set kickoff = now() - interval '3 hours', game_date = current_date + 2 where playoff_round = 'bi-district'");
  await report(d, 21, 14);
  assert.equal(await rows(), before + 1);
});

test("reports close once the game has a score, and refuse bad scores", async () => {
  const d = await db();
  await asFan(d, await fan(d, "Old Fan"));
  await gameDay(d);
  await assert.rejects(report(d, 21, -1), /bad_score/);
  await assert.rejects(report(d, 200, 1), /bad_score/);
  await assert.rejects(report(d, 14, 14), /bad_score/, "no tie in a playoff game");
  await assert.rejects(report(d, null, 14), /bad_score/);
  await assert.rejects(report(d, 21, 14, "2026-bi-district-gamma-at-alpha"), /unknown_game/);
  await assert.rejects(report(d, 21, 14, KEYS.played), /game_closed/);
  assert.equal(await reportsOf(d), 0);
  await asFan(d, (await sudo(d, "select user_id from profile")).rows[0].user_id);
  await report(d, 21, 14);
  await assert.rejects(report(d, 21, 14), /already_reported/);
  await assert.rejects(report(d, 14, 21), /already_reported/);
  assert.equal(await reportsOf(d), 1);
});

test("only a signed-in fan who is not banned or muted can report, and reports are rate limited", async () => {
  const d = await db();
  await gameDay(d);
  await as(d, "anon");
  await assert.rejects(report(d, 21, 14), /permission denied/);
  await as(d, "authenticated", "");
  await assert.rejects(report(d, 21, 14), /sign_in_required/);
  await asFan(d, await fan(d, "Muted Fan", { muted: true }));
  await assert.rejects(report(d, 21, 14), /muted/);
  const banned = await fan(d, "Banned Fan");
  await sudo(d, "update profile set banned = true where user_id = $1", [banned]);
  await asFan(d, banned);
  await assert.rejects(report(d, 21, 14), /banned/);
  // New accounts: 2 reports in 10 minutes. Established: 5.
  await sudo(d, `insert into game (season, home_ts, away_ts, status, game_date, game_type, playoff_round)
    select 2026, home_ts, away_ts, 'scheduled', current_date - 1, 'playoff', 'r' || i from game, generate_series(1, 6) i where playoff_round = 'bi-district'`);
  const young = await fan(d, "Young Fan", { old: false });
  const old = await fan(d, "Old Fan");
  const key = (i) => `2026-r${i}-beta-at-alpha`;
  await asFan(d, young);
  await report(d, 21, 14, key(1));
  await report(d, 21, 14, key(2));
  await assert.rejects(report(d, 21, 14, key(3)), /rate_limited/);
  await asFan(d, old);
  for (let i = 1; i <= 5; i++) await report(d, 21, 14, key(i));
  await assert.rejects(report(d, 21, 14, key(6)), /rate_limited/);
});

test("reports are never edited or deleted; deleting the account only empties the reporter, and the report still counts", async () => {
  const d = await db();
  await gameDay(d);
  const [a, b] = [await fan(d, "Old Fan A"), await fan(d, "Old Fan B")];
  await asFan(d, a);
  await report(d, 21, 14);
  await asFan(d, b);
  await report(d, 21, 14);
  await d.exec("reset role");
  await assert.rejects(d.exec("update fan_score_report set home_score = 0"), /cannot be changed/);
  await assert.rejects(d.exec("update fan_score_report set reporter_id = null, home_score = 0"), /cannot be changed/);
  await assert.rejects(d.exec("update fan_score_report set established = false"), /cannot be changed/);
  await assert.rejects(d.exec("delete from fan_score_report"), /cannot be changed/);
  await assert.rejects(d.exec("truncate fan_score_report"), /cannot be changed/);
  await asFan(d, a);
  await d.query("select delete_my_account()");
  await d.exec("reset role");
  const rows = (await d.query("select reporter_id, home_score, away_score from fan_score_report order by reporter_id nulls first")).rows;
  assert.deepEqual(rows, [{ reporter_id: null, home_score: 21, away_score: 14 }, { reporter_id: b, home_score: 21, away_score: 14 }]);
  assert.deepEqual(await status(d), { reports: 2, confirmed: true, home_score: 21, away_score: 14, basis: "two_fans" });
});

test("the table is locked, the API roles run only the two report functions, and nothing in the read names a reporter", async () => {
  const d = await db();
  await gameDay(d);
  await asFan(d, await fan(d, "Old Fan"));
  await report(d, 21, 14);
  await assert.rejects(d.query("select * from fan_score_report"), /permission denied/);
  await assert.rejects(d.exec("insert into fan_score_report (game_id, home_score, away_score, established) select id, 1, 0, true from game"), /permission denied/);
  await as(d, "anon");
  assert.deepEqual(Object.keys(await status(d)).sort(), ["away_score", "basis", "confirmed", "home_score", "reports"]);
  assert.deepEqual(await status(d, "nonsense"), { reports: 0, confirmed: false, home_score: null, away_score: null, basis: null });
  await d.exec("reset role");
  assert.deepEqual(await checkLive(d), []);
});
