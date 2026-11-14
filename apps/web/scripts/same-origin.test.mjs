// The shared write lock (lib/same-origin.ts): a missing Origin is refused, another site's is refused, this site's is accepted.
//   node --test apps/web/scripts/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSameOriginJson } from "../lib/same-origin.ts";

const JSON_TYPE = "application/json";
const headers = (h) => new Headers(h);

test("no Origin header is refused", () => {
  assert.equal(checkSameOriginJson(headers({ host: "txsixmanfootball.com", "content-type": JSON_TYPE })), "origin");
});

test("another site's Origin is refused, however close the name", () => {
  for (const origin of ["https://evil.example", "null", "https://txsixmanfootball.com.evil.example", "http://txsixmanfootball.com", "https://www.txsixmanfootball.com", "not a url"]) {
    assert.equal(checkSameOriginJson(headers({ host: "txsixmanfootball.com", origin, "content-type": JSON_TYPE })), "origin", origin);
  }
});

test("this site's own Origin with a JSON body is accepted (any case, a charset is fine)", () => {
  assert.equal(checkSameOriginJson(headers({ host: "txsixmanfootball.com", origin: "https://txsixmanfootball.com", "content-type": JSON_TYPE })), "ok");
  assert.equal(checkSameOriginJson(headers({ host: "localhost:3011", origin: "http://localhost:3011", "content-type": "Application/JSON; charset=utf-8" })), "ok");
});

test("this site's Origin without a JSON body is refused as the wrong type", () => {
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", undefined]) {
    assert.equal(checkSameOriginJson(headers({ host: "txsixmanfootball.com", origin: "https://txsixmanfootball.com", ...(type ? { "content-type": type } : {}) })), "type", String(type));
  }
});
