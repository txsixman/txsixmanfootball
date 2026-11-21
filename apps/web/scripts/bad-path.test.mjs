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

test("the proxy matches /api/games/... and answers 400 before anything else there", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.ok(proxy.includes('"/api/games/:path*"'));
  assert.match(proxy, /startsWith\("\/api\/games\/"\)[\s\S]*hasBadEncoding[\s\S]*status: 400/);
});
