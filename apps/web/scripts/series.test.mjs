// The series pages' rules (lib/series.ts): which pairs get a page, the address, the record from the first-named side and the
// State Championships between a pair. Invented schools only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_MEETINGS, finalsBetween, seriesHref, seriesPairs, seriesRecord } from "../lib/series.ts";

const games = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

test("a pair has a page from three games, when both are programs; the pair's slugs are in alphabetical order", () => {
  assert.equal(MIN_MEETINGS, 3);
  const pairs = new Map([
    ["alpha|beta", games(3)],
    ["alpha|gamma", games(2)], // two games are not a series
    ["beta|zeta", games(9)],
    ["alpha|gone", games(5)], // "gone" has no program page (not in today's alignments)
    ["delta|delta", games(4)],
    ["delta|epsilon", games(4)],
  ]);
  const programs = new Set(["alpha", "beta", "gamma", "zeta", "delta", "epsilon"]);
  assert.deepEqual(seriesPairs(pairs, programs), [["alpha", "beta"], ["beta", "zeta"], ["delta", "epsilon"]]);
  assert.deepEqual(seriesPairs(new Map(), programs), []);
});

test("the address is the slugs in alphabetical order whichever way they are given, so a pair has one page", () => {
  assert.equal(seriesHref("jayton", "guthrie"), "/series/guthrie/jayton");
  assert.equal(seriesHref("guthrie", "jayton"), "/series/guthrie/jayton");
  // Every generated pair is already in that order.
  for (const [a, b] of seriesPairs(new Map([["b-school|a-school".split("|").sort().join("|"), games(3)]]), new Set(["a-school", "b-school"]))) assert.equal(seriesHref(b, a), `/series/${a}/${b}`);
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
