// "Scores checked N min ago" at fixed clock times (lib/scores-checked.ts, ADR 0038). Invented games only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BEHIND_AFTER_MS, checkedLine, fetchReadAt, gameDay } from "../lib/scores-checked.ts";

// Friday Nov 13, 2026: first kickoff 5:30 PM Central is 23:30 UTC.
const KICKOFF = Date.parse("2026-11-13T23:30:00Z");
const MIN = 60_000;
const games = [
  { date: "2026-11-13", kickoff: "2026-11-14T01:00:00Z", state: "later" },
  { date: "2026-11-13", kickoff: "2026-11-13T23:30:00Z", state: "later" },
  { date: "2026-11-14", kickoff: "2026-11-14T19:00:00Z", state: "later" },
  { date: "2026-11-13", state: "later" },
  {},
];
const line = (now, readAt, list = games) => {
  const day = gameDay(list, now);
  return day && checkedLine(day, readAt, now);
};

test("a page with no game on the game night asks for and shows nothing", () => {
  assert.equal(gameDay(games, Date.parse("2026-11-12T20:00:00Z")), null);
  assert.equal(gameDay([{ state: "later" }, { date: "2026-11-14", kickoff: "2026-11-14T19:00:00Z" }], KICKOFF), null);
  assert.equal(gameDay([], KICKOFF), null);
  // A game that ends after midnight is still on its night until 6 AM Central.
  const friday = games.filter((g) => g.date === "2026-11-13");
  assert.notEqual(gameDay(friday, Date.parse("2026-11-14T10:00:00Z")), null); // 4:00 AM Central, Saturday
  assert.equal(gameDay(friday, Date.parse("2026-11-14T12:00:00Z")), null); // 6:00 AM Central: Saturday's night, not Friday's
});

test("nothing before the first kickoff, whatever the last read says", () => {
  for (const now of [KICKOFF - 5 * 3600_000, KICKOFF - 1]) {
    assert.equal(gameDay(games, now).started, false);
    assert.equal(line(now, now - 10 * MIN), null);
    assert.equal(line(now, null), null);
  }
  assert.equal(gameDay(games, KICKOFF).started, true);
});

test("1 to 59 minutes: Scores checked N min ago; under a minute: just now", () => {
  const now = KICKOFF + 20 * MIN;
  assert.equal(line(now, now - 30_000), "Scores checked just now");
  assert.equal(line(now, now - 59_999), "Scores checked just now");
  assert.equal(line(now, now - MIN), "Scores checked 1 min ago");
  assert.equal(line(now, now - 4 * MIN - 30_000), "Scores checked 4 min ago");
  assert.equal(line(now, now - 59 * MIN - 59_000), "Scores checked 59 min ago");
  // A read a little ahead of this device's clock is just now, never a negative.
  assert.equal(line(now, now + 2 * MIN), "Scores checked just now");
});

test("60 minutes or more: Scores checked at 8:42 PM CT, in Central time", () => {
  const now = Date.parse("2026-11-14T03:00:00Z"); // 9:00 PM Central
  const read = Date.parse("2026-11-14T02:42:00Z"); // 8:42 PM Central, 18 minutes ago
  assert.equal(line(now, read), "Scores checked 18 min ago");
  assert.equal(line(now + 60 * MIN, read), "Scores checked at 8:42 PM CT");
  assert.equal(line(now + 6 * 3600_000, read), "Scores checked at 8:42 PM CT");
});

test("more than 30 minutes past the first kickoff with no read newer than that: Scores may be behind", () => {
  const edge = KICKOFF + BEHIND_AFTER_MS;
  assert.equal(BEHIND_AFTER_MS, 30 * MIN);
  assert.equal(line(edge, null), null); // exactly 30 minutes is not yet more than 30
  assert.equal(line(edge + 1, null), "Scores may be behind");
  assert.equal(line(edge + 1, edge - 5 * MIN), "Scores may be behind"); // the last read is before the point
  assert.equal(line(edge + 1, edge), "Scores may be behind"); // not newer than it
  assert.equal(line(edge + 1, edge + 1), "Scores checked just now"); // a newer read clears it
  assert.equal(line(edge + 40 * MIN, edge + 20 * MIN), "Scores checked 20 min ago");
  assert.equal(line(KICKOFF + 5 * MIN, null), null); // inside the 30 minutes, no read yet: nothing
});

test("after a final, the day has started even though the played game lists no kickoff", () => {
  const list = [{ date: "2026-11-13", state: "final" }, { date: "2026-11-13", kickoff: "2026-11-14T03:00:00Z", state: "later" }];
  const day = gameDay(list, KICKOFF - 3 * 3600_000);
  assert.equal(day.started, true);
  assert.equal(day.first, Date.parse("2026-11-14T03:00:00Z")); // the next game's kickoff stands in
  assert.equal(checkedLine(day, KICKOFF - 3 * 3600_000 - 5 * MIN, KICKOFF - 3 * 3600_000), "Scores checked 5 min ago");
  // Games with no kickoff at all: no "behind" judgment, and nothing before something has been played.
  assert.equal(gameDay([{ date: "2026-11-13", state: "later" }], KICKOFF).started, false);
  const played = gameDay([{ date: "2026-11-13", state: "final" }], KICKOFF);
  assert.equal(checkedLine(played, null, KICKOFF + 5 * 3600_000), null);
  assert.equal(checkedLine(played, KICKOFF, KICKOFF + 5 * 3600_000), "Scores checked at 5:30 PM CT");
});

test("the lines name no source, winner or betting word", () => {
  const BAD = /\b(maxpreps|source|wins?|won|winner|leads?|leading|spread|odds|lines?|favorite|bet|betting)\b/i;
  const now = KICKOFF + 20 * MIN;
  for (const text of [line(now, now), line(now, now - 5 * MIN), line(now, now - 61 * MIN), line(now + 20 * MIN, null)]) {
    assert.ok(text, "a line for each case");
    assert.doesNotMatch(text, BAD);
  }
});

test("fetchReadAt: a time or null; anything else, or a failed request, throws", async () => {
  const answer = (status, body) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const keep = globalThis.fetch;
  try {
    globalThis.fetch = answer(200, "2026-11-14T02:42:00.123456+00:00");
    assert.equal(await fetchReadAt(undefined, { url: "https://x.test", key: "k" }), Date.parse("2026-11-14T02:42:00.123Z"));
    globalThis.fetch = answer(200, null);
    assert.equal(await fetchReadAt(undefined, { url: "https://x.test", key: "k" }), null);
    for (const [status, body] of [[500, "x"], [200, 12], [200, "yesterday-ish"], [200, { message: "no" }], [200, [1]]]) {
      globalThis.fetch = answer(status, body);
      await assert.rejects(fetchReadAt(undefined, { url: "https://x.test", key: "k" }), /results_read_at/);
    }
  } finally {
    globalThis.fetch = keep;
  }
});
