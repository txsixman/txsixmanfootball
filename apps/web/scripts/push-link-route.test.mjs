// The push link route (app/api/push/link, ADR 0054, migration 0023) runs as it is against the real migrations on PGlite,
// through route-harness.mjs's PostgREST-like client, as fan-routes.test.mjs does for the other account routes.
//   node --test apps/web/scripts/push-link-route.test.mjs   (needs `npm ci --prefix packages/db` for PGlite)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, test } from "node:test";
import { calls, noInternals, read, request, route, signIn, signOut, sudoRows, useDb } from "./route-harness.mjs";
import { db, fan, newId } from "../../../packages/db/test/posts-helpers.mjs";

const link = await route("push/link");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123:APA91bExample-token_value";
const SUB = { endpoint: ENDPOINT, p256dh: "B".repeat(87), auth: "a".repeat(22) };
const post = (body, opts) => link.POST(request("/api/push/link", { body, ...opts }));

let d;
before(async () => {
  d = await db({ games: false });
  useDb(d);
});
beforeEach(() => {
  process.env.FAN_SIGNIN = "on";
  signOut();
  calls.length = 0;
});

test("a signed-in fan links this browser: the account owns the row, the browser's own follows move onto the account, the answer holds no id", async () => {
  const who = await fan(d, "Linking Fan");
  await sudoRows("insert into push_subscription (endpoint, p256dh, auth, programs) values ($1, $2, $3, $4)", [ENDPOINT, SUB.p256dh, SUB.auth, ["strawn", "gordon"]]);
  signIn(who);
  const r = await read(await post(SUB));
  assert.deepEqual([r.status, r.body], [200, { programs: [] }]);
  assert.equal(r.cache, "no-store, private");
  assert.deepEqual(calls.find((c) => c.fn === "link_push_subscription"), { fn: "link_push_subscription", args: ["p_auth", "p_endpoint", "p_p256dh"] });
  assert.deepEqual(await sudoRows("select user_id, programs from push_subscription where endpoint = $1", [ENDPOINT]), [{ user_id: who, programs: [] }]);
  assert.deepEqual((await sudoRows("select program_slug from follow where user_id = $1 order by 1", [who])).map((x) => x.program_slug), ["gordon", "strawn"]);
  assert.doesNotMatch(r.text, new RegExp(`${who}|fcm|abc123`));
  // Again, as every visit does: the same.
  assert.equal((await post(SUB)).status, 200);
  assert.equal((await sudoRows("select count(*)::int as n from push_subscription where user_id = $1", [who]))[0].n, 1);
});

test("fan accounts off: a bare 404 and nothing asks the database", async () => {
  process.env.FAN_SIGNIN = "off";
  signIn(await fan(d, "Switch Off Push"), { fail: { code: "XX000", message: "must not be called" } });
  assert.equal((await post(SUB)).status, 404);
  assert.deepEqual(calls, []);
});

test("refusals: another site 403, not JSON 415, bad shape 400, signed out 401, no profile 403", async () => {
  assert.equal((await post(SUB, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(SUB, { origin: null })).status, 403);
  assert.equal((await link.POST(request("/api/push/link", { raw: JSON.stringify(SUB), type: "text/plain" }))).status, 415);
  for (const body of [{}, { endpoint: ENDPOINT }, { ...SUB, endpoint: 7 }, { ...SUB, endpoint: `https://fcm.googleapis.com/${"a".repeat(1100)}` }, { ...SUB, p256dh: "x".repeat(121) }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await link.POST(request("/api/push/link", { raw: "{nope" }))).status, 400);
  assert.equal((await post(SUB)).status, 401);
  assert.deepEqual(calls, []);
  signIn(newId());
  const noProfile = await read(await post(SUB));
  assert.deepEqual([noProfile.status, noProfile.body], [403, { error: "finish sign-up" }]);
});

test("an address that is not a browser's push service, or keys of the wrong shape, are 400 from the database's own checks, nothing of it echoed", async () => {
  signIn(await fan(d, "Bad Endpoint Fan"));
  for (const body of [{ ...SUB, endpoint: "https://evil.example.com/push/1" }, { ...SUB, p256dh: "short" }, { ...SUB, auth: "?" }]) {
    const r = await read(await post(body));
    assert.deepEqual([r.status, r.body], [400, { error: "bad request" }]);
    noInternals(r);
    assert.doesNotMatch(r.text, /evil|short/);
  }
});

test("a database failure is 503 with nothing of the error or the endpoint", async () => {
  signIn(await fan(d, "Push Hiccup"), { fail: { code: "57014", message: `statement timeout ${ENDPOINT}` } });
  const r = await read(await post(SUB));
  assert.deepEqual([r.status, r.body], [503, { error: "unavailable" }]);
  noInternals(r);
  assert.doesNotMatch(r.text, /fcm|abc123/);
});

test("sign-out sends this browser's endpoint to unlink_push_subscription before it ends the session, and logs nothing", () => {
  const actions = readFileSync(new URL("../app/sign-in/actions.ts", import.meta.url), "utf8");
  const signOutFn = actions.slice(actions.indexOf("export async function signOut"));
  assert.ok(signOutFn.indexOf('rpc("unlink_push_subscription", { p_endpoint: endpoint })') > 0);
  assert.ok(signOutFn.indexOf("unlink_push_subscription") < signOutFn.indexOf("auth.signOut"), "unlinks first");
  assert.match(signOutFn, /endpoint\.length <= 1024/);
  for (const file of ["../app/sign-in/actions.ts", "../app/api/push/link/route.ts", "../lib/push.ts", "../app/account/sign-out-button.tsx", "../app/programs/follow.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /console\.(log|error|warn|info)/, file);
  }
});
