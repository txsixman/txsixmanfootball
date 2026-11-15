import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyUnsubscribe } from "../../apps/web/lib/email/unsubscribe.ts";
import { buildGameAlert } from "./message.mjs";

const SECRET = "k".repeat(40);
const ORIGIN = "https://txsixmanfootball.com";
const row = (over) => ({
  user_id: "bbbbbbbb-0000-4000-8000-000000000001", email: "fan@example.test", alert: "final", event_key: "2026-11-13|alpha|beta",
  home_slug: "alpha", away_slug: "beta", home_name: "Alpha", away_name: "Beta", round: "area", home_score: 40, away_score: 14,
  kickoff_at: null, followed_slug: "alpha", ...over,
});
const all = () => [
  buildGameAlert(row(), { origin: ORIGIN, secret: SECRET }),
  buildGameAlert(row({ alert: "kickoff", kickoff_at: "2026-11-14T01:30:00Z", home_score: null, away_score: null }), { origin: ORIGIN, secret: SECRET }),
  buildGameAlert(row({ alert: "next_game", round: "regional", home_score: null, away_score: null }), { origin: ORIGIN, secret: SECRET }),
];

test("a final, a kickoff and a next game each say what happened, plainly", () => {
  const [final, kickoff, next] = all();
  assert.equal(final.subject, "Final: Beta 14, Alpha 40");
  assert.match(final.text, /^Final score: Beta 14, Alpha 40\./);
  assert.equal(kickoff.subject, "Kickoff: Beta vs Alpha");
  assert.match(kickoff.text, /kicked off at 7:30 PM Central/);
  assert.equal(next.subject, "Next game set: Beta vs Alpha");
  assert.match(next.text, /^Regional game: Beta vs Alpha\./);
  assert.match(final.text, /Alpha on TX Six-Man Football: https:\/\/txsixmanfootball\.com\/programs\/alpha/);
});

test("every email carries RFC 8058 headers, and its links verify for that fan and only the game-alert kind", () => {
  for (const m of all()) {
    assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    const href = /^<(https:\/\/[^>]+)>$/.exec(m.headers["List-Unsubscribe"])?.[1];
    assert.ok(href, "an https URL in angle brackets");
    const u = new URL(href);
    assert.equal(u.pathname, "/api/email/unsubscribe");
    assert.deepEqual(verifyUnsubscribe(SECRET, u.searchParams.get("u"), u.searchParams.get("k"), u.searchParams.get("s")), { userId: row().user_id, kind: "game_alerts" });
    assert.equal(verifyUnsubscribe(SECRET, u.searchParams.get("u"), "weekly_digest", u.searchParams.get("s")), null);
    const bodyLink = /Unsubscribe: (\S+)/.exec(m.text)?.[1];
    assert.match(bodyLink, /^https:\/\/txsixmanfootball\.com\/account\/email\/unsubscribe\?u=/);
    assert.ok(m.html.includes("unsubscribe</a>"));
  }
});

test("no address, no source's name, no betting word, and a name cannot break the markup or the headers", () => {
  const BETTING = /\b(spread|spreads|odds|betting|bet|wager|parlay|line|pick|upset)\b/i;
  for (const m of all()) {
    for (const part of [m.subject, m.text, m.html, JSON.stringify(m.headers)]) {
      assert.doesNotMatch(part, /fan@example\.test|@/);
      assert.doesNotMatch(part, /maxpreps|calpreps|(?<!tx)sixmanfootball\.com|hudl|tapps|taiao|uil/i);
    }
    assert.doesNotMatch(m.text.replace("Change it:", ""), BETTING);
  }
  const bad = buildGameAlert(row({ home_name: 'A&B <script>"x"\r\nBcc: x', alert: "next_game" }), { origin: ORIGIN, secret: SECRET });
  assert.doesNotMatch(bad.subject, /[\r\n]/);
  assert.doesNotMatch(bad.html, /<script>/);
  assert.match(bad.html, /A&amp;B &lt;script&gt;/);
  assert.throws(() => buildGameAlert(row({ alert: "marketing" }), { origin: ORIGIN, secret: SECRET }));
});
