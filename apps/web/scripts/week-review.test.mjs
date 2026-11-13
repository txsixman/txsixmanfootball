// The week in review's pure rules (lib/week-review.ts): closest games and biggest margins, results furthest from the
// projection, rating movers, and playoff advancement. Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "week-review-"));
const outfile = path.join(tmp, "week-review.mjs");
await build({ entryPoints: [path.join(WEB, "lib/week-review.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { advancement, biggestMargins, closestGames, furthestFromProjection, ratingMovers, weekEnd } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const game = (home, away, homeScore, awayScore, extra = {}) => ({
  id: `2026-10-0${++n}-${away}-at-${home}`, href: `/scores/x${n}`, date: `2026-10-0${n % 7 + 1}`, status: "", home, away, homeScore, awayScore, forfeit: false, ...extra,
});

test("a week ends on the Sunday after its Monday, across a month and a year", () => {
  assert.equal(weekEnd("2026-11-09"), "2026-11-15");
  assert.equal(weekEnd("2026-10-26"), "2026-11-01");
  assert.equal(weekEnd("2025-12-29"), "2026-01-04");
});

test("closest games and biggest margins leave out forfeits and no contests, keep ties, and stop at five", () => {
  const games = [
    game("A", "B", 21, 20), game("C", "D", 40, 0), game("E", "F", 14, 14), game("G", "H", 1, 0, { forfeit: true }), game("I", "J", 0, 0),
    game("K", "L", 35, 7), game("M", "N", 28, 21), game("O", "P", 50, 6), game("Q", "R", 12, 0),
  ];
  assert.deepEqual(closestGames(games).map((g) => g.home), ["E", "A", "M", "Q", "K"]);
  assert.deepEqual(biggestMargins(games).map((g) => g.home), ["O", "C", "K", "Q", "M"]);
  assert.ok(!closestGames(games, 20).some((g) => g.forfeit || g.homeScore + g.awayScore === 0));
  assert.ok(!biggestMargins(games, 20).some((g) => g.forfeit || g.homeScore + g.awayScore === 0));
  assert.deepEqual(closestGames([]), []);
});

test("furthest from the projection: gap is measured on the favorite's side, never names a winner, and skips games with no projection", () => {
  const homeFav = game("Alpha", "Beta", 20, 29); // projected Alpha by 12, finished 9 down: 21 away
  const awayFav = game("Gamma", "Delta", 7, 56); // projected Delta by 20, finished 49 up (counted as 45): 25 away
  const mercy = game("Kilo", "Lima", 3, 70); // projected Lima by 90 ("45+"), finished 67 up: both count as 45, so 0 away
  const close = game("Echo", "Fox", 30, 17); // projected Echo by 13, finished 13 up: 0 away, never listed
  const unrated = game("Gulf", "Hotel", 50, 0);
  const forfeit = game("India", "Juliet", 1, 0, { forfeit: true });
  const before = new Map([
    [homeFav.id, { favorite: "Alpha", margin: 12, winProbability: 0.8 }],
    [awayFav.id, { favorite: "Delta", margin: 20, winProbability: 0.9 }],
    [close.id, { favorite: "Echo", margin: 13, winProbability: 0.8 }],
    [mercy.id, { favorite: "Lima", margin: 90, winProbability: 0.99 }],
    [forfeit.id, { favorite: "India", margin: 5, winProbability: 0.6 }],
  ]);
  const off = furthestFromProjection([homeFav, awayFav, close, mercy, unrated, forfeit], before);
  assert.deepEqual(off.map((o) => [o.game.home, Math.round(o.gap)]), [["Gamma", 25], ["Alpha", 21]]);
  assert.deepEqual(Object.keys(off[0]).sort(), ["game", "gap", "projection"]); // no winner field
  assert.deepEqual(furthestFromProjection([close, mercy], before), []);
  assert.equal(furthestFromProjection([homeFav, awayFav], before, 1).length, 1);
});

test("rating movers: rated at both ends, enough games, biggest first, ties by name, tiny changes are not moves", () => {
  const rows = [
    { team: "Up big", rating: 30, was: 10, rated: 6 },
    { team: "Up small", rating: 12.4, was: 10, rated: 6 },
    { team: "Up tie b", rating: 15, was: 10, rated: 6 },
    { team: "Up tie a", rating: 15, was: 10, rated: 6 },
    { team: "Down", rating: -8, was: 5, rated: 6 },
    { team: "Few games", rating: 90, was: 0, rated: 3 },
    { team: "New", rating: 50, was: null, rated: 6 },
    { team: "Untracked", rating: 50, rated: 6 },
    { team: "Flat", rating: 10.02, was: 10, rated: 6 },
  ];
  const { rises, drops } = ratingMovers(rows, 4);
  assert.deepEqual(rises.map((m) => m.team), ["Up big", "Up tie a", "Up tie b", "Up small"]);
  assert.deepEqual(drops.map((m) => [m.team, m.change]), [["Down", -13]]);
  assert.equal(ratingMovers(rows, 4, 2).rises.length, 2);
  assert.deepEqual(ratingMovers([], 4), { rises: [], drops: [] });
});

test("advancement: a round played this week, and who has a game in a later round, read from the later round's own listing", () => {
  const g = (home, away, date, homeScore) => ({ home, away, date, ...(homeScore == null ? {} : { homeScore }) });
  const bracket = {
    name: "Test Division I",
    league: "TEST",
    rounds: [
      { round: "bi-district", label: "Bi-district", games: [g("A", "B", "2026-11-06", 40), g("C", "D", "2026-11-06", 21), g("E", "F", "2026-10-30", 7)] },
      { round: "area", label: "Area", games: [g("A", "C", "2026-11-13"), g("G", "H", "2026-11-13", 14)] },
      { round: "regional", label: "Regional", games: [] },
    ],
  };
  const week = advancement([bracket], "2026-11-02", "2026-11-08");
  assert.equal(week.length, 1); // area has only a game outside the week and an unplayed one; E-F was the week before
  assert.deepEqual(week[0], {
    bracket: "Test Division I", round: "bi-district", label: "Bi-district", games: 2, last: false,
    wentOn: [{ round: "area", label: "Area", teams: ["A", "C"] }], unlisted: 2,
  });
  // The week of 11/9 to 11/15: the area round has one played game (G-H, an unplayed A-C is not counted), and no regional game is listed.
  const next = advancement([bracket], "2026-11-09", "2026-11-15");
  assert.deepEqual(next.map((a) => [a.round, a.games, a.last, a.wentOn, a.unlisted]), [["area", 1, false, [], 2]]);
  // The last round of a bracket has no later round to look in.
  const final = advancement([{ name: "T", league: "TEST", rounds: [{ round: "final", label: "Final", games: [g("X", "Y", "2026-12-05", 20)] }] }], "2026-12-01", "2026-12-06");
  assert.deepEqual(final.map((a) => [a.last, a.wentOn, a.unlisted]), [[true, [], 2]]);
  assert.deepEqual(advancement([bracket], "2027-01-01", "2027-01-07"), []);
  assert.deepEqual(advancement([], "2026-11-02", "2026-11-08"), []);
});
