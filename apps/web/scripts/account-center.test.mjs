// The Account Center's server module (lib/account/center.ts, ADR 0058): the pure device label, the error mapping, and the shape of every
// answer, with a stand-in for Supabase's client (no database). The database's own rules are tested in packages/db/test/account-center.test.mjs
// and the routes in account-center-routes.test.mjs.   node --test apps/web/scripts/account-center.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeDisplayName, deviceLabel, exportMyData, getAccount, getPushMutes, isCenterError, listDevices, myActivity, removeAllDevices, removeDevice,
  setPushMute, signInProviders, thisDevice,
} from "../lib/account/center.ts";
import { NAME_MESSAGE } from "../lib/auth/sign-up.ts";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.2592.88 Version/16.0 Mobile/15E148 Safari/605.1.15",
  ipadSafari: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadChrome: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  androidEdge: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0",
  samsung: "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0",
  macEdge: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  linuxChrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  chromeOs: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  opera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0",
  androidStock: "Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; SM-T530NU Build/KOT49H) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Safari/534.30",
};

test("a browser is labelled by its name and system, from the User-Agent, and nothing else", () => {
  const expected = {
    iphoneSafari: "Safari on iPhone", iphoneChrome: "Chrome on iPhone", iphoneFirefox: "Firefox on iPhone", iphoneEdge: "Edge on iPhone",
    ipadSafari: "Safari on iPad", ipadChrome: "Chrome on iPad",
    androidChrome: "Chrome on Android", androidFirefox: "Firefox on Android", androidEdge: "Edge on Android", samsung: "Samsung Internet on Android",
    macSafari: "Safari on Mac", macChrome: "Chrome on Mac", macFirefox: "Firefox on Mac", macEdge: "Edge on Mac",
    winChrome: "Chrome on Windows", winEdge: "Edge on Windows", winFirefox: "Firefox on Windows",
    linuxChrome: "Chrome on Linux", linuxFirefox: "Firefox on Linux", chromeOs: "Chrome on ChromeOS",
  };
  for (const [name, label] of Object.entries(expected)) assert.equal(deviceLabel(UA[name]), label, name);
});

test("a browser that is not one of the five is 'A browser'; a known one on an unknown system is just its name", () => {
  for (const ua of [UA.opera, UA.androidStock, "", "curl/8.4.0", "Mozilla/5.0", "<script>alert(1)</script>", "Chromium/126.0 (Linux)", "x".repeat(5000)]) {
    assert.equal(deviceLabel(ua), "A browser", ua.slice(0, 40));
  }
  assert.equal(deviceLabel("Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15"), "Safari");
  assert.equal(deviceLabel("Chrome/126.0.0.0 Safari/537.36"), "Chrome");
  for (const odd of [undefined, null, 42, {}]) assert.equal(deviceLabel(odd), "A browser");
});

test("a label is at most 40 characters of plain text the database accepts, and never holds the User-Agent", () => {
  const accepted = /^[A-Za-z0-9 ,.()+/-]{1,40}$/; // label_push_subscription's rule (migration 0026)
  for (const ua of [...Object.values(UA), "", "x".repeat(100_000), `${UA.winChrome} ${"Edg/1 ".repeat(500)}`]) {
    const label = deviceLabel(ua);
    assert.ok(accepted.test(label), label);
    assert.ok(label.length <= 40);
    assert.ok(!label.includes("Mozilla") && !/\d/.test(label), `no version numbers or UA text: ${label}`);
  }
});

// ---- A stand-in for the request's Supabase client -----------------------------------------------------------------------------

/** Answers each rpc by name from `answers` ({ data } or { error }), and records the calls (name and argument names only). */
const fake = (answers, { user } = {}) => {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args = {}) => {
      calls.push({ fn, args: Object.keys(args) });
      const a = answers[fn];
      if (a instanceof Error) throw a;
      return a?.error ? { data: null, error: a.error } : { data: a?.data ?? null, error: null };
    },
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "no session" } }) },
  };
};
const boom = { error: { code: "XX000", message: "secret internal wording: relation public.profile", details: "secret detail", hint: "secret hint" } };
const clean = (r) => assert.ok(!/secret|XX000|relation|public\./.test(JSON.stringify(r)), `nothing of the database's wording: ${JSON.stringify(r)}`);

test("changeDisplayName checks sign-up's rules before it asks the database, and answers the date the next change opens", async () => {
  const s = fake({ change_display_name: { data: "2026-12-14T10:00:00.123456+00:00" } });
  for (const bad of ["ab", "-Leading", "Has!Punctuation", "x".repeat(25), "", 5, null]) {
    assert.deepEqual(await changeDisplayName(s, bad), { error: "bad_name", message: NAME_MESSAGE }, String(bad));
  }
  assert.deepEqual(await changeDisplayName(s, "Admin"), { error: "bad_name", message: "Pick a different name. That one is reserved." });
  assert.deepEqual(await changeDisplayName(s, "Nazi Fan"), { error: "bad_name", message: "Pick a different name. That one is not allowed." });
  assert.deepEqual(s.calls, [], "nothing reached the database");
  assert.deepEqual(await changeDisplayName(s, "  Wildcat Fan  "), { nextAt: "2026-12-14T10:00:00.123Z" });
  assert.deepEqual(s.calls, [{ fn: "change_display_name", args: ["p_name"] }]);
});

test("a rename's database errors become one of four words, with the date for too_soon, and none of the database's wording", async () => {
  const run = (error) => changeDisplayName(fake({ change_display_name: { error } }), "Wildcat Fan");
  assert.deepEqual(await run({ code: "55000", message: "change_display_name: name_too_soon", details: "2026-12-14 10:00:00.123456+00" }), { error: "too_soon", nextAt: "2026-12-14T10:00:00.123Z" });
  assert.deepEqual(await run({ code: "55000", message: "change_display_name: name_too_soon", details: "2026-12-14 05:00:00-05:00" }), { error: "too_soon", nextAt: "2026-12-14T10:00:00.000Z" });
  assert.deepEqual(await run({ code: "55000", message: "x", details: "not a date" }), { error: "too_soon" });
  assert.deepEqual(await run({ code: "23505", message: "change_display_name: name_taken" }), { error: "taken" });
  assert.deepEqual(await run({ code: "23514", message: "change_display_name: name_reserved" }), { error: "bad_name", message: "Pick a different name. That one is reserved." });
  assert.deepEqual(await run({ code: "23514", message: "change_display_name: name_not_allowed" }), { error: "bad_name", message: "Pick a different name. That one is not allowed." });
  assert.deepEqual(await run({ code: "23514", message: "change_display_name: name_shape" }), { error: "bad_name", message: NAME_MESSAGE });
  for (const e of [boom.error, { code: "42501", message: "change_display_name: banned" }, { code: "PGRST202", message: "secret" }, {}]) {
    const r = await run(e);
    assert.deepEqual(r, { error: "failed" });
    clean(r);
  }
  assert.deepEqual(await changeDisplayName(fake({ change_display_name: { data: "garbage" } }), "Wildcat Fan"), { error: "failed" });
  const dead = fake({ change_display_name: new Error("network down secret") });
  const r = await changeDisplayName(dead, "Wildcat Fan");
  assert.deepEqual(r, { error: "failed" });
  clean(r);
});

test("each read answers plain camel-case data, and any failure or odd shape is { error: 'failed' } with nothing of the error", async () => {
  const when = "2026-11-15T12:00:00+00:00";
  const reads = [
    ["getAccount", (s) => getAccount(s), "my_account", [{ display_name: "Bobcat Fan", joined_at: when, name_changed_at: null, next_name_change_at: null }],
      { displayName: "Bobcat Fan", joinedAt: when, nameChangedAt: null, nextNameChangeAt: null }],
    ["listDevices", (s) => listDevices(s), "my_devices", [{ id: "d1", label: "Chrome on Mac", linked_at: when, last_used_at: when }],
      [{ id: "d1", label: "Chrome on Mac", linkedAt: when, lastUsedAt: when }]],
    ["thisDevice", (s) => thisDevice(s, "https://fcm.googleapis.com/x"), "this_device", "d1", { id: "d1" }],
    ["removeDevice", (s) => removeDevice(s, "d1"), "remove_my_device", null, { ok: true }],
    ["removeAllDevices", (s) => removeAllDevices(s), "remove_all_my_devices", 3, { removed: 3 }],
    ["getPushMutes", (s) => getPushMutes(s, "https://fcm.googleapis.com/x"), "my_push_mutes", ["strawn"], ["strawn"]],
    ["setPushMute", (s) => setPushMute(s, "https://fcm.googleapis.com/x", "strawn", true), "set_push_mute", ["strawn"], ["strawn"]],
    ["myActivity", (s) => myActivity(s, 5), "my_activity", [{ kind: "comment", id: "p1", body_excerpt: "Good game", created_at: when, href: "/scores/x" }],
      [{ kind: "comment", id: "p1", excerpt: "Good game", createdAt: when, href: "/scores/x" }]],
  ];
  for (const [name, run, fn, data, want] of reads) {
    assert.deepEqual(await run(fake({ [fn]: { data } })), want, name);
    const failed = await run(fake({ [fn]: boom }));
    assert.deepEqual(failed, { error: "failed" }, name);
    clean(failed);
    assert.ok(isCenterError(failed));
    assert.ok(!isCenterError(await run(fake({ [fn]: { data } }))), name);
  }
  // Odd shapes from the database are failures, not crashes.
  assert.deepEqual(await listDevices(fake({ my_devices: { data: [{ id: 1 }] } })), { error: "failed" });
  assert.deepEqual(await removeAllDevices(fake({ remove_all_my_devices: { data: -1 } })), { error: "failed" });
  assert.deepEqual(await myActivity(fake({ my_activity: { data: [{ kind: "dm", id: "p", body_excerpt: "", created_at: when, href: null }] } })), { error: "failed" });
  // No profile: null from getAccount, not an error; a browser that is not linked: no id, no mutes.
  assert.equal(await getAccount(fake({ my_account: { data: [] } })), null);
  assert.deepEqual(await thisDevice(fake({ this_device: { data: null } }), "https://fcm.googleapis.com/x"), { id: null });
  assert.deepEqual(await getPushMutes(fake({ my_push_mutes: { data: null } }), "https://fcm.googleapis.com/x"), []);
  assert.deepEqual(await setPushMute(fake({ set_push_mute: { data: null } }), "https://fcm.googleapis.com/x", "strawn", true), { error: "failed" });
});

test("every failed call is logged by function and SQL state only; a rename the fan is told about (too soon, taken, not allowed) is not", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  await listDevices(fake({ my_devices: boom }));
  await setPushMute(fake({ set_push_mute: new Error("network down secret") }), "https://fcm.googleapis.com/x", "strawn", true);
  await changeDisplayName(fake({ change_display_name: { error: { code: "42501", message: "change_display_name: banned" } } }), "Wildcat Fan");
  for (const code of ["55000", "23505", "23514"]) await changeDisplayName(fake({ change_display_name: { error: { code, message: "x" } } }), "Wildcat Fan");
  assert.deepEqual(logged.mock.calls.map((c) => c.arguments), [
    ["account: database call failed", "my_devices", "XX000"],
    ["account: database call failed", "set_push_mute", "unknown"],
    ["account: database call failed", "change_display_name", "42501"],
  ]);
  assert.doesNotMatch(JSON.stringify(logged.mock.calls.map((c) => c.arguments)), /secret|fcm|Wildcat/);
});

test("the calls send the argument names the SQL functions have (p_endpoint, p_slug, p_muted, p_id, p_limit)", async () => {
  const s = fake({ my_activity: { data: [] }, set_push_mute: { data: [] }, remove_my_device: {} });
  await myActivity(s);
  await setPushMute(s, "https://fcm.googleapis.com/x", "strawn", false);
  await removeDevice(s, "d1");
  assert.deepEqual(s.calls, [
    { fn: "my_activity", args: ["p_limit"] },
    { fn: "set_push_mute", args: ["p_endpoint", "p_slug", "p_muted"] },
    { fn: "remove_my_device", args: ["p_id"] },
  ]);
});

test("the export adds the person's own email and sign-in providers to the database's export, and nothing else", async () => {
  const doc = { exported_at: "2026-11-15T12:00:00Z", account: { display_name: "Bobcat Fan", joined_at: "2026-11-01T00:00:00Z", name_changed_at: null, birth_year: "Stored." }, follows: [] };
  const user = { email: "fan@example.test", app_metadata: { provider: "email", providers: ["email", "google"] }, identities: [{ provider: "google" }, { provider: "email" }] };
  const out = await exportMyData(fake({ export_my_data: { data: doc } }), user);
  assert.deepEqual(out.account, { ...doc.account, email: "fan@example.test", sign_in_providers: ["email", "google"] });
  assert.deepEqual(Object.keys(out).sort(), ["account", "exported_at", "follows"]);
  // Without a user passed, Supabase Auth is asked.
  const asked = await exportMyData(fake({ export_my_data: { data: doc } }, { user: { email: "me@example.test", app_metadata: { provider: "google" } } }));
  assert.deepEqual([asked.account.email, asked.account.sign_in_providers], ["me@example.test", ["google"]]);
  assert.deepEqual(await exportMyData(fake({ export_my_data: { data: doc } })), { error: "failed" });
  assert.deepEqual(await exportMyData(fake({ export_my_data: boom }), user), { error: "failed" });
  assert.deepEqual(await exportMyData(fake({ export_my_data: { data: { follows: [] } } }), user), { error: "failed" }, "a document without an account is not an export");
  assert.deepEqual(await exportMyData(fake({ export_my_data: { data: "x" } }), user), { error: "failed" });
});

test("sign-in providers: each once, sorted, plain words only", () => {
  assert.deepEqual(signInProviders({ app_metadata: { provider: "email", providers: ["email", "google"] }, identities: [{ provider: "google" }] }), ["email", "google"]);
  assert.deepEqual(signInProviders({ app_metadata: { providers: ["Not OK!", 5, "github"] } }), ["github"]);
  assert.deepEqual(signInProviders({}), []);
  assert.deepEqual(signInProviders({ app_metadata: null, identities: null }), []);
});
