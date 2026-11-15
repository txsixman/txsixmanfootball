// The Account Center's routes (ADR 0058, migration 0026) run as they are against the real migrations on PGlite, through route-harness.mjs's
// PostgREST-like client, as push-link-route.test.mjs and fan-routes.test.mjs do: the data export, the two push routes the page's script calls,
// and the device label the link route now sets. A handler that sends an argument the SQL does not have fails here (PGRST202).
//   node --test apps/web/scripts/account-center-routes.test.mjs   (needs `npm ci --prefix packages/db` for PGlite)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, test } from "node:test";
import { calls, client, noInternals, read, request, route, rpc, session, signIn, signOut, sudoRows, useDb } from "./route-harness.mjs";
import { KEYS, db, fan, newId } from "../../../packages/db/test/posts-helpers.mjs";

const exportRoute = await route("account/export");
const muteRoute = await route("account/push-mute");
const deviceRoute = await route("account/this-device");
const linkRoute = await route("push/link");

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123:APA91bExample-token_value";
const OTHER_ENDPOINT = "https://fcm.googleapis.com/fcm/send/zzz999:APA91bSomeoneElses-token";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const get = () => exportRoute.GET(request("/api/account/export", { method: "GET" }));
const mute = (body, opts) => muteRoute.POST(request("/api/account/push-mute", { body, ...opts }));
const here = (body, opts) => deviceRoute.POST(request("/api/account/this-device", { body, ...opts }));
const link = (ua, body = { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH }) => {
  const req = request("/api/push/link", { body });
  if (ua !== undefined) req.headers.set("user-agent", ua);
  return linkRoute.POST(req);
};

/** A session whose Supabase user also has an address and providers, as Supabase's real getUser() does. */
const signInAs = (sub, user, opts) => {
  signIn(sub, opts);
  const base = session();
  globalThis.__testSupabase = () => ({ ...base, auth: { getUser: async () => ({ data: { user: { id: sub, ...user } }, error: null }) } });
};

let d;
before(async () => {
  d = await db();
  useDb(d);
});
beforeEach(() => {
  process.env.FAN_SIGNIN = "on";
  process.env.FAN_POSTS = "on";
  signOut();
  globalThis.__testSupabase = () => session();
  calls.length = 0;
});

// --- The data export ---------------------------------------------------------------------------------------------------

test("download my data: a JSON attachment, never cached, with the person's own email and providers added and nothing secret in it", async () => {
  const who = await fan(d, "Export Fan");
  await sudoRows("update game set game_date = current_date - 1 where playoff_round = 'bi-district'");
  signInAs(who, { email: "export.fan@example.test", app_metadata: { provider: "email", providers: ["email", "google"] } });
  assert.equal((await link("Chrome", { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH })).status, 200);
  for (const [fn, args] of [["follow_program", { p_slug: "alpha" }], ["add_comment", { p_game_key: KEYS.regular, p_body: "Good game." }], ["submit_score_report", { p_game_key: KEYS.playoff, p_home: 21, p_away: 14 }]]) {
    assert.equal((await rpc(who, fn, args)).error, null, fn);
  }
  await rpc(who, "email_set_optins", { p_kind: "game_alerts", p_slugs: ["alpha"] });
  const token = (await sudoRows("select token from email_unsubscribe_token where user_id = $1", [who]))[0].token;
  calls.length = 0;
  const res = await get();
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="txsixmanfootball-my-data.json"');
  assert.match(res.headers.get("content-type"), /^application\/json/);
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  assert.deepEqual(calls, [{ fn: "export_my_data", args: [] }]);
  const out = JSON.parse(text);
  assert.deepEqual(out.account.email, "export.fan@example.test");
  assert.deepEqual(out.account.sign_in_providers, ["email", "google"]);
  assert.equal(out.account.display_name, "Export Fan");
  assert.deepEqual(out.follows.map((f) => f.program), ["alpha"]);
  assert.equal(out.devices.length, 1);
  assert.deepEqual(out.comments.map((c) => c.text), ["Good game."]);
  assert.deepEqual(out.score_reports.map((r) => [r.home_score, r.away_score]), [[21, 14]]);
  assert.deepEqual(out.email_settings.map((e) => e.team), ["alpha"]);
  assert.match(out.account.birth_year, /never shown/);
  for (const secret of ["fcm.googleapis.com", "abc123", P256DH, AUTH, token, "Chrome"]) assert.ok(!text.includes(secret), `the file leaks ${secret}`);
});

test("download my data: fan accounts off is a bare 404 that asks nothing; signed out is 401; no profile or a database failure is 503 with nothing of the error", async () => {
  process.env.FAN_SIGNIN = "off";
  signIn(await fan(d, "Export Off"), { fail: { code: "XX000", message: "must not be called" } });
  assert.equal((await get()).status, 404);
  assert.deepEqual(calls, []);
  process.env.FAN_SIGNIN = "on";
  signOut();
  const out = await read(await get());
  assert.deepEqual([out.status, out.body], [401, { error: "sign in" }]);
  assert.equal(out.cache, "no-store, private");
  signIn(newId()); // signed in, sign-up not finished
  assert.equal((await get()).status, 503);
  signIn(await fan(d, "Export Hiccup"), { fail: { code: "57014", message: `statement timeout ${ENDPOINT}` } });
  const r = await read(await get());
  assert.deepEqual([r.status, r.body], [503, { error: "unavailable" }]);
  noInternals(r);
  assert.doesNotMatch(r.text, /fcm|abc123/);
});

// --- Mute a team on this browser ----------------------------------------------------------------------------------------

test("push-mute: this browser's linked row only; the answer is its muted teams; unmuting brings a team back", async () => {
  const who = await fan(d, "Mute Fan");
  const other = await fan(d, "Mute Other");
  signIn(other);
  assert.equal((await link(undefined, { endpoint: OTHER_ENDPOINT, p256dh: P256DH, auth: AUTH })).status, 200);
  signIn(who);
  assert.equal((await link(CHROME_MAC)).status, 200);
  calls.length = 0;
  let r = await read(await mute({ endpoint: ENDPOINT, slug: "strawn", muted: true }));
  assert.deepEqual([r.status, r.body], [200, { muted: ["strawn"] }]);
  assert.equal(r.cache, "no-store, private");
  assert.deepEqual(calls, [{ fn: "set_push_mute", args: ["p_endpoint", "p_muted", "p_slug"] }]);
  r = await read(await mute({ endpoint: ENDPOINT, slug: "abbott", muted: true }));
  assert.deepEqual(r.body, { muted: ["abbott", "strawn"] });
  r = await read(await mute({ endpoint: ENDPOINT, slug: "strawn", muted: false }));
  assert.deepEqual(r.body, { muted: ["abbott"] });
  assert.doesNotMatch(r.text, /fcm|abc123/);
  // Someone else's browser: nothing changes, and the page is told it did not work.
  const theirs = await read(await mute({ endpoint: OTHER_ENDPOINT, slug: "strawn", muted: true }));
  assert.deepEqual([theirs.status, theirs.body], [503, { error: "unavailable" }]);
  assert.deepEqual((await sudoRows("select muted from push_subscription where endpoint = $1", [OTHER_ENDPOINT]))[0].muted, []);
  noInternals(theirs);
});

test("push-mute: fan accounts off 404, another site 403, not JSON 415, bad shape 400, signed out 401, a database failure 503; nothing echoed", async () => {
  const ok = { endpoint: ENDPOINT, slug: "strawn", muted: true };
  process.env.FAN_SIGNIN = "off";
  assert.equal((await mute(ok)).status, 404);
  process.env.FAN_SIGNIN = "on";
  assert.equal((await mute(ok, { origin: "https://evil.example" })).status, 403);
  assert.equal((await mute(ok, { origin: null })).status, 403);
  assert.equal((await muteRoute.POST(request("/api/account/push-mute", { raw: JSON.stringify(ok), type: "text/plain" }))).status, 415);
  const bad = [
    {}, { ...ok, endpoint: "http://fcm.googleapis.com/x" }, { ...ok, endpoint: "not a url" }, { ...ok, endpoint: `https://fcm.googleapis.com/${"a".repeat(1100)}` },
    { ...ok, endpoint: 7 }, { ...ok, slug: "Not A Slug" }, { ...ok, slug: "x".repeat(81) }, { ...ok, slug: "" }, { ...ok, muted: "yes" }, { endpoint: ok.endpoint, slug: ok.slug },
  ];
  for (const body of bad) assert.equal((await mute(body)).status, 400, JSON.stringify(body).slice(0, 70));
  assert.equal((await muteRoute.POST(request("/api/account/push-mute", { raw: "{nope" }))).status, 400);
  assert.deepEqual(calls, []);
  assert.equal((await mute(ok)).status, 401);
  signIn(await fan(d, "Mute Hiccup"), { fail: { code: "57014", message: `statement timeout ${ENDPOINT}` } });
  const r = await read(await mute(ok));
  assert.deepEqual([r.status, r.body], [503, { error: "unavailable" }]);
  noInternals(r);
  assert.doesNotMatch(r.text, /fcm|abc123/);
});

// --- Which device is this browser ---------------------------------------------------------------------------------------

test("this-device: the device id and the muted teams for a linked browser; null and none for one that is not (or is someone else's); no endpoint comes back", async () => {
  const who = await fan(d, "Device Fan");
  const other = await fan(d, "Device Other");
  signIn(other);
  await link(undefined, { endpoint: OTHER_ENDPOINT, p256dh: P256DH, auth: AUTH });
  signIn(who);
  let r = await read(await here({ endpoint: ENDPOINT }));
  assert.deepEqual([r.status, r.body], [200, { id: null, muted: [] }], "not linked yet");
  await link(SAFARI_IPHONE);
  await mute({ endpoint: ENDPOINT, slug: "strawn", muted: true });
  calls.length = 0;
  r = await read(await here({ endpoint: ENDPOINT }));
  const mine = (await rpc(who, "my_devices")).data;
  assert.deepEqual(r.body, { id: mine[0].id, muted: ["strawn"] });
  assert.equal(r.cache, "no-store, private");
  assert.deepEqual(calls.map((c) => c.fn).slice(0, 2), ["this_device", "my_push_mutes"]);
  assert.doesNotMatch(r.text, /fcm|abc123|p256|zzz999/);
  r = await read(await here({ endpoint: OTHER_ENDPOINT }));
  assert.deepEqual(r.body, { id: null, muted: [] }, "another account's browser is not mine");
});

test("this-device: fan accounts off 404, another site 403, not JSON 415, bad shape 400, signed out 401, a database failure 503", async () => {
  process.env.FAN_SIGNIN = "off";
  assert.equal((await here({ endpoint: ENDPOINT })).status, 404);
  process.env.FAN_SIGNIN = "on";
  assert.equal((await here({ endpoint: ENDPOINT }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await deviceRoute.POST(request("/api/account/this-device", { raw: "{}", type: "text/plain" }))).status, 415);
  for (const body of [{}, { endpoint: 5 }, { endpoint: "http://x.test/y" }, { endpoint: `https://fcm.googleapis.com/${"a".repeat(1100)}` }]) {
    assert.equal((await here(body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await here({ endpoint: ENDPOINT })).status, 401);
  signIn(await fan(d, "Device Hiccup"), { fail: { code: "57014", message: `statement timeout ${ENDPOINT}` } });
  const r = await read(await here({ endpoint: ENDPOINT }));
  assert.deepEqual([r.status, r.body], [503, { error: "unavailable" }]);
  assert.doesNotMatch(r.text, /fcm|abc123/);
});

// --- The link route labels the browser ----------------------------------------------------------------------------------

test("linking a browser gives it a short label from the User-Agent; the User-Agent itself is stored nowhere", async () => {
  const who = await fan(d, "Label Fan");
  signIn(who);
  assert.equal((await link(SAFARI_IPHONE)).status, 200);
  assert.deepEqual(calls.map((c) => c.fn), ["link_push_subscription", "label_push_subscription"]);
  assert.deepEqual((await rpc(who, "my_devices")).data.map((x) => x.label), ["Safari on iPhone"]);
  // The next page view, from a different browser string: the label follows; with no User-Agent at all it is "A browser".
  assert.equal((await link(CHROME_MAC)).status, 200);
  assert.deepEqual((await rpc(who, "my_devices")).data.map((x) => x.label), ["Chrome on Mac"]);
  assert.equal((await link(undefined)).status, 200);
  assert.deepEqual((await rpc(who, "my_devices")).data.map((x) => x.label), ["A browser"]);
  for (const ua of [SAFARI_IPHONE, CHROME_MAC]) {
    const everything = JSON.stringify(await sudoRows("select to_jsonb(s) as row from push_subscription s"));
    assert.ok(!everything.includes(ua.slice(0, 20)) && !/Mozilla|AppleWebKit/.test(everything), "no User-Agent text is stored");
  }
});

test("a label that cannot be saved does not undo the link, and nothing of the failure reaches the page", async () => {
  const who = await fan(d, "Label Hiccup");
  const base = client(who);
  const wrapped = (fail) => ({ ...base, rpc: (fn, args) => (fn === "label_push_subscription" ? fail(fn, args) : rpc(who, fn, args)) });
  for (const fail of [() => Promise.reject(new Error(`boom ${ENDPOINT}`)), () => Promise.resolve({ data: null, error: { code: "XX000", message: `broken ${ENDPOINT}` } })]) {
    globalThis.__testSupabase = () => wrapped(fail);
    const r = await read(await link(CHROME_MAC));
    assert.deepEqual([r.status, r.body], [200, { programs: [] }]);
    assert.doesNotMatch(r.text, /boom|broken|fcm/);
  }
  assert.equal((await sudoRows("select count(*)::int as n from push_subscription where user_id = $1", [who]))[0].n, 1);
});

test("the link route and the account routes are in the proxy's matcher, and no route here logs", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.ok(proxy.includes('"/api/account/:path*"'));
  for (const file of ["export", "push-mute", "this-device"]) {
    const src = readFileSync(new URL(`../app/api/account/${file}/route.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /console\./, file);
  }
  const center = readFileSync(new URL("../lib/account/center.ts", import.meta.url), "utf8");
  assert.doesNotMatch(center.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""), /console\./);
});
