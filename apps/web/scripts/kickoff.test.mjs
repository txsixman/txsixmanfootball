// A game's kickoff status at fixed clock times (lib/kickoff.ts, ADR 0036): before, during and after kickoff, and with no
// time known. Invented games only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anyInProgress, groupTonight, IN_PROGRESS_MS, kickoffState, kickoffTime, orgRank, pendingNote } from "../lib/kickoff.ts";

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

// Tonight's order (groupTonight), Friday Nov 13, 2026. Kickoffs are in UTC: 6:00 PM CT is 00:00Z on the 14th. Invented ids.
const night = (id, kickoff, state = "later") => ({ id, date: "2026-11-13", state, ...(kickoff ? { kickoff: `2026-11-14T${kickoff}:00Z` } : {}) });
const games = [
  night("late", "02:00"), // 8:00 PM CT
  night("early", "00:00"), // 6:00 PM CT
  night("mid", "01:00"), // 7:00 PM CT
  night("untimed"),
  night("done-early", "00:00", "final"),
  night("done-late", "01:00", "final"),
  night("done-untimed", undefined, "final"),
  night("forfeit", "00:30", "forfeit"),
];
const order = (now) => groupTonight(games, at(now)).map((g) => [g.key, g.label, g.games.map((x) => x.id)]);

test("before any kickoff: Up next by kickoff with no time last, then Final latest first with no time last", () => {
  assert.deepEqual(order("2026-11-13T20:00:00Z"), [
    ["up-next", "Up next", ["early", "mid", "late", "untimed"]],
    ["final", "Final", ["done-late", "forfeit", "done-early", "done-untimed"]],
  ]);
});

test("once kickoffs pass: In progress first by kickoff, then Up next, then Final", () => {
  assert.deepEqual(order("2026-11-14T01:30:00Z"), [ // 7:30 PM CT
    ["in-progress", "In progress", ["early", "mid"]],
    ["up-next", "Up next", ["late", "untimed"]],
    ["final", "Final", ["done-late", "forfeit", "done-early", "done-untimed"]],
  ]);
});

test("a game with a final is Final whatever the clock says; an empty group is left out", () => {
  const only = [night("a", "00:00", "final"), night("b", "01:00", "forfeit")];
  assert.deepEqual(groupTonight(only, at("2026-11-14T00:30:00Z")).map((g) => g.key), ["final"]); // inside both kickoff windows
  assert.deepEqual(groupTonight([], at("2026-11-14T00:30:00Z")), []);
});

test("past the window with no score a game is not Final: it goes last, under Score not reported yet; so does a no-time game after its day", () => {
  assert.deepEqual(order("2026-11-14T04:30:00Z"), [ // 10:30 PM CT: early (4h30m) is out of its window, mid (3h30m) is not
    ["in-progress", "In progress", ["mid", "late"]],
    ["up-next", "Up next", ["untimed"]],
    ["final", "Final", ["done-late", "forfeit", "done-early", "done-untimed"]],
    ["awaiting", "Score not reported yet", ["early"]],
  ]);
  assert.deepEqual(groupTonight([night("untimed")], at("2026-11-14T06:00:00Z")).map((g) => g.key), ["awaiting"]); // after midnight Central
});

test("with no clock (the server render) every game with no final is Up next", () => {
  assert.deepEqual(groupTonight(games, null).map((g) => [g.key, g.games.length]), [["up-next", 4], ["final", 4]]);
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

// What a game page says where its live score goes while it has none (ADR 0087): never blank, never a guess, no winner.
test("the note in the score's place: not started, in progress with no score, no score reported, or no time listed", () => {
  const note = (g, now) => pendingNote(g, now === null ? null : at(now));
  assert.deepEqual(note(game, null), { title: "Not started", detail: "Kickoff 7:00 PM CT. Score shows here once it starts." }, "the server and the first render read as before kickoff");
  assert.equal(note(game, "2026-11-14T00:59:00Z").title, "Not started");
  assert.deepEqual(note(game, "2026-11-14T01:00:00Z"), { title: "In progress", detail: "No live score yet. This page checks every minute." });
  assert.equal(note(game, "2026-11-14T04:59:00Z").title, "In progress");
  assert.deepEqual(note(game, "2026-11-14T05:00:00Z"), { title: "Score not reported yet", detail: "Kickoff was 7:00 PM CT. No score has come in. Reload later to check." });
  const noTime = { date: "2026-11-13" };
  assert.deepEqual(note(noTime, null), { title: "Kickoff time not listed", detail: "A live score shows here once the game is under way." });
  assert.equal(note(noTime, "2026-11-13T20:00:00Z").title, "Kickoff time not listed");
  assert.deepEqual(note(noTime, "2026-11-14T06:00:00Z"), { title: "Score not reported yet", detail: "No score has come in. Reload later to check." });
  assert.equal(pendingNote({ date: "2026-11-13", kickoff: "not a time" }, null).title, "Kickoff time not listed");
  // Plain words only: no winner, no betting word, no source.
  for (const n of [note(game, null), note(game, "2026-11-14T01:30:00Z"), note(game, "2026-11-14T06:00:00Z"), note(noTime, null)]) {
    assert.doesNotMatch(`${n.title} ${n.detail}`, NAMES_A_WINNER);
    assert.doesNotMatch(`${n.title} ${n.detail}`, BETTING);
  }
});

test("organizations with a game in progress are listed before those with games to come, and those before finals only", () => {
  const key = (...keys) => keys.map((k) => ({ key: k }));
  assert.equal(orgRank(key("in-progress", "final")), 0);
  assert.equal(orgRank(key("up-next", "final")), 1);
  assert.equal(orgRank(key("awaiting", "final")), 2);
  assert.equal(orgRank(key("final")), 3);
  assert.equal(orgRank([]), 9, "an organization with no group sorts last");
  const orgs = [["uil", key("final")], ["tapps", key("up-next")], ["taiao", key("in-progress")], ["tcaf", key("up-next")]];
  const order = [...orgs].sort((a, b) => orgRank(a[1]) - orgRank(b[1])).map((o) => o[0]);
  assert.deepEqual(order, ["taiao", "tapps", "tcaf", "uil"], "ties keep the site's order");
  // With no clock (the server render) a game with no final is up next, so the first paint is the same everywhere.
  const first = [{ state: "later", date: "2026-11-13", kickoff: game.kickoff }, { state: "final", date: "2026-11-13" }];
  assert.equal(orgRank(groupTonight(first, null)), 1);
});
