// The fan and account route handlers (app/api/fan/*, app/api/follows, app/api/me, lib/posts/api.ts) run as they are,
// against the real migrations on PGlite. Only Supabase's transport is replaced: a client whose rpc() calls the SQL
// function by its argument NAMES, as PostgREST does, as the role and auth.uid() the session gives (packages/db/test's
// setup), and whose auth.getUser() answers for the session the test chose. So a handler that sends an argument the SQL
// does not have fails here as it would in production (PGRST202), every refusal comes from the database's own rules, and
// what a page gets back is checked: the status, the code, and nothing of the database's own wording.
//   node --test apps/web/scripts/   (needs `npm ci --prefix packages/db` for PGlite)
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { before, beforeEach, test } from "node:test";
import { ADMIN, KEYS, db, fan, newId, sudo } from "../../../packages/db/test/posts-helpers.mjs";

// Module resolution the way the site's bundler does it: "@/x" is apps/web/x, a path without an extension is a .ts file,
// next/server is next/server.js. Two modules are replaced: next/headers (no request scope outside Next) and
// @supabase/ssr, whose createServerClient hands back the test's client. lib/auth/server.ts itself runs as it is.
const web = new URL("../", import.meta.url);
const stub = (src) => `data:text/javascript,${encodeURIComponent(src)}`;
const STUBS = {
  "next/headers": stub("export const cookies = async () => ({ getAll: () => [], set() {} });"),
  "@supabase/ssr": stub("export const createServerClient = () => globalThis.__testSupabase();"),
};
registerHooks({
  resolve(specifier, context, next) {
    if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
    const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), web).href : specifier;
    try {
      return next(spec, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
      for (const ext of [".ts", ".js", "/index.ts"]) {
        try {
          return next(spec + ext, context);
        } catch {
          // try the next one
        }
      }
      throw error;
    }
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.ADMIN_USER_ID = ADMIN;

const { NextRequest } = await import("next/server");
const route = async (p) => import(new URL(`../app/api/${p}/route.ts`, import.meta.url).href);
const comments = await route("fan/comments");
const fanMe = await route("fan/me");
const replies = await route("fan/replies");
const reports = await route("fan/reports");
const threads = await route("fan/threads");
const post = await route("fan/posts/[id]");
const flag = await route("fan/posts/[id]/flag");
const follows = await route("follows");
const me = await route("me");

// --- The fake Supabase client -------------------------------------------------------------------------------------

let d;
let queue = Promise.resolve();
/** One database call at a time: each one sets the role and auth.uid() for itself (PGlite has one connection). */
const serial = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};
const json = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
/** Every rpc() the handlers made, by function name and argument names, for the shape checks. */
const calls = [];

/** PostgREST's rpc: find the public function whose input arguments match the names sent, call it by name, as the session's role. */
async function rpc(sub, fn, args = {}) {
  calls.push({ fn, args: Object.keys(args).sort() });
  return serial(async () => {
    const names = Object.keys(args);
    const { rows } = await d.query(
      `select p.proretset as set, t.typtype, p.prorettype = 'void'::regtype as void, p.pronargs, p.pronargdefaults,
              coalesce(p.proargnames, '{}') as argnames, p.proargmodes::text[] as modes
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
        where n.nspname = 'public' and p.proname = $1`,
      [fn],
    );
    const fit = rows.find((r) => {
      const inputs = r.argnames.filter((_, i) => !r.modes || ["i", "b", "v"].includes(r.modes[i]));
      const required = inputs.slice(0, r.pronargs - r.pronargdefaults);
      return names.every((n) => inputs.includes(n)) && required.every((n) => names.includes(n));
    });
    if (!fit) {
      return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}(${names.join(", ")}) in the schema cache` } };
    }
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
    const sql = fit.set || fit.typtype === "c" ? `select * from ${call}` : `select ${call} as v`;
    await d.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${sub ? "authenticated" : "anon"}`);
    try {
      const result = await d.query(sql, Object.values(args));
      if (fit.void) return { data: null, error: null };
      if (fit.set) return { data: json(result.rows), error: null };
      return { data: json(fit.typtype === "c" ? result.rows[0] : result.rows[0].v), error: null };
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
    } finally {
      await d.exec("reset role");
    }
  });
}

/** A client for one session: `sub` signed in, null signed out. `fail`: every rpc answers with that error instead. */
const client = (sub, { fail } = {}) => ({
  auth: {
    getUser: async () => (sub ? { data: { user: { id: sub } }, error: null } : { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 } }),
  },
  rpc: (fn, args) => (fail ? Promise.resolve({ data: null, error: fail }) : rpc(sub, fn, args)),
});
let current = client(null);
globalThis.__testSupabase = () => current;
const signIn = (sub, opts) => (current = client(sub, opts));
const signOut = () => (current = client(null));

// --- Requests ----------------------------------------------------------------------------------------------------

const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;
function request(path, { method = "POST", body, origin = ORIGIN, type = "application/json", cookie, referer, raw } = {}) {
  const headers = { host: HOST };
  if (origin) headers.origin = origin;
  if (type) headers["content-type"] = type;
  if (cookie) headers.cookie = cookie;
  if (referer) headers.referer = referer;
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new NextRequest(`${ORIGIN}${path}`, { method, headers, body: method === "GET" ? undefined : payload });
}
const params = (id) => ({ params: Promise.resolve({ id }) });
async function read(res) {
  const text = await res.text();
  return { status: res.status, cache: res.headers.get("cache-control"), body: text ? JSON.parse(text) : null, text };
}
/** Nothing of the database's own wording, a user id or an SQL state reaches the page. */
function noInternals(r) {
  assert.doesNotMatch(r.text, /permission|denied|function|schema|relation|select|public\.|\b[0-9A-Z]{5}\b|aaaaaaaa-|PGRST/);
}

before(async () => {
  d = await db();
});
beforeEach(() => {
  process.env.FAN_SIGNIN = "on";
  signOut();
  calls.length = 0;
});

const sudoRows = (sql, p) => serial(async () => (await sudo(d, sql, p)).rows);

// --- Every fan write: the switch, the site check, the session, the profile ------------------------------------------

const WRITES = [
  ["comments", () => comments.POST(request("/api/fan/comments", { body: { gameKey: KEYS.regular, body: "Good game." } }))],
  ["replies", () => replies.POST(request("/api/fan/replies", { body: { threadId: newId(), body: "Agreed." } }))],
  ["reports", () => reports.POST(request("/api/fan/reports", { body: { gameKey: KEYS.regular, home: 40, away: 20 } }))],
  ["threads", () => threads.POST(request("/api/fan/threads", { body: { board: "general", title: "Week 12", body: "Who wins?" } }))],
  ["edit", () => post.PATCH(request(`/api/fan/posts/${newId()}`, { method: "PATCH", body: { body: "Edited." } }), params(newId()))],
  ["flag", () => flag.POST(request(`/api/fan/posts/${newId()}/flag`, { body: {} }), params(newId()))],
];

test("fan accounts off: every fan write is a bare 404 and nothing asks the database", async () => {
  process.env.FAN_SIGNIN = "off";
  signIn(await fan(d, "Switch Off"), { fail: { code: "XX000", message: "must not be called" } });
  for (const [name, call] of WRITES) {
    const r = await read(await call());
    assert.equal(r.status, 404, name);
    assert.equal(r.body, null, name);
    assert.equal(r.cache, "no-store, private", name);
  }
  assert.deepEqual(calls, []);
});

test("signed out: every fan write is 401 sign_in_required", async () => {
  for (const [name, call] of WRITES) {
    const r = await read(await call());
    assert.equal(r.status, 401, name);
    assert.deepEqual(r.body, { error: "sign_in_required", message: "Sign in to do that." }, name);
  }
});

test("a signed-in account without a profile (sign-up not finished) is 403 profile_required", async () => {
  signIn(newId());
  for (const [name, call] of WRITES) {
    const r = await read(await call());
    assert.equal(r.status, 403, name);
    assert.equal(r.body.error, "profile_required", name);
  }
});

test("a write from another site, or not sent as JSON, is 403 cross_site before the session is read", async () => {
  signIn(await fan(d, "Cross Site"));
  const body = { gameKey: KEYS.regular, body: "Hi." };
  for (const req of [
    request("/api/fan/comments", { body, origin: "https://evil.example" }),
    request("/api/fan/comments", { body, origin: "null" }),
    request("/api/fan/comments", { raw: "gameKey=x&body=y", type: "application/x-www-form-urlencoded" }),
    request("/api/fan/comments", { raw: JSON.stringify(body), type: "text/plain" }),
  ]) {
    const r = await read(await comments.POST(req));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "cross_site");
  }
  assert.deepEqual(calls, []);
});

test("banned and muted accounts are refused before the write; the database would refuse them too", async () => {
  const muted = await fan(d, "Muted Fan", { muted: true });
  const banned = await fan(d, "Banned Fan");
  await sudoRows("update profile set banned = true where user_id = $1", [banned]);
  for (const [who, code] of [
    [muted, "muted"],
    [banned, "banned"],
  ]) {
    signIn(who);
    for (const [name, call] of WRITES.filter(([n]) => n !== "flag")) {
      const r = await read(await call());
      assert.equal(r.status, 403, `${code} ${name}`);
      assert.equal(r.body.error, code, `${code} ${name}`);
    }
    calls.length = 0;
    await rpc(who, "add_comment", { p_game_key: KEYS.regular, p_body: "Straight to the database." }).then(({ error }) => assert.equal(error.message, code));
  }
});

// --- Comments, edits and flags -------------------------------------------------------------------------------------

test("a comment: saved with the SQL's argument names, answered with its id and the author's display name", async () => {
  const author = await fan(d, "Comment Author");
  signIn(author);
  const r = await read(await comments.POST(request("/api/fan/comments", { body: { gameKey: KEYS.regular, body: "  Great defense tonight.  " } })));
  assert.equal(r.status, 200);
  assert.equal(r.body.author, "Comment Author");
  assert.match(r.body.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls.at(-1), { fn: "add_comment", args: ["p_body", "p_game_key"] });
  const [row] = await sudoRows("select author_id, game_key, body from post where id = $1", [r.body.id]);
  assert.deepEqual(row, { author_id: author, game_key: KEYS.regular, body: "Great defense tonight." });
});

test("comment refusals: bad shape 422, a game the database does not know 404, text rules 422, too fast 429", async () => {
  const author = await fan(d, "New Commenter", { old: false });
  signIn(author);
  const send = async (body, opts) => read(await comments.POST(request("/api/fan/comments", { body, ...opts })));
  for (const body of [{}, { gameKey: KEYS.regular }, { gameKey: "../etc", body: "x" }, { gameKey: KEYS.regular, body: 5 }, { gameKey: KEYS.regular, body: "x".repeat(4001) }]) {
    const r = await send(body);
    assert.equal(r.status, 422, JSON.stringify(body).slice(0, 60));
    assert.equal(r.body.error, "bad_text");
  }
  assert.equal((await read(await comments.POST(request("/api/fan/comments", { raw: "{not json" })))).body.error, "bad_text");
  // A well-formed key for a game the database does not have: the database's refusal, mapped.
  const unknown = await send({ gameKey: "2026-09-04-nowhere-at-alpha", body: "Hello." });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "unknown_game");
  // A new account may not post links (checked here first).
  const link = await send({ gameKey: KEYS.regular, body: "See https://example.com" });
  assert.deepEqual([link.status, link.body.error], [422, "links_not_allowed"]);
  // A new account's limit is 3 posts in 10 minutes; the 4th is the database's rate_limited.
  for (let i = 0; i < 3; i++) assert.equal((await send({ gameKey: KEYS.regular, body: `Comment ${i}` })).status, 200);
  const fast = await send({ gameKey: KEYS.regular, body: "One more." });
  assert.deepEqual([fast.status, fast.body.error], [429, "rate_limited"]);
});

test("a body over 16 KB is refused before anything is written", async () => {
  signIn(await fan(d, "Big Body"));
  const big = await read(await comments.POST(request("/api/fan/comments", { raw: JSON.stringify({ gameKey: KEYS.regular, body: "x".repeat(17_000) }) })));
  assert.deepEqual([big.status, big.body.error], [422, "bad_text"]);
  assert.deepEqual(calls.map((c) => c.fn), ["my_profile"]);
});

test("edit: my own post with edit_post's argument names; another fan's is not_found; a bad id never reaches the database", async () => {
  const author = await fan(d, "Editor");
  const other = await fan(d, "Not Editor");
  signIn(author);
  const { body } = await read(await comments.POST(request("/api/fan/comments", { body: { gameKey: KEYS.regular, body: "First words." } })));
  const edit = (id, payload) => post.PATCH(request(`/api/fan/posts/${id}`, { method: "PATCH", body: payload }), params(id));
  assert.equal((await read(await edit(body.id, { body: "Second words." }))).status, 200);
  assert.deepEqual(calls.at(-1), { fn: "edit_post", args: ["p_body", "p_post", "p_title"] });
  assert.deepEqual(await sudoRows("select body from post where id = $1", [body.id]), [{ body: "Second words." }]);
  assert.deepEqual(await sudoRows("select body from post_edit where post_id = $1", [body.id]), [{ body: "First words." }]);
  signIn(other);
  const theirs = await read(await edit(body.id, { body: "Hijacked." }));
  assert.deepEqual([theirs.status, theirs.body.error], [404, "not_found"]);
  assert.deepEqual(await sudoRows("select body from post where id = $1", [body.id]), [{ body: "Second words." }]);
  calls.length = 0;
  const bad = await read(await edit("not-a-uuid", { body: "x" }));
  assert.deepEqual([bad.status, bad.body.error], [404, "not_found"]);
  assert.deepEqual(calls, []);
});

test("flag: another fan's post with flag_post's argument name; my own is 400 own_post; a missing post 404", async () => {
  const author = await fan(d, "Flag Author");
  const flagger = await fan(d, "Flagger");
  signIn(author);
  const { body } = await read(await comments.POST(request("/api/fan/comments", { body: { gameKey: KEYS.regular, body: "Flag me." } })));
  const flagIt = (id) => flag.POST(request(`/api/fan/posts/${id}/flag`, { body: {} }), params(id));
  const own = await read(await flagIt(body.id));
  assert.deepEqual([own.status, own.body.error], [400, "own_post"]);
  signIn(flagger);
  assert.equal((await read(await flagIt(body.id))).status, 200);
  assert.deepEqual(calls.at(-1), { fn: "flag_post", args: ["p_post"] });
  assert.equal((await sudoRows("select count(*)::int as n from post_flag where post_id = $1 and flagger_id = $2", [body.id, flagger]))[0].n, 1);
  const missing = await read(await flagIt(newId()));
  assert.deepEqual([missing.status, missing.body.error], [404, "not_found"]);
});

// --- Score reports ------------------------------------------------------------------------------------------------

test("score report: saved with submit_score_report's argument names; twice 409; a scored game 409; bad scores 422", async () => {
  const reporter = await fan(d, "Reporter");
  signIn(reporter);
  const send = async (body) => read(await reports.POST(request("/api/fan/reports", { body })));
  assert.equal((await send({ gameKey: KEYS.regular, home: 44, away: 38 })).status, 200);
  assert.deepEqual(calls.at(-1), { fn: "submit_score_report", args: ["p_away", "p_game_key", "p_home"] });
  assert.deepEqual(await sudoRows("select home_score, away_score from fan_score_report where reporter_id = $1", [reporter]), [{ home_score: 44, away_score: 38 }]);
  const again = await send({ gameKey: KEYS.regular, home: 44, away: 38 });
  assert.deepEqual([again.status, again.body.error], [409, "already_reported"]);
  const played = await send({ gameKey: KEYS.played, home: 1, away: 0 });
  assert.deepEqual([played.status, played.body.error], [409, "game_closed"]);
  for (const body of [{ gameKey: KEYS.regular, home: -1, away: 0 }, { gameKey: KEYS.regular, home: 200, away: 0 }, { gameKey: KEYS.regular, home: 1.5, away: 0 }, { gameKey: KEYS.regular, home: "7", away: 0 }, { gameKey: KEYS.regular }]) {
    const r = await send(body);
    assert.deepEqual([r.status, r.body.error], [422, "bad_score"], JSON.stringify(body));
  }
});

// --- Forums -------------------------------------------------------------------------------------------------------

test("thread and reply: saved with the SQL's argument names; a reply to a missing thread 404; an unknown board 422", async () => {
  const author = await fan(d, "Thread Starter");
  signIn(author);
  const t = await read(await threads.POST(request("/api/fan/threads", { body: { board: "general", title: "Week 12 picks", body: "Who wins Friday?" } })));
  assert.equal(t.status, 200);
  assert.deepEqual(calls.at(-1), { fn: "create_thread", args: ["p_board", "p_body", "p_title"] });
  assert.deepEqual(await sudoRows("select board from forum_thread where id = $1", [t.body.id]), [{ board: "general" }]);
  const reply = await read(await replies.POST(request("/api/fan/replies", { body: { threadId: t.body.id, body: "Jayton." } })));
  assert.equal(reply.status, 200);
  assert.deepEqual(calls.at(-1), { fn: "reply_to_thread", args: ["p_body", "p_thread"] });
  assert.deepEqual(await sudoRows("select thread_id, body from post where id = $1", [reply.body.id]), [{ thread_id: t.body.id, body: "Jayton." }]);
  const missing = await read(await replies.POST(request("/api/fan/replies", { body: { threadId: newId(), body: "Hello?" } })));
  assert.deepEqual([missing.status, missing.body.error], [404, "not_found"]);
  const board = await read(await threads.POST(request("/api/fan/threads", { body: { board: "nope", title: "x", body: "y" } })));
  assert.deepEqual([board.status, board.body.error], [422, "bad_text"]);
  const badId = await read(await replies.POST(request("/api/fan/replies", { body: { threadId: "1", body: "x" } })));
  assert.deepEqual([badId.status, badId.body.error], [422, "bad_text"]);
  // The title has its own length rule (120), checked here before the database.
  const long = await read(await threads.POST(request("/api/fan/threads", { body: { board: "general", title: "t".repeat(121), body: "y" } })));
  assert.deepEqual([long.status, long.body.error], [422, "bad_text"]);
});

// --- Errors the page should never see the inside of -----------------------------------------------------------------

test("a database error that is not a refusal: 500 failed, the plain sentence, and only the SQL state logged", async (t) => {
  const author = await fan(d, "Unlucky");
  signIn(author);
  const logged = t.mock.method(console, "error", () => {});
  await sudoRows("revoke execute on function add_comment(text, text) from authenticated");
  try {
    const r = await read(await comments.POST(request("/api/fan/comments", { body: { gameKey: KEYS.regular, body: "Will this work?" } })));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: "failed", message: "Something went wrong. Try again in a minute." });
    noInternals(r);
    assert.deepEqual(logged.mock.calls.map((c) => c.arguments), [["posts: database call failed", "42501"]]);
  } finally {
    await sudoRows("grant execute on function add_comment(text, text) to authenticated");
  }
});

test("a handler that sent an argument the SQL does not have would fail closed, not as a refusal", async (t) => {
  const author = await fan(d, "Wrong Shape");
  signIn(author);
  t.mock.method(console, "error", () => {});
  const { error } = await current.rpc("add_comment", { p_game: KEYS.regular, p_body: "x" });
  assert.equal(error.code, "PGRST202");
  const { refusal } = await import("../lib/posts/api.ts");
  const r = await read(refusal(error));
  assert.deepEqual([r.status, r.body.error], [500, "failed"]);
  noInternals(r);
});

// --- Who is signed in --------------------------------------------------------------------------------------------

test("/api/fan/me: signed out, no profile, a fan, a muted fan; only the name and the posting flags", async () => {
  const get = async () => read(await fanMe.GET(request("/api/fan/me", { method: "GET" })));
  assert.deepEqual((await get()).body, { signedIn: false });
  signIn(newId());
  assert.deepEqual((await get()).body, { signedIn: true, profile: false });
  signIn(await fan(d, "Plain Fan"));
  const ok = await get();
  assert.deepEqual(ok.body, { signedIn: true, profile: true, displayName: "Plain Fan", established: true, canPost: true, muted: false, banned: false });
  assert.equal(ok.cache, "no-store, private");
  signIn(await fan(d, "Quiet Fan", { muted: true, old: false }));
  assert.deepEqual((await get()).body, { signedIn: true, profile: true, displayName: "Quiet Fan", established: false, canPost: false, muted: true, banned: false });
  process.env.FAN_SIGNIN = "off";
  assert.equal((await get()).status, 404);
});

test("/api/fan/me: a database failure is 503, never mistaken for signed out", async (t) => {
  t.mock.method(console, "error", () => {});
  signIn(await fan(d, "Hiccup"), { fail: { code: "57014", message: "canceling statement due to statement timeout" } });
  const r = await read(await fanMe.GET(request("/api/fan/me", { method: "GET" })));
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, { error: "unavailable" });
  noInternals(r);
});

const SESSION = "sb-localhost-auth-token=base64-test";

test("/api/me: off, no cookie, or nobody signed in answers without the database; a fan gets the name and follows", async () => {
  const get = async (opts = {}) => read(await me.GET(request("/api/me", { method: "GET", ...opts })));
  process.env.FAN_SIGNIN = "off";
  signIn(await fan(d, "Off Fan"), { fail: { code: "XX000", message: "must not be called" } });
  assert.deepEqual((await get({ cookie: SESSION })).body, { enabled: false, me: null });
  process.env.FAN_SIGNIN = "on";
  assert.deepEqual((await get()).body, { enabled: true, me: null });
  assert.deepEqual(calls, []);
  signOut();
  assert.deepEqual((await get({ cookie: SESSION })).body, { enabled: true, me: null });
  const follower = await fan(d, "Follower");
  signIn(follower);
  await rpc(follower, "follow_program", { p_slug: "jayton" });
  const r = await get({ cookie: SESSION });
  assert.deepEqual(r.body, { enabled: true, me: { displayName: "Follower", follows: ["jayton"] } });
  assert.equal(r.cache, "no-store, private");
  signIn(newId());
  assert.deepEqual((await get({ cookie: SESSION })).body, { enabled: true, me: { displayName: null, follows: [] } });
});

test("/api/me: the admin is marked, also from an admin page while fan accounts are off; a failure is 503", async () => {
  signIn(ADMIN);
  process.env.FAN_SIGNIN = "off";
  assert.deepEqual((await read(await me.GET(request("/api/me", { method: "GET", cookie: SESSION, referer: `${ORIGIN}/admin/posts` })))).body, {
    enabled: false,
    me: { displayName: null, follows: [], admin: true },
  });
  // Another site's /admin is not an admin page.
  assert.deepEqual((await read(await me.GET(request("/api/me", { method: "GET", cookie: SESSION, referer: "https://evil.example/admin" })))).body, { enabled: false, me: null });
  process.env.FAN_SIGNIN = "on";
  signIn(await fan(d, "Plain Supporter"));
  assert.equal((await read(await me.GET(request("/api/me", { method: "GET", cookie: SESSION })))).body.me.admin, undefined);
  signIn(ADMIN, { fail: { code: "57014", message: "canceling statement due to statement timeout" } });
  const r = await read(await me.GET(request("/api/me", { method: "GET", cookie: SESSION })));
  assert.deepEqual([r.status, r.body], [503, { error: "unavailable" }]);
  noInternals(r);
});

// --- Follows ------------------------------------------------------------------------------------------------------

const followReq = (body, opts) => follows.POST(request("/api/follows", { body, ...opts }));

test("follows: follow, unfollow and import with the SQL's argument name; the answer is the account's follows", async () => {
  const who = await fan(d, "Follows Fan");
  signIn(who);
  assert.deepEqual((await read(await followReq({ op: "follow", slug: "jayton" }))).body, { follows: ["jayton"] });
  assert.deepEqual(calls.find((c) => c.fn === "follow_program"), { fn: "follow_program", args: ["p_slug"] });
  const imported = await read(await followReq({ op: "import", slugs: ["strawn", "guthrie", "strawn", "jayton"] }));
  assert.deepEqual(imported.body.follows.sort(), ["guthrie", "jayton", "strawn"]);
  const r = await read(await followReq({ op: "unfollow", slug: "jayton" }));
  assert.deepEqual(calls.find((c) => c.fn === "unfollow_program"), { fn: "unfollow_program", args: ["p_slug"] });
  assert.deepEqual(r.body.follows.sort(), ["guthrie", "strawn"]);
  assert.equal(r.cache, "no-store, private");
});

test("follows refusals: off 404, another site 403, not JSON 415, bad shape 400, signed out 401, no profile 403, full 409", async () => {
  process.env.FAN_SIGNIN = "off";
  assert.equal((await followReq({ op: "follow", slug: "jayton" })).status, 404);
  process.env.FAN_SIGNIN = "on";
  assert.equal((await followReq({ op: "follow", slug: "jayton" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await followReq({ op: "follow", slug: "jayton" }, { origin: null })).status, 403);
  assert.equal((await follows.POST(request("/api/follows", { raw: '{"op":"follow","slug":"jayton"}', type: "text/plain" }))).status, 415);
  for (const body of [{}, { op: "follow" }, { op: "follow", slug: "Jayton" }, { op: "follow", slug: "a--b" }, { op: "import", slugs: Array(101).fill("jayton") }, { op: "drop", slug: "jayton" }]) {
    assert.equal((await followReq(body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await follows.POST(request("/api/follows", { raw: "{nope" }))).status, 400);
  assert.equal((await followReq({ op: "follow", slug: "jayton" })).status, 401);
  assert.deepEqual(calls, []);
  signIn(newId());
  const noProfile = await read(await followReq({ op: "follow", slug: "jayton" }));
  assert.deepEqual([noProfile.status, noProfile.body], [403, { error: "finish sign-up" }]);
  const full = await fan(d, "Full Follows");
  signIn(full);
  const hundred = Array.from({ length: 100 }, (_, i) => `program-${i}`);
  assert.equal((await read(await followReq({ op: "import", slugs: hundred }))).body.follows.length, 100);
  const over = await read(await followReq({ op: "follow", slug: "one-more" }));
  assert.deepEqual([over.status, over.body], [409, { error: "limit" }]);
});

test("follows: a database failure is 503 with nothing of the error", async () => {
  signIn(await fan(d, "Follow Hiccup"), { fail: { code: "57014", message: "canceling statement due to statement timeout" } });
  const r = await read(await followReq({ op: "follow", slug: "jayton" }));
  assert.deepEqual([r.status, r.body], [503, { error: "unavailable" }]);
  noInternals(r);
});
