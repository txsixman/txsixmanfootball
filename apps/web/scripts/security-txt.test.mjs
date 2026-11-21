// /.well-known/security.txt (RFC 9116): how a researcher reaches the site about a security problem. A static file in public/.
//   node --test apps/web/scripts/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SITE_URL } from "../lib/site.ts";

const text = readFileSync(new URL("../public/.well-known/security.txt", import.meta.url), "utf8");
const fields = Object.fromEntries(text.trim().split("\n").map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]));

test("it names a contact, a canonical address and a language, and carries no personal name", () => {
  assert.equal(fields.Contact, "mailto:contact@txsixmanfootball.com");
  assert.equal(fields.Canonical, `${SITE_URL}/.well-known/security.txt`);
  assert.equal(fields["Preferred-Languages"], "en");
  assert.ok(text.endsWith("\n"));
});

test("it expires in the future, in the RFC's date form, and is renewed before it does", () => {
  assert.match(fields.Expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  const left = Date.parse(fields.Expires) - Date.now();
  // A file past its date is stale to every scanner: this fails a month before, as the reminder to push Expires out a year.
  assert.ok(left > 30 * 86_400_000, `Expires ${fields.Expires} is within 30 days: renew it`);
  assert.ok(left < 400 * 86_400_000, "Expires is more than a year out (RFC 9116 advises under a year)");
});
