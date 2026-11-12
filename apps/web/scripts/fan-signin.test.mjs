// The FAN_SIGNIN switch (lib/auth/config.ts fanSignIn): only the exact value "on" opens fan posting, and every fan route
// and page asks it before doing anything else.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fanSignIn } from "../lib/auth/config.ts";

const app = new URL("../app/", import.meta.url).pathname;

test("only the exact value on opens fan posting", () => {
  assert.equal(fanSignIn({ FAN_SIGNIN: "on" }), true);
  for (const v of ["", "ON", "On", "true", "1", "yes", " on", "on ", "off", "0", undefined]) assert.equal(fanSignIn({ FAN_SIGNIN: v }), false, String(v));
  assert.equal(fanSignIn({}), false);
});

const files = (dir, name) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), name) : e.name === name ? [path.join(dir, e.name)] : []));

test("every fan and game API route returns 404 first, before it reads a session or calls Supabase", () => {
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
    assert.match(readFileSync(path.join(app, f), "utf8"), /if \(!fanSignIn\(\)[^\n]*notFound\(\)/, f);
  }
  const game = readFileSync(path.join(app, "scores/[id]/page.tsx"), "utf8");
  assert.match(game, /const fan = fanSignIn\(\)/);
  assert.match(game, /\{fan && !sample && g\.state === "scheduled" && <ScoreReport/);
  assert.match(game, /\{fan && !sample && \(\s*<div className="pb-6">\s*<Comments/);
});

test("the switch is a server setting: no client component reads it", () => {
  const clients = ["app/scores/comments.tsx", "app/scores/score-report.tsx", "app/posts/client.ts", "app/posts/post-parts.tsx"];
  for (const f of clients) assert.ok(!/FAN_SIGNIN|fanSignIn/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")), f);
});

test("a body that declares more than 16 KB is refused before it is read", () => {
  const src = readFileSync(new URL("../lib/posts/api.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function readJson"));
  assert.ok(fn.indexOf('headers.get("content-length")') > 0, "no Content-Length check");
  assert.ok(fn.indexOf('headers.get("content-length")') < fn.indexOf("request.text()"), "the body is read first");
  assert.match(fn, /!\(Number\(declared\) <= 16_384\)\) return null/, "a missing number or a large one must refuse");
});
