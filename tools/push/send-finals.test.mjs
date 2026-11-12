import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../../packages/db/load.mjs";
import { allowedEndpoint, message, newFinals, sendAll } from "./send-finals.mjs";

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
});

test("web-push provides what the sender and the key setup call (named exports, no default)", async () => {
  const webpush = await import("web-push");
  for (const name of ["generateVAPIDKeys", "setVapidDetails", "sendNotification"]) assert.equal(typeof webpush[name], "function", name);
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  assert.match(publicKey, /^[A-Za-z0-9_-]{87}$/);
  assert.match(privateKey, /^[A-Za-z0-9_-]{43}$/);
});
