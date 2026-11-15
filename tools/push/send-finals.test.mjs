import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../../packages/db/load.mjs";
import { allowedEndpoint, message, newFinals, sendAll } from "./send-finals.mjs";

const FAN_A = "33333333-3333-4333-8333-333333333333";
const FAN_B = "44444444-4444-4444-8444-444444444444";

const HEADER = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
const row = (date, home, away, hs, as) => `I,season,${date},${home},${away},false,${hs},${as},unknown,,https://example.com/g,`;
const csv = (...rows) => [HEADER, ...rows].join("\n");

test("a new final is a played game the earlier file lacked, or had with another score", () => {
  const before = csv(row("2026-11-06", "Jayton", "Guthrie", 52, 6), row("2026-11-13", "Strawn", "Gordon", "", ""));
  const after = csv(row("2026-11-06", "Jayton", "Guthrie", 52, 6), row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34));
  assert.deepEqual(newFinals(before, after).map((f) => f.home), ["Strawn", "Abbott"]);
  assert.equal(newFinals(after, after).length, 0);
  assert.equal(newFinals("", csv(row("2026-11-06", "Jayton", "Guthrie", 52, 6))).length, 1);
  const corrected = csv(row("2026-11-06", "Jayton", "Guthrie", 50, 6));
  assert.equal(newFinals(before, corrected).length, 1);
});

test("the alert names the score, not a winner, and links the followed program", () => {
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34)));
  assert.deepEqual(message(finals, ["gordon"]), { title: "Gordon 0, Strawn 45", body: "Final score. Tap for the program page.", url: "/programs/gordon" });
  assert.equal(message(finals, ["strawn", "abbott"]).title, "2 new finals");
  assert.equal(message(finals, ["jayton"]), null);
  for (const m of [message(finals, ["gordon"]), message(finals, ["strawn", "abbott"])]) {
    assert.doesNotMatch(JSON.stringify(m), /\b(win|won|beat|spread|odds|line|bet)s?\b/i);
  }
});

test("pushes go only to the browsers' push services", () => {
  assert.ok(allowedEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(allowedEndpoint("https://web.push.apple.com/QOk"));
  assert.ok(!allowedEndpoint("https://evil.example.com/fcm.googleapis.com"));
  assert.ok(!allowedEndpoint("http://fcm.googleapis.com/x"));
  assert.ok(!allowedEndpoint("not a url"));
});

test("sends one alert per following browser, deletes gone ones, counts failures", async () => {
  const db = new PGlite();
  await migrate(db);
  const sub = (id, programs) => db.query("select push_follow($1, $2, $3, $4)", [`https://fcm.googleapis.com/fcm/send/${id}`, "B".repeat(87), "a".repeat(22), programs]);
  await sub("ok", ["strawn"]);
  await sub("gone", ["gordon"]);
  await sub("down", ["strawn", "gordon"]);
  await sub("other", ["jayton"]);
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0)));
  const sent = [];
  const send = async (s, body) => {
    const id = s.endpoint.split("/").at(-1);
    if (id === "gone") throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (id === "down") throw Object.assign(new Error("server"), { statusCode: 503 });
    sent.push([id, JSON.parse(body).url]);
  };
  const r = await sendAll({ db, send, finals });
  assert.deepEqual(sent, [["ok", "/programs/strawn"]]);
  assert.deepEqual({ ...r, failed: r.failed.length }, { finals: 1, subscriptions: 3, sent: 1, removed: 1, skipped: 0, failed: 1 });
  const left = await db.query("select endpoint from push_subscription order by 1");
  assert.equal(left.rows.length, 3);
  assert.ok(!left.rows.some((x) => x.endpoint.endsWith("/gone")));
  // Only the browser the push service accepted a message for is confirmed (migration 0018).
  const confirmed = await db.query("select endpoint from push_subscription where confirmed_at is not null");
  assert.deepEqual(confirmed.rows.map((x) => x.endpoint.split("/").at(-1)), ["ok"]);
});

// Push alerts tied to the account (migration 0023, ADR 0054): the real migrations, the real SQL, only the push itself is a stub.
async function accountDb() {
  const d = new PGlite();
  await d.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  await migrate(d);
  for (const [id, name] of [[FAN_A, "Fan A"], [FAN_B, "Fan B"]]) await d.query("insert into profile (user_id, display_name, birth_year) values ($1, $2, 1990)", [id, name]);
  return d;
}
const endpointOf = (id) => `https://fcm.googleapis.com/fcm/send/${id}`;
const linkAs = async (d, sub, id) => {
  await d.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  await d.query("select link_push_subscription($1, $2, $3)", [endpointOf(id), "B".repeat(87), "a".repeat(22)]);
};
const followAs = async (d, sub, slugs) => {
  await d.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  for (const slug of slugs) await d.query("select follow_program($1)", [slug]);
};
const recorder = () => {
  const sent = [];
  return { sent, send: async (s, body) => void sent.push([s.endpoint.split("/").at(-1), JSON.parse(body)]) };
};

test("a browser linked to an account is alerted for the account's follows, one alert, whatever else it follows", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn"]); // followed on another device
  await linkAs(d, FAN_A, "laptop"); // a signed-in browser with nothing of its own
  await linkAs(d, FAN_A, "phone"); // a second browser of the same account
  await followAs(d, FAN_B, ["abbott"]);
  await linkAs(d, FAN_B, "other-fan"); // another account, following a program that did not play
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("signed-out"), "B".repeat(87), "a".repeat(22), ["strawn"]]); // as ever
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("elsewhere"), "B".repeat(87), "a".repeat(22), ["jayton"]]);
  const { sent, send } = recorder();
  const r = await sendAll({ db: d, send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0))) });
  assert.deepEqual(sent.map(([id]) => id).sort(), ["laptop", "phone", "signed-out"]);
  assert.ok(sent.every(([, m]) => m.title === "Gordon 0, Strawn 45" && m.url === "/programs/strawn"));
  assert.deepEqual({ ...r, failed: r.failed.length }, { finals: 1, subscriptions: 3, sent: 3, removed: 0, skipped: 0, failed: 0 });
});

test("a program followed both ways, or with two finals, is still one alert to the one browser", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn", "gordon"]);
  await linkAs(d, FAN_A, "laptop");
  // The browser's own list gets the same programs again (a signed-out push_follow on a linked browser, as when the session ended).
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("laptop"), "B".repeat(87), "a".repeat(22), ["strawn", "gordon"]]);
  const { sent, send } = recorder();
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34)));
  const r = await sendAll({ db: d, send, finals });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].title, "Gordon 0, Strawn 45"); // one game involves both followed programs: one line
  assert.equal(r.subscriptions, 1);
});

test("an unfollow on the account stops the alert on every linked browser; a gone linked browser is deleted like any other", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn", "abbott"]);
  await linkAs(d, FAN_A, "laptop");
  await linkAs(d, FAN_A, "gone");
  await d.query("select unfollow_program('strawn')");
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0)));
  const first = recorder();
  await sendAll({ db: d, send: first.send, finals });
  assert.deepEqual(first.sent, []);
  await d.query("select follow_program('strawn')");
  const send = async (s, body) => {
    if (s.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    return recorder().send(s, body);
  };
  const r = await sendAll({ db: d, send, finals });
  assert.deepEqual({ sent: r.sent, removed: r.removed }, { sent: 1, removed: 1 });
  assert.deepEqual((await d.query("select endpoint from push_subscription")).rows.map((x) => x.endpoint.split("/").at(-1)), ["laptop"]);
});

test("before migration 0023 is on the database the sender still alerts, by each browser's own programs, and says so", async () => {
  const d = await accountDb();
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("signed-out"), "B".repeat(87), "a".repeat(22), ["strawn"]]);
  await d.exec("alter table push_subscription drop column user_id cascade");
  const { sent, send } = recorder();
  const r = await sendAll({ db: d, send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0))) });
  assert.deepEqual(sent.map(([id]) => id), ["signed-out"]);
  assert.equal(r.accountLinksSkipped, true);
});

test("a program muted on a browser gets no alert there, whoever follows it; the account's other browsers and the other programs are unaffected (migration 0026)", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn", "abbott"]);
  await linkAs(d, FAN_A, "laptop");
  await linkAs(d, FAN_A, "phone");
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("signed-out"), "B".repeat(87), "a".repeat(22), ["strawn"]]);
  const mute = (id, slugs) => d.query("update push_subscription set muted = $1 where endpoint = $2", [slugs, endpointOf(id)]);
  await mute("laptop", ["strawn"]); // muted on this browser only
  await mute("signed-out", ["strawn"]); // a browser's own program can be muted too
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0)));
  const first = recorder();
  const r = await sendAll({ db: d, send: first.send, finals });
  assert.deepEqual(first.sent.map(([id]) => id), ["phone"]);
  assert.deepEqual({ subscriptions: r.subscriptions, sent: r.sent, skipped: r.skipped, mutesSkipped: r.mutesSkipped }, { subscriptions: 3, sent: 1, skipped: 2, mutesSkipped: undefined });
  // Two finals, one muted: the alert is about the other one only; a muted program mutes nothing else.
  await mute("phone", ["strawn"]);
  const two = recorder();
  await sendAll({ db: d, send: two.send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34))) });
  assert.deepEqual(two.sent.map(([id, m]) => [id, m.title, m.url]).sort(), [
    ["laptop", "Aquilla 34, Abbott 40", "/programs/abbott"],
    ["phone", "Aquilla 34, Abbott 40", "/programs/abbott"],
  ]);
  // Unmuting brings the alert back.
  await mute("laptop", []);
  const three = recorder();
  await sendAll({ db: d, send: three.send, finals });
  assert.deepEqual(three.sent.map(([id]) => id), ["laptop"]);
});

test("before migration 0026 is on the database the sender still alerts, account follows included, with no mutes, and says so", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn"]);
  await linkAs(d, FAN_A, "laptop");
  await d.exec("alter table push_subscription drop column muted");
  const { sent, send } = recorder();
  const r = await sendAll({ db: d, send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0))) });
  assert.deepEqual(sent.map(([id]) => id), ["laptop"]);
  assert.equal(r.mutesSkipped, true);
  assert.equal(r.accountLinksSkipped, undefined);
});

test("web-push provides what the sender and the key setup call (named exports, no default)", async () => {
  const webpush = await import("web-push");
  for (const name of ["generateVAPIDKeys", "setVapidDetails", "sendNotification"]) assert.equal(typeof webpush[name], "function", name);
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  assert.match(publicKey, /^[A-Za-z0-9_-]{87}$/);
  assert.match(privateKey, /^[A-Za-z0-9_-]{43}$/);
});
