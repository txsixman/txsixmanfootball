// The FAN_SIGNIN switch (lib/auth/config.ts fanSignIn) opens fan accounts and follows; the FAN_POSTS switch (fanPosts, ADR 0052)
// opens forums, game comments and score reports on top of it. Only the exact value "on" counts for either, and every posts route
// and page asks fanPosts() before doing anything else.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fanPosts, fanSignIn } from "../lib/auth/config.ts";

const app = new URL("../app/", import.meta.url).pathname;

test("only the exact value on opens fan accounts", () => {
  assert.equal(fanSignIn({ FAN_SIGNIN: "on" }), true);
  for (const v of ["", "ON", "On", "true", "1", "yes", " on", "on ", "off", "0", undefined]) assert.equal(fanSignIn({ FAN_SIGNIN: v }), false, String(v));
  assert.equal(fanSignIn({}), false);
});

test("posts need FAN_POSTS exactly on AND FAN_SIGNIN on; FAN_POSTS alone is nothing, and it never opens sign-in", () => {
  assert.equal(fanPosts({ FAN_SIGNIN: "on", FAN_POSTS: "on" }), true);
  for (const v of ["", "ON", "On", "true", "1", "yes", " on", "on ", "off", "0", undefined]) assert.equal(fanPosts({ FAN_SIGNIN: "on", FAN_POSTS: v }), false, String(v));
  for (const signin of ["", "off", "ON", undefined]) assert.equal(fanPosts({ FAN_SIGNIN: signin, FAN_POSTS: "on" }), false, String(signin));
  assert.equal(fanPosts({ FAN_POSTS: "on" }), false);
  assert.equal(fanPosts({ FAN_SIGNIN: "on" }), false);
  assert.equal(fanPosts({}), false);
  assert.equal(fanSignIn({ FAN_POSTS: "on" }), false);
});

const files = (dir, name) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), name) : e.name === name ? [path.join(dir, e.name)] : []));

test("every posts API route returns 404 first, before it reads a session or calls Supabase", () => {
  const routes = [...files(path.join(app, "api/fan"), "route.ts"), ...files(path.join(app, "api/games"), "route.ts")];
  assert.ok(routes.length >= 9, `found ${routes.length} routes`);
  for (const file of routes) {
    const src = readFileSync(file, "utf8");
    const gate = src.indexOf("closed()");
    assert.ok(gate > 0, `${file} never checks closed()`);
    for (const use of ["fanFor(", "publicClient(", "createAuthClient(", "readJson(", ".rpc("]) {
      const at = src.indexOf(use, src.indexOf("export async function"));
      assert.ok(at === -1 || at > gate, `${file}: ${use} before the gate`);
    }
  }
});

test("the forums' pages and the game page's fan blocks ask the switch", () => {
  for (const f of ["forums/page.tsx", "forums/[board]/page.tsx", "forums/thread/[id]/page.tsx"]) {
    assert.match(readFileSync(path.join(app, f), "utf8"), /if \(!fanPosts\(\)[^\n]*notFound\(\)/, f);
  }
  const game = readFileSync(path.join(app, "scores/[id]/page.tsx"), "utf8");
  assert.match(game, /const fan = fanPosts\(\)/);
  assert.match(game, /\{fan && !sample && g\.state === "scheduled" && <ScoreReport/);
  assert.match(game, /\{fan && !sample && \(\s*<div className="pb-6">\s*<Comments/);
});

test("posts routes close on fanPosts(), never on fanSignIn() alone", () => {
  const src = readFileSync(new URL("../lib/posts/api.ts", import.meta.url), "utf8");
  assert.match(src, /return fanPosts\(\) \? null :/);
  assert.ok(!/fanSignIn/.test(src));
});

test("the accounts side does not ask the posts switch: sign-in, the account, follows and the owner's moderation page stay open", () => {
  const stay = ["app/api/follows/route.ts", "app/account/page.tsx", "app/account/welcome/page.tsx", "app/sign-in/page.tsx", "app/admin/moderation/page.tsx", "app/admin/moderation/actions.ts"];
  for (const f of stay) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/notFound\(\)/.test(src) || !/fanPosts/.test(src), f);
  }
  // The moderation page may read the switch only to say so and to drop links to closed pages.
  const mod = readFileSync(new URL("../app/admin/moderation/page.tsx", import.meta.url), "utf8");
  assert.ok(!/notFound|redirect\(/.test(mod));
  assert.match(mod, /const postsOn = fanPosts\(\)/);
  // /api/me reports the switch for the page scripts, in every answer it gives.
  const me = readFileSync(new URL("../app/api/me/route.ts", import.meta.url), "utf8");
  assert.ok(!/reply\(\{ enabled,? me/.test(me), "an /api/me answer without posts");
  assert.match(me, /const posts = fanPosts\(\)/);
});

test("the switch is a server setting: no client component reads it", () => {
  const clients = ["app/scores/comments.tsx", "app/scores/score-report.tsx", "app/posts/client.ts", "app/posts/post-parts.tsx", "app/forums/[board]/new-thread.tsx", "app/forums/thread/[id]/thread-view.tsx"];
  for (const f of clients) assert.ok(!/FAN_SIGNIN|FAN_POSTS|fanSignIn|fanPosts/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")), f);
});

test("a page built with posts on hides its blocks when the routes answer 404", () => {
  for (const [f, flag] of [["app/scores/comments.tsx", /r\.status === 404/], ["app/scores/score-report.tsx", /r\.status === 404/]]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, flag, f);
    assert.match(src, /(off\) return null|"off"\) return null)/, f);
  }
});

test("the database has its own switch, closed by default, that every posting function checks through fan_actor()", () => {
  const sql = readFileSync(new URL("../../../packages/db/migrations/0024_posts_switch.sql", import.meta.url), "utf8");
  assert.match(sql, /is_on boolean not null default false/);
  assert.match(sql, /insert into site_switch \(name\) values \('posts'\)/);
  assert.match(sql, /raise exception 'posts_closed'/);
  const posting = ["add_comment", "edit_post", "flag_post", "submit_score_report", "create_thread", "reply_to_thread"];
  for (const [file, names] of [["0013_moderation.sql", posting.slice(0, 3)], ["0014_score_reports.sql", ["submit_score_report"]], ["0015_forums.sql", ["create_thread", "reply_to_thread"]]]) {
    const old = readFileSync(new URL(`../../../packages/db/migrations/${file}`, import.meta.url), "utf8");
    for (const n of names) {
      const body = old.slice(old.indexOf(`create function ${n}(`));
      assert.ok(body.slice(0, body.indexOf("$$;", 100)).includes("from fan_actor()"), `${n} no longer goes through fan_actor()`);
    }
  }
});

test("a body that declares more than 16 KB is refused before it is read", () => {
  const src = readFileSync(new URL("../lib/posts/api.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function readJson"));
  assert.ok(fn.indexOf('headers.get("content-length")') > 0, "no Content-Length check");
  assert.ok(fn.indexOf('headers.get("content-length")') < fn.indexOf("request.text()"), "the body is read first");
  assert.match(fn, /!\(Number\(declared\) <= 16_384\)\) return null/, "a missing number or a large one must refuse");
});
