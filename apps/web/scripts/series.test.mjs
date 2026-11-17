// The series pages' rules (lib/series.ts, ADR 0097): which pairs get a page, the address, the record from the first-named side
// and in words, the longest streak, each side's biggest win, merged schools and the State Championships between a pair.
// Invented schools only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_MEETINGS, biggestWins, finalsBetween, longestStreak, mergedPairs, recordAgainst, recordWords, seriesHref, seriesPairs, seriesRecord } from "../lib/series.ts";

const games = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

test("a pair has a page from two games, when both are programs; the pair's slugs are in alphabetical order", () => {
  assert.equal(MIN_MEETINGS, 2);
  const pairs = new Map([
    ["alpha|beta", games(3)],
    ["alpha|gamma", games(2)], // a first rematch is a series
    ["gamma|zeta", games(1)], // one game is not
    ["beta|zeta", games(9)],
    ["alpha|gone", games(5)], // "gone" has no program page (not in today's alignments)
    ["delta|delta", games(4)],
    ["delta|epsilon", games(4)],
  ]);
  const programs = new Set(["alpha", "beta", "gamma", "zeta", "delta", "epsilon"]);
  assert.deepEqual(seriesPairs(pairs, programs), [["alpha", "beta"], ["alpha", "gamma"], ["beta", "zeta"], ["delta", "epsilon"]]);
  assert.deepEqual(seriesPairs(new Map(), programs), []);
});

test("the address is the slugs in alphabetical order whichever way they are given, so a pair has one page", () => {
  assert.equal(seriesHref("jayton", "guthrie"), "/series/guthrie/jayton");
  assert.equal(seriesHref("guthrie", "jayton"), "/series/guthrie/jayton");
  // Every generated pair is already in that order.
  for (const [a, b] of seriesPairs(new Map([["b-school|a-school".split("|").sort().join("|"), games(MIN_MEETINGS)]]), new Set(["a-school", "b-school"]))) assert.equal(seriesHref(b, a), `/series/${a}/${b}`);
});

const g = (home, homeScore, awayScore) => ({ home, homeScore, awayScore });

test("seriesRecord is from the first-named team's side: the higher score wins, equal scores tie, a forfeit counts", () => {
  const played = [
    g("Alpha", 40, 6), // first at home, wins
    g("Beta", 28, 20), // first away, loses
    g("Alpha", 2, 0), // a forfeit recorded 2-0: still a win
    g("Beta", 0, 0), // a tie
    g("Beta", 6, 40), // first away, wins
  ];
  assert.deepEqual(seriesRecord("alpha", played), { won: 3, lost: 1, tied: 1 });
  // The other side's record is the mirror image, and the games add up either way.
  assert.deepEqual(seriesRecord("beta", played), { won: 1, lost: 3, tied: 1 });
});

test("seriesRecord names a school by its slug, so case, apostrophes and spacing never lose it", () => {
  assert.deepEqual(seriesRecord("obrien", [g("O'Brien", 12, 6), g("Knox City", 6, 12)]), { won: 2, lost: 0, tied: 0 });
});

const final = (season, division, champion, runnerUp) => ({ season, conference: "1A", division, champion, runnerUp, championScore: 40, runnerUpScore: 6, scoreNote: "", notes: "" });

test("finalsBetween: the finals the two played each other in, newest first, either way round, merged schools included", () => {
  const finals = [
    final(2010, "I", "Alpha", "Beta"),
    final(2019, "II", "Beta", "Alpha"),
    final(2019, "I", "Gamma", "Alpha"), // not Beta
    final(2015, "I", "Old Beta", "Alpha"), // Old Beta merged into Beta (ADR 0003)
    final(2022, "II", "Alpha", "Alpha-Gamma"),
  ];
  const lineage = [{ predecessor: "Old Beta", successor: "Beta" }];
  assert.deepEqual(finalsBetween(finals, "alpha", "beta", lineage).map((f) => f.season), [2019, 2015, 2010]);
  assert.deepEqual(finalsBetween(finals, "beta", "alpha", lineage).map((f) => f.season), [2019, 2015, 2010]);
  assert.deepEqual(finalsBetween(finals, "alpha", "beta", []).map((f) => f.season), [2019, 2010]);
  assert.deepEqual(finalsBetween(finals, "alpha", "delta", lineage), []);
});

// A played game for the rules below: home and away by name, scores, and the two flags.
const play = (date, home, homeScore, away, awayScore, flags = {}) => ({ date, home, homeScore, away, awayScore, ...flags });

test("seriesRecord leaves a disputed final out: it is listed on the page and never counted", () => {
  const played = [play("2025-10-03", "Alpha", 40, "Beta", 6), play("2026-10-22", "Beta", 20, "Alpha", 14, { disputed: true }), play("2026-11-07", "Beta", 0, "Alpha", 0)];
  assert.deepEqual(seriesRecord("alpha", played), { won: 1, lost: 0, tied: 1 });
  assert.deepEqual(seriesRecord("beta", played), { won: 0, lost: 1, tied: 1 });
});

test("the series in words: the side ahead first, the first-named when level, a tie only when there is one, never a bare 6-3", () => {
  assert.equal(recordWords("Guthrie", "Jayton", { won: 3, lost: 6, tied: 1 }), "Jayton won 6, Guthrie won 3, 1 tie");
  assert.equal(recordWords("Guthrie", "Jayton", { won: 6, lost: 3, tied: 0 }), "Guthrie won 6, Jayton won 3");
  assert.equal(recordWords("Guthrie", "Jayton", { won: 1, lost: 1, tied: 0 }), "Guthrie won 1, Jayton won 1");
  assert.equal(recordWords("Guthrie", "Jayton", { won: 2, lost: 0, tied: 2 }), "Guthrie won 2, Jayton won 0, 2 ties");
  assert.equal(recordAgainst({ won: 5, lost: 2, tied: 0 }), "won 5, lost 2");
  assert.equal(recordAgainst({ won: 2, lost: 0, tied: 1 }), "won 2, lost 0, tied 1");
  for (const text of [recordWords("A", "B", { won: 1, lost: 0, tied: 0 }), recordAgainst({ won: 2, lost: 0, tied: 0 })]) assert.doesNotMatch(text, /\d-\d/);
});

test("longestStreak: a run of wins by one side; a tie, a loss and a disputed final end it; a later run wins a tie in length", () => {
  const run = [
    play("2018-10-01", "Alpha", 40, "Beta", 6), // alpha
    play("2019-10-01", "Beta", 6, "Alpha", 12), // alpha
    play("2020-10-01", "Alpha", 14, "Beta", 14), // tie ends it
    play("2021-10-01", "Beta", 21, "Alpha", 7), // beta
    play("2022-10-01", "Beta", 28, "Alpha", 0), // beta
    play("2023-10-01", "Alpha", 30, "Beta", 7), // alpha ends it
  ];
  const streak = longestStreak("alpha", run);
  assert.deepEqual([streak.who, streak.length, streak.from.date, streak.to.date, streak.current], ["second", 2, "2021-10-01", "2022-10-01", false]); // the later two-run beats the earlier
  assert.equal(longestStreak("beta", run).who, "first", "from the other side the same run is the first-named's");
  // Read oldest first whatever the order given; a run still going at the latest meeting is current.
  const again = longestStreak("alpha", [...run, play("2024-10-01", "Alpha", 21, "Beta", 0), play("2025-10-01", "Beta", 0, "Alpha", 6), play("2026-10-01", "Alpha", 6, "Beta", 0)].reverse());
  assert.deepEqual([again.who, again.length, again.current], ["first", 4, true]); // 2023 to 2026
  // A disputed final names no winner, so it breaks a run, and one win alone is no streak.
  const split = [play("2020-10-01", "Alpha", 7, "Beta", 0), play("2021-10-01", "Alpha", 14, "Beta", 7, { disputed: true }), play("2022-10-01", "Alpha", 21, "Beta", 0)];
  assert.equal(longestStreak("alpha", split), undefined);
  assert.equal(longestStreak("alpha", []), undefined);
  assert.equal(longestStreak("alpha", [play("2020-10-01", "Alpha", 7, "Beta", 0), play("2021-10-01", "Beta", 7, "Alpha", 0)]), undefined);
});

test("longestStreak counts a forfeit as a win, as every record does", () => {
  const played = [play("2020-10-01", "Alpha", 2, "Beta", 0, { forfeit: true }), play("2021-10-01", "Beta", 0, "Alpha", 10)];
  assert.deepEqual([longestStreak("alpha", played).who, longestStreak("alpha", played).length], ["first", 2]);
});

test("biggestWins: each side's biggest margin; a forfeit has none, a disputed final names no winner, ties break on score then date", () => {
  const played = [
    play("2018-10-01", "Alpha", 40, "Beta", 6), // alpha by 34
    play("2019-10-01", "Beta", 50, "Alpha", 0), // beta by 50
    play("2020-10-01", "Alpha", 2, "Beta", 0, { forfeit: true }), // no margin
    play("2021-10-01", "Beta", 70, "Alpha", 0, { disputed: true }), // no winner named
    play("2022-10-01", "Alpha", 45, "Beta", 11), // alpha by 34 again, the higher score
    play("2023-10-01", "Alpha", 30, "Beta", 30), // a tie is nobody's
  ];
  const big = biggestWins("alpha", played);
  assert.equal(big.first.date, "2022-10-01");
  assert.equal(big.second.date, "2019-10-01");
  assert.deepEqual(biggestWins("alpha", [play("2020-10-01", "Alpha", 2, "Beta", 0, { forfeit: true })]), { first: undefined, second: undefined });
  // Equal margin and score: the later game.
  const level = biggestWins("alpha", [play("2018-10-01", "Alpha", 20, "Beta", 0), play("2024-10-01", "Beta", 0, "Alpha", 20)]);
  assert.equal(level.first.date, "2024-10-01");
});

test("mergedPairs: a merged school's old games count under the program it became (ADR 0003), the pair's list oldest first, a merger's own two halves no pair", () => {
  const game = (date) => ({ result: { date } });
  const pairs = new Map([
    ["beta|old-beta", [game("2019-10-01")]], // Old Beta played Beta once: the two halves of one merger
    ["alpha|old-beta", [game("2018-10-05")]],
    ["alpha|beta", [game("2020-10-01"), game("2022-10-01")]],
    ["alpha|gamma", [game("2021-10-01")]],
  ]);
  const merged = mergedPairs(pairs, new Map([["old-beta", "Beta"]]));
  assert.deepEqual([...merged.keys()].sort(), ["alpha|beta", "alpha|gamma"]);
  assert.deepEqual(merged.get("alpha|beta").map((g) => g.result.date), ["2018-10-05", "2020-10-01", "2022-10-01"]);
  // The successor's own pair key stays in alphabetical order whichever side was renamed.
  const renamed = mergedPairs(new Map([["old-zeta|yankee", [game("2018-10-01")]]]), new Map([["old-zeta", "Alpha Zeta"]]));
  assert.deepEqual([...renamed.keys()], ["alpha-zeta|yankee"]);
  // No merger: the input as it was, and the input is never changed.
  assert.deepEqual([...mergedPairs(pairs, new Map()).keys()].sort(), [...pairs.keys()].sort());
  assert.equal(pairs.get("alpha|beta").length, 2);
});
