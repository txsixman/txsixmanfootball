import assert from "node:assert/strict";
import { test } from "node:test";
import { emailAlertsOn, unsubscribeSecret } from "../lib/email/config.ts";
import { unsubscribeSignature, unsubscribeUrl, verifyUnsubscribe } from "../lib/email/unsubscribe.ts";

// The signed unsubscribe link (ADR 0053): it names an id and a kind, never an address, and only the right signature opens it.
const SECRET = "k".repeat(40);
const USER = "bbbbbbbb-0000-4000-8000-000000000001";

test("a link made by the sender verifies, and carries the id and kind but no address", () => {
  const url = new URL(unsubscribeUrl("https://txsixmanfootball.com", SECRET, USER, "game_alerts"));
  assert.equal(url.origin + url.pathname, "https://txsixmanfootball.com/api/email/unsubscribe");
  assert.deepEqual([...url.searchParams.keys()], ["u", "k", "s"]);
  assert.doesNotMatch(url.href, /@|%40/);
  const q = url.searchParams;
  assert.deepEqual(verifyUnsubscribe(SECRET, q.get("u"), q.get("k"), q.get("s")), { userId: USER, kind: "game_alerts" });
  assert.deepEqual(verifyUnsubscribe(SECRET, USER.toUpperCase(), "game_alerts", q.get("s")), { userId: USER, kind: "game_alerts" });
});

test("any change to the id, the kind or the signature, another secret, or odd input is refused without throwing", () => {
  const s = unsubscribeSignature(SECRET, USER, "game_alerts");
  const other = "bbbbbbbb-0000-4000-8000-000000000002";
  assert.equal(verifyUnsubscribe(SECRET, other, "game_alerts", s), null);
  assert.equal(verifyUnsubscribe(SECRET, USER, "weekly_digest", s), null); // a game-alert link cannot end the digest
  assert.equal(verifyUnsubscribe("j".repeat(40), USER, "game_alerts", s), null);
  assert.equal(verifyUnsubscribe(SECRET, USER, "game_alerts", s.slice(0, -1) + (s.endsWith("A") ? "B" : "A")), null);
  assert.equal(verifyUnsubscribe(SECRET, USER, "game_alerts", s + "x"), null);
  for (const bad of [undefined, null, 5, "", {}, ["a"]]) {
    assert.equal(verifyUnsubscribe(SECRET, bad, "game_alerts", s), null);
    assert.equal(verifyUnsubscribe(SECRET, USER, bad, s), null);
    assert.equal(verifyUnsubscribe(SECRET, USER, "game_alerts", bad), null);
  }
  assert.equal(verifyUnsubscribe(SECRET, "not-a-uuid", "game_alerts", s), null);
});

test("the switch is exactly on, and a short or missing secret closes the links", () => {
  assert.equal(emailAlertsOn({ EMAIL_ALERTS: "on" }), true);
  for (const v of [undefined, "", "true", "ON", "1", " on"]) assert.equal(emailAlertsOn({ EMAIL_ALERTS: v }), false);
  assert.equal(unsubscribeSecret({}), null);
  assert.equal(unsubscribeSecret({ EMAIL_UNSUBSCRIBE_SECRET: "short" }), null);
  assert.equal(unsubscribeSecret({ EMAIL_UNSUBSCRIBE_SECRET: ` ${SECRET} ` }), SECRET);
});
