// A game's kickoff status at fixed clock times (lib/kickoff.ts, ADR 0036): before, during and after kickoff, and with no
// time known. Invented games only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anyInProgress, IN_PROGRESS_MS, kickoffState, kickoffTime } from "../lib/kickoff.ts";

// Friday Nov 13, 2026, 7:00 PM Central is 01:00 UTC on the 14th.
const game = { date: "2026-11-13", kickoff: "2026-11-14T01:00:00Z" };
const at = (iso) => new Date(iso);
const BETTING = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?)\b/i;
const NAMES_A_WINNER = /\b(won|beat|beats|defeated|wins|winner|leads?|leading)\b/i;

test("the kickoff reads in Central time", () => {
  assert.equal(kickoffTime(game.kickoff), "7:00 PM CT");
  assert.equal(kickoffTime("2026-11-14T19:30:00Z"), "1:30 PM CT"); // a Saturday afternoon game
});

test("before kickoff: Starts 7:00 PM CT", () => {
  for (const now of ["2026-11-13T12:00:00Z", "2026-11-14T00:59:00Z"]) {
    assert.deepEqual(kickoffState(game, at(now)), { kind: "starts", label: "Starts 7:00 PM CT", short: "7:00 PM CT" });
  }
});

test("from kickoff until 4 hours after with no final: In progress", () => {
  for (const now of ["2026-11-14T01:00:00Z", "2026-11-14T03:30:00Z", "2026-11-14T04:59:00Z"]) {
    assert.equal(kickoffState(game, at(now)).kind, "in-progress", now);
    assert.equal(kickoffState(game, at(now)).label, "In progress");
  }
  assert.equal(IN_PROGRESS_MS, 4 * 3600_000);
});

test("more than 4 hours past kickoff with no final: waiting on its score", () => {
  assert.deepEqual(kickoffState(game, at("2026-11-14T05:00:00Z")), { kind: "awaiting", label: "Score not reported yet", short: "No score yet" });
});

test("no time known: Time not listed through the game's day (Central), then waiting on its score", () => {
  const noTime = { date: "2026-11-13" };
  assert.equal(kickoffState(noTime, at("2026-11-12T18:00:00Z")).label, "Time not listed");
  assert.equal(kickoffState(noTime, at("2026-11-14T05:59:00Z")).label, "Time not listed"); // 11:59 PM Central on the 13th
  assert.equal(kickoffState(noTime, at("2026-11-14T06:00:00Z")).label, "Score not reported yet");
  assert.equal(kickoffState({ date: "2026-11-13", kickoff: "not a time" }, at("2026-11-13T18:00:00Z")).label, "Time not listed");
});

test("no status names a winner or uses a betting word", () => {
  const times = ["2026-11-13T12:00:00Z", "2026-11-14T02:00:00Z", "2026-11-14T08:00:00Z"];
  for (const g of [game, { date: "2026-11-13" }]) {
    for (const now of times) {
      const { label, short } = kickoffState(g, at(now));
      for (const text of [label, short]) {
        assert.doesNotMatch(text, BETTING);
        assert.doesNotMatch(text, NAMES_A_WINNER);
      }
    }
  }
});

test("live scores are read from kickoff to 4 hours after, and at no other time", () => {
  assert.equal(anyInProgress([game], at("2026-11-14T00:59:00Z")), false);
  assert.equal(anyInProgress([game], at("2026-11-14T01:00:00Z")), true);
  assert.equal(anyInProgress([game], at("2026-11-14T04:59:00Z")), true);
  assert.equal(anyInProgress([game], at("2026-11-14T05:00:00Z")), false);
  // Its own evening does not count once the kickoff is known: 6:00 PM Central, an hour before kickoff.
  assert.equal(anyInProgress([game], at("2026-11-14T00:00:00Z")), false);
  assert.equal(anyInProgress([], at("2026-11-14T02:00:00Z")), false);
});

test("no kickoff time: live scores are read through the game date's evening, 5:00 PM to midnight Central", () => {
  const noTime = { date: "2026-11-13" };
  assert.equal(anyInProgress([noTime], at("2026-11-13T22:59:00Z")), false); // 4:59 PM Central
  assert.equal(anyInProgress([noTime], at("2026-11-13T23:00:00Z")), true); // 5:00 PM
  assert.equal(anyInProgress([noTime], at("2026-11-14T05:59:00Z")), true); // 11:59 PM
  assert.equal(anyInProgress([noTime], at("2026-11-14T06:00:00Z")), false); // midnight: the next day
  assert.equal(anyInProgress([noTime], at("2026-11-13T15:00:00Z")), false); // 9:00 AM on the day
  assert.equal(anyInProgress([noTime], at("2026-11-12T23:30:00Z")), false); // the evening before
  assert.equal(anyInProgress([{ date: "2026-11-13", kickoff: "not a time" }], at("2026-11-14T02:00:00Z")), true);
  // In daylight time (CDT, UTC-5): 5:00 PM Central is 22:00 UTC.
  assert.equal(anyInProgress([{ date: "2026-09-04" }], at("2026-09-04T21:59:00Z")), false);
  assert.equal(anyInProgress([{ date: "2026-09-04" }], at("2026-09-04T22:00:00Z")), true);
  // One timed game out of its window and one untimed game in its evening: the page reads.
  assert.equal(anyInProgress([game, { date: "2026-11-14" }], at("2026-11-15T00:00:00Z")), true);
});
