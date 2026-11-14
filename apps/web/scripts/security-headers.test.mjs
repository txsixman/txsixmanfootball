// The response headers next.config.ts sends: HSTS everywhere, a Content-Security-Policy (reported, not yet enforced) on
// every page but the embed, and no framing of any page but /embed/ (ADR 0023).
//   node --test apps/web/scripts/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../next.config.ts";
import { SUPABASE_URL } from "../lib/supabase-public.ts";

const rules = await config.headers();
/** The headers the rules send for a path on the public host, as Next matches them (":name*" is any rest of the path). */
function headersAt(pathname) {
  const sent = {};
  for (const rule of rules) {
    if (rule.missing?.some((m) => m.type === "host" && m.value === "txsixmanfootball.com")) continue; // the public host has it
    if (!new RegExp(`^${rule.source.replace(/:\w+\*/g, ".*")}$`).test(pathname)) continue;
    for (const h of rule.headers) sent[h.key.toLowerCase()] = [...(sent[h.key.toLowerCase()] ?? []), h.value];
  }
  return sent;
}

const PAGES = ["/", "/scores", "/programs/jayton", "/rankings/how", "/api/follows", "/logos/jayton.png"];
const EMBED = ["/embed/programs/jayton", "/embed/programs/guthrie"];

test("HSTS is on every route, two years, subdomains, no preload", () => {
  for (const p of [...PAGES, ...EMBED, "/sw.js"]) {
    assert.deepEqual(headersAt(p)["strict-transport-security"], ["max-age=63072000; includeSubDomains"], p);
  }
});

test("every page but the embed carries a Content-Security-Policy that allows its own files and the hosted database only", () => {
  for (const p of PAGES) {
    const [policy, ...more] = headersAt(p)["content-security-policy-report-only"] ?? [];
    assert.ok(policy && more.length === 0, p);
    const directive = (name) => policy.split("; ").find((d) => d.startsWith(`${name} `));
    assert.equal(directive("default-src"), "default-src 'self'");
    assert.ok(directive("script-src").includes("'unsafe-inline'"), "Next's inline bootstrap");
    assert.equal(directive("connect-src"), `connect-src 'self' ${new URL(SUPABASE_URL).origin}`);
    assert.ok(directive("img-src").includes("data:") && directive("object-src") === "object-src 'none'");
  }
  assert.equal(headersAt("/embed/programs/jayton")["content-security-policy-report-only"], undefined, "the embed sends its own policy");
});

test("no page can be framed except /embed/, which sends neither framing header", () => {
  for (const p of PAGES) {
    const h = headersAt(p);
    assert.deepEqual(h["x-frame-options"], ["DENY"], p);
    assert.ok(h["content-security-policy"].includes("frame-ancestors 'none'"), p);
  }
  for (const p of EMBED) {
    const h = headersAt(p);
    assert.equal(h["x-frame-options"], undefined, p);
    assert.ok(!(h["content-security-policy"] ?? []).some((v) => v.includes("frame-ancestors")), p);
  }
});
