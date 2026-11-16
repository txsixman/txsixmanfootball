// /api/games/comment-counts (ADR 0077) runs as it is on the real migrations in PGlite, as the anon role, through
// route-harness.mjs: the switch, the key rules, the answer's shape and cache header, what is never counted, and what a
// database error shows. The pure key parsing is tested without a database in the same file.
//   node --test apps/web/scripts/*.test.mjs   (needs `npm ci --prefix packages/db` for PGlite)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, test } from "node:test";
import { calls, noInternals, read, request, route, setPublic, signOut, sudoRows, useDb, sent } from "./route-harness.mjs";
import { KEYS, db, fan } from "../../../packages/db/test/posts-helpers.mjs";
import { COUNT_KEY, MAX_COUNT_KEYS, parseCountKeys } from "../lib/posts/comment-counts.ts";

const counts = await route("games/comment-counts");

let d;
before(async () => {
  d = await db();
  useDb(d);
});
beforeEach(() => {
  process.env.FAN_SIGNIN = "on";
  process.env.FAN_POSTS = "on";
  signOut();
  calls.length = 0;
  sent.length = 0;
});

const get = async (keys) => read(await counts.GET(request(`/api/games/comment-counts${keys === undefined ? "" : `?keys=${keys}`}`, { method: "GET" })));
const CACHED = "public, s-maxage=30, stale-while-revalidate=60";

test("the key rule is the comments route's rule", () => {
  const src = readFileSync(new URL("../app/api/games/[id]/comments/route.ts", import.meta.url), "utf8");
  assert.equal(src.match(/const KEY = (\/.*\/);/)?.[1], COUNT_KEY.toString());
});

test("keys: valid ones only, each once, in order, at most 200; anything else is dropped", () => {
  assert.deepEqual(parseCountKeys(null), []);
  assert.deepEqual(parseCountKeys(""), []);
  assert.deepEqual(parseCountKeys(`${KEYS.playoff},${KEYS.regular},${KEYS.playoff}`), [KEYS.playoff, KEYS.regular]);
  assert.deepEqual(parseCountKeys(`x,UPPER-case-key,-starts-with-dash,${"a".repeat(202)},2026'--,,${KEYS.regular}, ${KEYS.playoff}`), [KEYS.regular]);
  const many = Array.from({ length: 300 }, (_, i) => `2026-game-number-${i}`);
  assert.deepEqual(parseCountKeys(many.join(",")), many.slice(0, MAX_COUNT_KEYS));
  assert.deepEqual(parseCountKeys("a".repeat(500_000)), []);
  assert.equal(parseCountKeys(Array.from({ length: 200 }, (_, i) => `${i.toString(36).padStart(6, "a")}${"b".repeat(195)}`).join(",")).length, 200, "200 of the longest keys fit");
});

test("fan accounts off or posts off: a bare 404, never cached, and nothing asks the database", async () => {
  setPublic({ fail: { code: "XX000", message: "must not be called" } });
  for (const env of [{ FAN_SIGNIN: "off" }, { FAN_POSTS: undefined }]) {
    Object.assign(process.env, { FAN_SIGNIN: "on", FAN_POSTS: "on" });
    for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    const r = await get(KEYS.regular);
    assert.deepEqual([r.status, r.body, r.cache], [404, null, "no-store, private"]);
  }
  assert.deepEqual(calls, []);
});

test("counts only the visible comments, only games with some, as { counts }, cached 30 seconds", async () => {
  const [a, b] = [await fan(d, "Count Fan"), await fan(d, "Banned Count Fan")];
  await sudoRows(`insert into post (author_id, game_key, body) select $1, $2, 'Comment ' || i from generate_series(1, 3) i`, [a, KEYS.playoff]);
  await sudoRows(`insert into post (author_id, game_key, body) values ($1, $2, 'Hidden'), ($3, $4, 'Banned')`, [a, KEYS.playoff, b, KEYS.regular]);
  await sudoRows("update post set hidden_at = now() where body = 'Hidden'");
  await sudoRows("update profile set banned = true where user_id = $1", [b]);
  const r = await get(`${KEYS.playoff},${KEYS.regular},${KEYS.played},Not-A-Key,x`);
  assert.deepEqual([r.status, r.body, r.cache], [200, { counts: { [KEYS.playoff]: 3 } }, CACHED]);
  assert.deepEqual(calls, [{ fn: "comment_counts", args: ["p_game_keys"] }]);
  assert.deepEqual(sent, [{ p_game_keys: [KEYS.playoff, KEYS.regular, KEYS.played] }], "only the valid keys reach the database");
  assert.ok(!r.text.includes(a) && !r.text.includes(b), "no user id");
});

test("no keys, or none valid: an empty answer without asking the database", async () => {
  setPublic({ fail: { code: "XX000", message: "must not be called" } });
  for (const q of [undefined, "", "x,y", "UPPER-case-key"]) {
    const r = await get(q);
    assert.deepEqual([r.status, r.body, r.cache], [200, { counts: {} }, CACHED], String(q));
  }
  assert.deepEqual(calls, []);
});

test("without Supabase configured the answer is empty", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    assert.deepEqual((await get(KEYS.regular)).body, { counts: {} });
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  }
  assert.deepEqual(calls, []);
});

test("a database error is 502 failed, never cached, logged by SQL state only", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  setPublic({ fail: { code: "57014", message: "canceling statement due to statement timeout on function comment_counts" } });
  const r = await get(KEYS.regular);
  assert.deepEqual([r.status, r.body, r.cache], [502, { error: "failed" }, "no-store"]);
  noInternals(r);
  assert.deepEqual(logged.mock.calls.map((c) => c.arguments), [["comments: count failed", "57014"]]);
  // The same through the real database: the anon role losing the function.
  signOut();
  await sudoRows("revoke execute on function comment_counts(text[]) from anon");
  try {
    const denied = await get(KEYS.regular);
    assert.deepEqual([denied.status, denied.body], [502, { error: "failed" }]);
    noInternals(denied);
  } finally {
    await sudoRows("grant execute on function comment_counts(text[]) to anon");
  }
});
