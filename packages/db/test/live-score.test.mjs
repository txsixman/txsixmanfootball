import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { checkLive, migrate } from "../load.mjs";
import { MAX_AGE_HOURS, validateLiveRows, writeLive } from "../live.mjs";

// Live scores (migration 0016, ADR 0021): the table is closed to the API roles like every other; live_scores() is the one read.
const row = (over = {}) => ({
  game_key: "2026-11-13|salt-fork|cedar-gap", home: "salt-fork", away: "cedar-gap", home_score: 28, away_score: 14,
  period: "Q3", read_at: new Date().toISOString(), ...over,
});

async function supabaseLike() {
  const d = new PGlite();
  // Supabase's defaults hand the API roles rights on every new table; migration 0005 takes them away.
  await d.exec(`create role anon; create role authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;`);
  await migrate(d);
  return d;
}

test("anon and authenticated read live scores through live_scores() and cannot touch the table in any way", async () => {
  const d = await supabaseLike();
  await writeLive(d, validateLiveRows([row()]));
  for (const role of ["anon", "authenticated"]) {
    await d.exec(`set role ${role}`);
    const { rows } = await d.query("select game_key, home, away, home_score, away_score, period from live_scores()");
    assert.deepEqual(rows, [{ game_key: "2026-11-13|salt-fork|cedar-gap", home: "salt-fork", away: "cedar-gap", home_score: 28, away_score: 14, period: "Q3" }]);
    await assert.rejects(d.query("select * from live_score"), /permission denied/);
    await assert.rejects(d.exec("insert into live_score (game_key, home, away, home_score, away_score, read_at) values ('2026-11-13|a|b', 'a', 'b', 1, 0, now())"), /permission denied/);
    await assert.rejects(d.exec("update live_score set home_score = 99"), /permission denied/);
    await assert.rejects(d.exec("delete from live_score"), /permission denied/);
    await assert.rejects(d.exec("truncate live_score"), /permission denied/);
    await d.exec("reset role");
  }
  assert.equal((await d.query("select count(*)::int as n from live_score")).rows[0].n, 1);
});

test("live_scores() leaves out rows read over 6 hours ago, and returns nothing when the table is empty", async () => {
  const d = await supabaseLike();
  await d.exec("set role anon");
  assert.deepEqual((await d.query("select * from live_scores()")).rows, []);
  await d.exec("reset role");
  await d.exec("insert into live_score (game_key, home, away, home_score, away_score, read_at) values ('2026-11-13|a|b', 'a', 'b', 1, 0, now() - interval '7 hours')");
  await d.exec("set role anon");
  assert.deepEqual((await d.query("select * from live_scores()")).rows, []);
});

test("the table's checks refuse a bad key, slug, score, period or source", async () => {
  const d = await supabaseLike();
  const insert = (o) => {
    const r = row(o);
    return d.query(
      "insert into live_score (game_key, home, away, home_score, away_score, period, read_at, source) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [r.game_key, r.home, r.away, r.home_score, r.away_score, r.period, r.read_at, o.source ?? "robot"],
    );
  };
  await assert.rejects(insert({ game_key: "not a key" }), /game_key/);
  await assert.rejects(insert({ home: "Salt Fork" }), /home/);
  await assert.rejects(insert({ home_score: -1 }), /home_score/);
  await assert.rejects(insert({ away_score: 201 }), /away_score/);
  await assert.rejects(insert({ period: "x".repeat(13) }), /period/);
  await assert.rejects(insert({ period: "<b>" }), /period/);
  await assert.rejects(insert({ source: "person" }), /source/);
  await insert({ period: null });
});

test("the live check stays clean with live_scores() granted, and still names a table right on live_score", async () => {
  const d = await supabaseLike();
  assert.deepEqual(await checkLive(d), []);
  await d.exec("grant select on live_score to anon");
  assert.deepEqual(await checkLive(d), ["anon holds SELECT on public.live_score"]);
  await d.exec("revoke select on live_score from anon; create policy sneaky on live_score for select to anon using (true)");
  assert.deepEqual(await checkLive(d), ["unexpected policy sneaky on public.live_score"]);
});

test("rows are validated before anything is written", () => {
  assert.deepEqual(validateLiveRows([row({ period: undefined })])[0].period, null);
  const bad = [
    [{ ...row(), extra: 1 }, /unexpected field extra/],
    [row({ game_key: "2026-11-13|salt-fork" }), /game_key/],
    [row({ game_key: "2026-11-13|salt-fork|dry-wash" }), /does not match/],
    [row({ home: "Salt Fork" }), /home is not a slug/],
    [row({ home_score: 1.5 }), /home_score/],
    [row({ away_score: -3 }), /away_score/],
    [row({ home_score: 201 }), /home_score/],
    [row({ home_score: "28" }), /home_score/],
    [row({ period: "" }), /period/],
    [row({ period: 3 }), /period/],
    [row({ period: "Q<3>" }), /period/],
    [row({ read_at: "yesterday-ish" }), /read_at/],
    [row({ read_at: 12 }), /read_at/],
    [null, /not an object/],
  ];
  for (const [r, why] of bad) assert.throws(() => validateLiveRows([r]), why);
  // A finished game (migration 0019): true or false, absent meaning under way; nothing else.
  assert.equal(validateLiveRows([row()])[0].finished, false);
  assert.equal(validateLiveRows([row({ finished: true })])[0].finished, true);
  for (const finished of ["true", 1, null]) assert.throws(() => validateLiveRows([row({ finished })]), /finished/);
  assert.throws(() => validateLiveRows({}), /not a list/);
  assert.throws(() => validateLiveRows([row(), row()]), /listed twice/);
  assert.throws(() => validateLiveRows(Array.from({ length: 201 }, (_, i) => row({ game_key: `2026-11-13|a${i}|b`, home: `a${i}`, away: "b" }))), /most is 200/);
  // The key may list the teams in either order, as the site's key does.
  assert.equal(validateLiveRows([row({ home: "cedar-gap", away: "salt-fork" })]).length, 1);
});

test("a write replaces the table: upserts the file's rows, drops the rest and anything over 6 hours old", async () => {
  const d = await supabaseLike();
  const a = row();
  const b = row({ game_key: "2026-11-13|dry-wash|mesa-verde", home: "dry-wash", away: "mesa-verde", home_score: 7, away_score: 0, period: null });
  assert.deepEqual(await writeLive(d, validateLiveRows([a, b])), { written: 2, removedNotLive: 0, removedStale: 0 });
  // Next run: the first game moved on and the second went final (so it is not in the file).
  const next = validateLiveRows([{ ...a, home_score: 35, period: "Q4" }]);
  assert.deepEqual(await writeLive(d, next), { written: 1, removedNotLive: 1, removedStale: 0 });
  assert.deepEqual((await d.query("select game_key, home_score, period from live_score")).rows, [{ game_key: a.game_key, home_score: 35, period: "Q4" }]);
  // A row read long ago is dropped even when the file lists it.
  const old = new Date(Date.now() - (MAX_AGE_HOURS + 1) * 3600_000).toISOString();
  assert.deepEqual(await writeLive(d, validateLiveRows([{ ...a, read_at: old }])), { written: 1, removedNotLive: 0, removedStale: 1 });
  // An empty file clears everything.
  await writeLive(d, validateLiveRows([a]));
  assert.deepEqual(await writeLive(d, []), { written: 0, removedNotLive: 1, removedStale: 0 });
  assert.equal((await d.query("select count(*)::int as n from live_score")).rows[0].n, 0);
});

test("a write that fails halfway changes nothing", async () => {
  const d = await supabaseLike();
  const a = row();
  await writeLive(d, [a]);
  const broken = { ...row({ game_key: "2026-11-13|x|y", home: "x", away: "y" }), home_score: 999 }; // skips validation on purpose: the table refuses it
  await assert.rejects(writeLive(d, [{ ...a, home_score: 50 }, broken]), /home_score/);
  assert.equal((await d.query("select home_score from live_score")).rows[0].home_score, 28);
});

test("a finished game keeps its last score with the flag, and live_scores() returns it (migration 0019)", async () => {
  const d = await supabaseLike();
  await writeLive(d, validateLiveRows([row(), row({ game_key: "2026-11-13|dry-wash|mesa-top", home: "dry-wash", away: "mesa-top", home_score: 52, away_score: 6, period: null, finished: true })]));
  await d.exec("set role anon");
  const { rows } = await d.query("select game_key, home_score, away_score, period, finished from live_scores() order by game_key");
  assert.deepEqual(rows, [
    { game_key: "2026-11-13|dry-wash|mesa-top", home_score: 52, away_score: 6, period: null, finished: true },
    { game_key: "2026-11-13|salt-fork|cedar-gap", home_score: 28, away_score: 14, period: "Q3", finished: false },
  ]);
  await d.exec("reset role");
  // The next read sees it under way again (the feed changed its mind): the flag follows the read.
  await writeLive(d, validateLiveRows([row({ game_key: "2026-11-13|dry-wash|mesa-top", home: "dry-wash", away: "mesa-top", home_score: 52, away_score: 6 })]));
  assert.equal((await d.query("select finished from live_score")).rows[0].finished, false);
  assert.deepEqual(await checkLive(d), []);
});
