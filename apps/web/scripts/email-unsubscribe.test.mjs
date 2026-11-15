import assert from "node:assert/strict";
import { test } from "node:test";
import { emailAlertsOn } from "../lib/email/config.ts";
import { unsubscribeToken, unsubscribeUrl } from "../lib/email/unsubscribe.ts";

// The unsubscribe link (ADR 0053): one random token, nothing else. The shape is checked here; the database decides what it matches.
const TOKEN = "cccccccc-0000-4000-8000-000000000001";

test("a link is the address with the token alone, and no address or id", () => {
  const url = new URL(unsubscribeUrl("https://txsixmanfootball.com", TOKEN));
  assert.equal(url.origin + url.pathname, "https://txsixmanfootball.com/api/email/unsubscribe");
  assert.deepEqual([...url.searchParams.entries()], [["t", TOKEN]]);
  assert.equal(unsubscribeUrl("https://x.test", TOKEN, "/account/email/unsubscribe"), `https://x.test/account/email/unsubscribe?t=${TOKEN}`);
  assert.equal(unsubscribeUrl("", TOKEN), `/api/email/unsubscribe?t=${TOKEN}`);
});

test("only a UUID-shaped single string counts as a token; anything else is null without throwing", () => {
  assert.equal(unsubscribeToken(TOKEN), TOKEN);
  assert.equal(unsubscribeToken(TOKEN.toUpperCase()), TOKEN);
  for (const bad of [undefined, null, 5, "", {}, [TOKEN], "not-a-uuid", `${TOKEN}x`, ` ${TOKEN}`, TOKEN.replace(/-/g, ""), "../../x"]) {
    assert.equal(unsubscribeToken(bad), null);
  }
});

test("the site's switch is exactly on", () => {
  assert.equal(emailAlertsOn({ EMAIL_ALERTS: "on" }), true);
  for (const v of [undefined, "", "true", "ON", "1", " on"]) assert.equal(emailAlertsOn({ EMAIL_ALERTS: v }), false);
});
