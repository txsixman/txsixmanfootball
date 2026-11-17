// A season in review's pure rules (lib/season-review.ts, ADR 0099): totals, records, streaks, close playoff games, risers.
// Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "season-review-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const { bestRecords, biggestRisers, closestPlayoffGames, roundName, seasonStreaks, seasonTotals } = await load("season-review");
const { teamSequences } = await load("week-recap");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
let day = 0;
const game = (home, away, homeScore, awayScore, extra = {}) => ({
  id: `g${++n}`, href: `/scores/g${n}`, date: `2026-09-${String(10 + day++).padStart(2, "0")}`, status: "", home, away, homeScore, awayScore, forfeit: false, season: 2026, ...extra,
});
const all = () => true;
const sequences = (games, disputed = new Set()) => teamSequences(games, disputed);

test("totals: games, forfeits, and the average margin of played games only", () => {
  const t = seasonTotals([
    { homeScore: 40, awayScore: 10, forfeit: false },
    { homeScore: 20, awayScore: 14, forfeit: false },
    { homeScore: 1, awayScore: 0, forfeit: true },
    { homeScore: 0, awayScore: 0, forfeit: false },
  ]);
  assert.deepEqual(t, { games: 4, forfeits: 1, played: 2, averageMargin: 18 });
  assert.deepEqual(seasonTotals([{ homeScore: 1, awayScore: 0, forfeit: true }]), { games: 1, forfeits: 1, played: 0 });
  assert.deepEqual(seasonTotals([]), { games: 0, forfeits: 0, played: 0 });
});

/** A plays `wins` wins then `lost` losses against fresh opponents, each opponent also in the file once. */
const schedule = (team, results) => results.map(([us, them], i) => (i % 2 ? game(team, `${team}-opp${i}`, us, them) : game(`${team}-opp${i}`, team, them, us)));

test("best records: unbeaten teams, share of games won, a short schedule and a disputed final left out", () => {
  const games = [
    ...schedule("Alpha", Array(7).fill([40, 7])), // 7-0
    ...schedule("Bravo", [...Array(6).fill([30, 6]), [14, 14]]), // 6-0-1: unbeaten with a tie
    ...schedule("Charlie", [...Array(7).fill([21, 6]), [0, 21]]), // 7-1
    ...schedule("Delta", Array(5).fill([40, 0])), // 5 games: too short
  ];
  const { unbeaten, best } = bestRecords(sequences(games), (t) => !t.includes("opp"));
  assert.deepEqual(unbeaten.map((r) => r.team), ["Alpha", "Bravo"]);
  assert.deepEqual(best.map((r) => [r.team, r.won, r.lost, r.tied]), [["Alpha", 7, 0, 0], ["Bravo", 6, 0, 1], ["Charlie", 7, 1, 0]]);

  // The same schedule with one Alpha game disputed: Alpha is no longer claimed unbeaten, and has no place in the list.
  const disputed = new Set([games[2].id]);
  const again = bestRecords(sequences(games, disputed), (t) => !t.includes("opp"));
  assert.deepEqual(again.unbeaten.map((r) => r.team), ["Bravo"]);
  assert.ok(!again.best.some((r) => r.team === "Alpha"));
});

test("best records keep every team tied at the end of the list, to ten", () => {
  const games = [];
  for (const t of "ABCDEFGH") games.push(...schedule(`T${t}`, Array(6).fill([21, 7])));
  const { best, unbeaten } = bestRecords(sequences(games), (t) => t.startsWith("T") && t.length === 2);
  assert.equal(unbeaten.length, 8);
  assert.equal(best.length, 8); // five shown, three tied with the fifth
  const eleven = [];
  for (const t of "ABCDEFGHIJKL") eleven.push(...schedule(`T${t}`, Array(6).fill([21, 7])));
  assert.equal(bestRecords(sequences(eleven), (t) => t.startsWith("T") && t.length === 2).best.length, 10);
});

test("streaks: the longest run inside the season, five or more, a tie or loss ends it, open when it reaches the last game", () => {
  const games = [
    ...schedule("Alpha", [...Array(6).fill([30, 0]), [0, 7], ...Array(5).fill([30, 0])]), // 6, a loss, then 5 and open
    ...schedule("Bravo", [...Array(4).fill([30, 0]), [7, 7], ...Array(2).fill([30, 0])]), // 4, a tie: no streak
    ...schedule("Charlie", [...Array(8).fill([30, 0]), [0, 7]]), // 8, then a loss: closed
    ...schedule("Delta", Array(8).fill([30, 0])), // 8 and open
  ];
  const rows = seasonStreaks(sequences(games), (t) => !t.includes("opp"));
  assert.deepEqual(rows.map((r) => [r.team, r.length, r.open]), [["Charlie", 8, false], ["Delta", 8, true], ["Alpha", 6, false]]);
  assert.ok(rows.every((r) => r.first && r.last));
  // A forfeit win counts as a win in a run; a disputed final ends it.
  const run = schedule("Echo", Array(5).fill([30, 0]));
  assert.equal(seasonStreaks(sequences(run), (t) => t === "Echo")[0].length, 5);
  assert.equal(seasonStreaks(sequences(run, new Set([run[2].id])), (t) => t === "Echo").length, 0);
  const withForfeit = schedule("Foxtrot", Array(5).fill([30, 0]));
  withForfeit[1] = { ...withForfeit[1], homeScore: 1, awayScore: 0, forfeit: true };
  assert.equal(seasonStreaks(sequences(withForfeit), (t) => t === "Foxtrot")[0].length, 5);
});

const playoff = (round, home, away, homeScore, awayScore, extra = {}) => ({
  league: "UIL", bracket: "UIL Division I", round, date: "2026-11-20", home, away, homeScore, awayScore, forfeit: false, confirmed: true, ...extra,
});

test("close playoff games: one score or less, closest first, State Championship first on a tie, no forfeit, disputed or unplayed game", () => {
  const games = [
    playoff("area", "A", "B", 21, 20),
    playoff("state", "C", "D", 28, 27),
    playoff("semifinal", "E", "F", 40, 14),
    playoff("regional", "G", "H", 30, 22),
    playoff("regional", "I", "J", 14, 14),
    playoff("area", "K", "L", 7, 6, { confirmed: false }),
    playoff("area", "M", "N", 1, 0, { forfeit: true }),
    playoff("area", "O", "P", undefined, undefined),
  ];
  const rows = closestPlayoffGames(games);
  assert.deepEqual(rows.map((r) => [r.game.home, r.margin, r.state]), [["I", 0, false], ["C", 1, true], ["A", 1, false], ["G", 8, false]]);
  assert.deepEqual(closestPlayoffGames(games, 2).map((r) => r.game.home), ["I", "C"]);
  assert.deepEqual(closestPlayoffGames([]), []);
});

test("round names", () => {
  assert.equal(roundName("state"), "State Championship");
  assert.equal(roundName("final"), "State Championship");
  assert.equal(roundName("bi-district"), "Bi-district");
  assert.equal(roundName("round-1"), "First round");
  assert.equal(roundName("odd"), "odd");
});

test("risers: the biggest rise from week 4, only teams with enough rated games at both ends, no 0.0 rise", () => {
  const row = (team, rating, start, rated = 8, startRated = 3) => ({ team, rating, rated, start, startRated });
  const rows = [
    row("Up", 80, 50),
    row("Bigger", 90, 40),
    row("Fell", 30, 60),
    row("Flat", 50.02, 50),
    row("FewAtStart", 100, 10, 8, 2),
    row("FewAtEnd", 100, 10, 3, 3),
    row("Unrated", 100, null, 8, 0),
  ];
  const rises = biggestRisers(rows, 4);
  assert.deepEqual(rises.map((r) => [r.team, r.change]), [["Bigger", 50], ["Up", 30]]);
  assert.equal(biggestRisers(rows, 4, 1).length, 1);
  assert.deepEqual(biggestRisers([], 4), []);
});
