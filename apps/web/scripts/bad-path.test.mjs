// A broken percent-encoding in an address is a 400, never a 500 (lib/bad-path.ts, answered by proxy.ts for /api/games/...).
//   node --test apps/web/scripts/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hasBadEncoding } from "../lib/bad-path.ts";

test("a lone byte, a cut-off escape and a trailing percent are bad; ordinary and encoded addresses are not", () => {
  for (const bad of ["/api/games/%ff/comments", "/api/games/%E0%A4%A/comments", "/api/games/abc%/comments", "/api/games/%c0%af/x"]) assert.equal(hasBadEncoding(bad), true, bad);
  for (const ok of ["/api/games/2026-09-04-guthrie-at-jayton/comments", "/api/games/%E2%9C%93/comments", "/api/games/a%20b/comments", "/"]) assert.equal(hasBadEncoding(ok), false, ok);
});

test("the proxy runs for /api/games/... only when the raw address holds a percent sign, and then answers 400 first", async () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const source = /"(\/api\/games\/:[^"]*)"/.exec(proxy)?.[1];
  assert.ok(source, "proxy.ts matcher lists an /api/games/ address");
  // Next's own compile of a matcher, as the router tests it against the request's path.
  const { createRequire } = await import("node:module");
  const { getMiddlewareMatchers } = createRequire(import.meta.url)("next/dist/build/analysis/get-page-static-info");
  const matchers = getMiddlewareMatchers([source], { i18n: undefined, basePath: "", skipMiddlewareUrlNormalize: false });
  const runs = (p) => matchers.some((m) => new RegExp(m.regexp).test(p));
  for (const p of ["/api/games/%ff/comments", "/api/games/%E0%A4%A/comments", "/api/games/abc%/score-report", "/api/games/x/%ff"]) assert.equal(runs(p), true, p);
  for (const p of ["/api/games/2026-area-a-at-b/comments", "/api/games/2026-area-a-at-b/score-report", "/api/games/comment-counts", "/api/games/g2/comments"]) assert.equal(runs(p), false, p);
  assert.match(proxy, /startsWith\("\/api\/games\/"\)[\s\S]*hasBadEncoding[\s\S]*status: 400/);
});
