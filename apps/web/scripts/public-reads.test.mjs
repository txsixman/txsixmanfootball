// The public reads under a game page (app/api/games/[id]/comments, app/api/games/[id]/score-report) run as they are, on
// the real migrations in PGlite, as the anon role, through route-harness.mjs's PostgREST-like client. Checked: the
// FAN_SIGNIN switch, that rows which must never be shown are not (hidden posts, banned fans' posts, unconfirmed scores,
// who reported), the paging limits, and that a database error shows nothing of the database.
//   node --test apps/web/scripts/*.test.mjs   (needs `npm ci --prefix packages/db` for PGlite)
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { calls, noInternals, params, read, request, route, rpc, sent, setPublic, signOut, sudoRows, useDb } from "./route-harness.mjs";
import { KEYS, db, fan } from "../../../packages/db/test/posts-helpers.mjs";

const comments = await route("games/[id]/comments");
const scores = await route("games/[id]/score-report");

let d;
before(async () => {
  d = await db();
  useDb(d);
});
beforeEach(() => {
  process.env.FAN_SIGNIN = "on";
  signOut();
  calls.length = 0;
  sent.length = 0;
});

const getComments = async (key, query = "") => read(await comments.GET(request(`/api/games/${key}/comments${query}`, { method: "GET" }), params(key)));
const getScore = async (key) => read(await scores.GET(request(`/api/games/${key}/score-report`, { method: "GET" }), params(key)));
const FAIL = { fail: { code: "57014", message: "canceling statement due to statement timeout on function list_comments" } };

/** `n` comments under `key`, a second apart, by `author`, straight into the table. Returns their ids, oldest first. */
async function seedComments(key, author, n, from = 0) {
  const rows = await sudoRows(
    `insert into post (author_id, game_key, body, created_at)
     select $1, $2, 'Comment ' || (i + $4), now() - interval '1 hour' + (i + $4) * interval '1 second' from generate_series(0, $3 - 1) i
     returning id`,
    [author, key, n, from],
  );
  return rows.map((r) => r.id);
}

test("fan accounts off: both reads are a bare 404 and nothing asks the database", async () => {
  process.env.FAN_SIGNIN = "off";
  setPublic({ fail: { code: "XX000", message: "must not be called" } });
  for (const r of [await getComments(KEYS.regular), await getScore(KEYS.regular)]) {
    assert.equal(r.status, 404);
    assert.equal(r.body, null);
  }
  assert.deepEqual(calls, []);
});

test("a key that cannot be a game answers empty without asking the database", async () => {
  setPublic({ fail: { code: "XX000", message: "must not be called" } });
  for (const key of ["x", "UPPER-case-key", "-starts-with-dash", "a".repeat(202), "2026'--"]) {
    assert.deepEqual((await getComments(encodeURIComponent(key))).body, { comments: [], total: 0 }, key);
    assert.deepEqual((await getScore(encodeURIComponent(key))).body, { reports: 0, confirmed: false }, key);
  }
});

test("without Supabase configured both reads answer empty", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    assert.deepEqual((await getComments(KEYS.regular)).body, { comments: [], total: 0 });
    assert.deepEqual((await getScore(KEYS.regular)).body, { reports: 0, confirmed: false });
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  }
  assert.deepEqual(calls, []);
});

// --- Comments -----------------------------------------------------------------------------------------------------

test("comments: only the shown fields, never a hidden post or a banned fan's; a muted fan's still shows", async () => {
  const key = "2026-09-04-beta-at-alpha";
  const shown = await fan(d, "Shown Fan");
  const quiet = await fan(d, "Muted But Shown", { muted: true });
  const banned = await fan(d, "Banned Later");
  const [first] = await seedComments(key, shown, 1, 0);
  const [hidden] = await seedComments(key, shown, 1, 1);
  const [muted] = await seedComments(key, quiet, 1, 2);
  const [gone] = await seedComments(key, banned, 1, 3);
  await sudoRows("update post set hidden_at = now() where id = $1", [hidden]);
  await sudoRows("update profile set banned = true where user_id = $1", [banned]);
  await sudoRows("update post set edited_at = now() where id = $1", [muted]);
  const r = await getComments(key);
  assert.equal(r.status, 200);
  assert.equal(r.cache, "no-store");
  assert.deepEqual(r.body.total, 2);
  assert.deepEqual(
    r.body.comments.map((c) => [c.id, c.author, c.body, c.edited]),
    [
      [first, "Shown Fan", "Comment 0", false],
      [muted, "Muted But Shown", "Comment 2", true],
    ],
  );
  for (const c of r.body.comments) assert.deepEqual(Object.keys(c).sort(), ["author", "body", "createdAt", "edited", "id"]);
  assert.ok(!r.text.includes(hidden) && !r.text.includes(gone) && !r.text.includes(shown) && !r.text.includes(banned), "no hidden post, no user id");
  assert.deepEqual(calls, [{ fn: "list_comments", args: ["p_game_key", "p_limit", "p_offset"] }]);
});

test("comments: 30 a page, oldest first, with the total; offsets are whole, never negative, at most 10,000", async () => {
  const key = KEYS.playoff;
  const author = await fan(d, "Paging Fan");
  const ids = await seedComments(key, author, 65);
  const page = async (q) => (await getComments(key, q)).body;
  const one = await page("");
  assert.deepEqual([one.comments.length, one.total], [30, 65]);
  assert.deepEqual(one.comments.map((c) => c.id), ids.slice(0, 30));
  assert.deepEqual((await page("?offset=30")).comments.map((c) => c.id), ids.slice(30, 60));
  const last = await page("?offset=60");
  assert.deepEqual([last.comments.map((c) => c.id), last.total], [ids.slice(60), 65]);
  for (const q of ["?offset=-5", "?offset=abc", "?offset="]) {
    assert.deepEqual((await page(q)).comments.map((c) => c.id), ids.slice(0, 30), q);
  }
  assert.equal((await page("?offset=2.9")).comments[0].id, ids[2]);
  assert.equal((await page("?offset=1e9x")).comments[0].id, ids[1]); // the leading whole number, as parseInt reads it
  sent.length = 0;
  assert.deepEqual((await page("?offset=999999999")).comments, []);
  // The page size and the capped offset are what reach the database.
  assert.deepEqual(sent, [{ p_game_key: key, p_offset: 10_000, p_limit: 30 }]);
});

test("comments: a database error is 502 failed, logged by SQL state only", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  setPublic(FAIL);
  const r = await getComments(KEYS.regular);
  assert.deepEqual([r.status, r.body, r.cache], [502, { error: "failed" }, "no-store"]);
  noInternals(r);
  assert.deepEqual(logged.mock.calls.map((c) => c.arguments), [["comments: read failed", "57014"]]);
  // The same through the real database: the anon role losing the function.
  signOut();
  await sudoRows("revoke execute on function list_comments(text, int, int) from anon");
  try {
    const denied = await getComments(KEYS.regular);
    assert.deepEqual([denied.status, denied.body], [502, { error: "failed" }]);
    noInternals(denied);
  } finally {
    await sudoRows("grant execute on function list_comments(text, int, int) to anon");
  }
});

// --- Score reports ------------------------------------------------------------------------------------------------

const report = (who, home, away) => rpc(who, "submit_score_report", { p_game_key: KEYS.regular, p_home: home, p_away: away }).then(({ error }) => assert.equal(error, null));

test("score status: a count until two established fans agree; new or banned fans never confirm; a split confirms nothing", async () => {
  const empty = await getScore(KEYS.regular);
  assert.deepEqual([empty.status, empty.body, empty.cache], [200, { reports: 0, confirmed: false }, "no-store"]);
  assert.deepEqual(calls, [{ fn: "fan_score_status", args: ["p_game_key"] }]);

  const first = await fan(d, "Score One");
  await report(first, 36, 30);
  assert.deepEqual((await getScore(KEYS.regular)).body, { reports: 1, confirmed: false });
  const fresh = await fan(d, "Score New", { old: false });
  await report(fresh, 36, 30);
  assert.deepEqual((await getScore(KEYS.regular)).body, { reports: 2, confirmed: false });
  const banned = await fan(d, "Score Banned");
  await report(banned, 36, 30);
  await sudoRows("update profile set banned = true where user_id = $1", [banned]);
  assert.deepEqual((await getScore(KEYS.regular)).body, { reports: 3, confirmed: false });

  const second = await fan(d, "Score Two");
  await report(second, 36, 30);
  const confirmed = await getScore(KEYS.regular);
  assert.deepEqual(confirmed.body, { reports: 4, confirmed: true, homeScore: 36, awayScore: 30, basis: "two_fans" });
  for (const id of [first, fresh, banned, second]) assert.ok(!confirmed.text.includes(id), "never who reported");

  // Two other established fans agree on another score: two scores, so nothing is confirmed.
  for (const name of ["Score Three", "Score Four"]) await report(await fan(d, name), 30, 36);
  assert.deepEqual((await getScore(KEYS.regular)).body, { reports: 6, confirmed: false });
});

test("score status on a played game: confirmed only when an established report matches the Results watch score", async () => {
  // KEYS.played: Beta (home) 21, Alpha 14, a final. Reports are closed there, so these go straight into the table.
  const [{ id }] = await sudoRows("select resolve_game_key($1) as id", [KEYS.played]);
  const wrong = await fan(d, "Wrong Score");
  await sudoRows("insert into fan_score_report (game_id, reporter_id, home_score, away_score, established) values ($1, $2, 20, 14, true)", [id, wrong]);
  assert.deepEqual((await getScore(KEYS.played)).body, { reports: 1, confirmed: false });
  const right = await fan(d, "Right Score");
  await sudoRows("insert into fan_score_report (game_id, reporter_id, home_score, away_score, established) values ($1, $2, 21, 14, true)", [id, right]);
  assert.deepEqual((await getScore(KEYS.played)).body, { reports: 2, confirmed: true, homeScore: 21, awayScore: 14, basis: "results_watch" });
  // A key the database does not have.
  assert.deepEqual((await getScore("2026-09-04-nowhere-at-alpha")).body, { reports: 0, confirmed: false });
});

test("score status: a database error is 502 failed, logged by SQL state only", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  setPublic(FAIL);
  const r = await getScore(KEYS.regular);
  assert.deepEqual([r.status, r.body, r.cache], [502, { error: "failed" }, "no-store"]);
  noInternals(r);
  assert.deepEqual(logged.mock.calls.map((c) => c.arguments), [["score report: read failed", "57014"]]);
});
