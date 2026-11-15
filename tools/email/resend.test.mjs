import assert from "node:assert/strict";
import { test } from "node:test";
import { idempotencyKey, RESEND_URL, sendEmail } from "./resend.mjs";

const mail = { apiKey: "re_test", from: "A <a@example.test>", to: "fan@example.test", subject: "s", text: "t", html: "<p>t</p>", headers: { "List-Unsubscribe": "<https://x>" }, key: "k" };
const answer = (status, body = "") => async () => new Response(body, { status });

test("one POST to Resend with the key, the idempotency key and the unsubscribe headers", async () => {
  let seen;
  const r = await sendEmail({ ...mail, fetch: async (url, init) => ((seen = { url, init }), new Response("{}", { status: 200 })) });
  assert.deepEqual(r, { outcome: "sent", status: 200 });
  assert.equal(seen.url, RESEND_URL);
  assert.equal(seen.init.headers.Authorization, "Bearer re_test");
  assert.equal(seen.init.headers["Idempotency-Key"], "k");
  const body = JSON.parse(seen.init.body);
  assert.deepEqual([body.to, body.headers], [["fan@example.test"], { "List-Unsubscribe": "<https://x>" }]);
});

test("each status is a class of outcome, and the service's own text is never returned", async () => {
  const classes = Object.fromEntries(await Promise.all([200, 202, 400, 422, 429, 401, 403, 409, 500, 503].map(async (s) => [s, (await sendEmail({ ...mail, fetch: answer(s, `bad address fan@example.test`) })).outcome])));
  assert.deepEqual(classes, { 200: "sent", 202: "sent", 400: "rejected", 422: "rejected", 429: "slow", 401: "stop", 403: "stop", 409: "retry", 500: "retry", 503: "retry" });
  const r = await sendEmail({ ...mail, fetch: answer(422, "fan@example.test is invalid") });
  assert.doesNotMatch(JSON.stringify(r), /fan@|invalid/);
  assert.deepEqual(await sendEmail({ ...mail, fetch: async () => { throw new Error("connect fan@example.test"); } }), { outcome: "retry", status: 0 });
});

test("the idempotency key is stable, names no one, and differs by user and item", () => {
  const k = idempotencyKey("u1", "game_alerts", "final:x");
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(k, idempotencyKey("u1", "game_alerts", "final:x"));
  assert.notEqual(k, idempotencyKey("u2", "game_alerts", "final:x"));
  assert.notEqual(k, idempotencyKey("u1", "game_alerts", "final:y"));
});
