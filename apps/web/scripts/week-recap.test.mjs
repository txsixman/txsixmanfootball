// The week recap's pure rules (lib/week-recap.ts, ADR 0092): upsets, biggest wins, games within one score, streaks and
// milestones. Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "week-recap-"));
const outfile = path.join(tmp, "week-recap.mjs");
await build({ entryPoints: [path.join(WEB, "lib/week-recap.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { biggestWins, firstLosses, firstPlayoffWins, firstWinsIn, oneScoreGames, streakChanges, teamSequences, upsets } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const none = new Set();
let n = 0;
const game = (home, away, homeScore, awayScore, extra = {}) => ({
  id: `g${++n}`, href: `/scores/g${n}`, date: "2026-10-09", status: "", home, away, homeScore, awayScore, forfeit: false, ...extra,
});

test("one score or less: eight points or fewer, ties kept, closest first, never a forfeit, a no contest or a disputed final", () => {
  const games = [
    game("A", "B", 21, 13), game("C", "D", 20, 13), game("E", "F", 14, 14), game("G", "H", 30, 21), game("I", "J", 1, 0, { forfeit: true }), game("K", "L", 0, 0),
    game("M", "N", 28, 27),
  ];
  const disputed = new Set([games[1].id]);
  assert.deepEqual(oneScoreGames(games, disputed).map((g) => g.home), ["E", "M", "A"]);
  assert.deepEqual(oneScoreGames(games, none, 2).map((g) => g.home), ["E", "M"]);
  assert.deepEqual(oneScoreGames([], none), []);
});

test("biggest wins name the winner and leave out forfeits, ties and disputed finals", () => {
  const games = [game("A", "B", 56, 6), game("C", "D", 7, 49), game("E", "F", 30, 30), game("G", "H", 1, 0, { forfeit: true }), game("I", "J", 70, 0)];
  const wins = biggestWins(games, new Set([games[4].id]));
  assert.deepEqual(wins.map((w) => [w.winner, w.loser, w.margin]), [["A", "B", 50], ["D", "C", 42]]);
  assert.equal(biggestWins(games, none, 1).length, 1);
  assert.equal(biggestWins(games, none)[0].winner, "I");
});

test("an upset is a win by the team the ratings gave the lower chance, under one half, lowest chance first", () => {
  const home = game("Alpha", "Beta", 14, 20); // Beta won, Alpha was the favorite at 80%: Beta had 20%
  const away = game("Gamma", "Delta", 21, 7); // Gamma won as the favorite: no upset
  const longer = game("Echo", "Fox", 35, 7); // the favorite, Echo, won: no upset
  const lower = game("Kilo", "Lima", 6, 12); // Lima won with 3%
  const even = game("Mike", "Nova", 7, 13); // Nova won at 50% (the favorite listed is Mike): no upset
  const forfeit = game("Oak", "Pine", 0, 1, { forfeit: true });
  const tie = game("Reed", "Sand", 14, 14);
  const disputed = game("Tide", "Ursa", 7, 21);
  const unrated = game("Vale", "West", 7, 28);
  const before = new Map([
    [home.id, { favorite: "Alpha", margin: 7, winProbability: 0.8 }],
    [away.id, { favorite: "Gamma", margin: 7, winProbability: 0.7 }],
    [longer.id, { favorite: "Echo", margin: 20, winProbability: 0.95 }],
    [lower.id, { favorite: "Kilo", margin: 25, winProbability: 0.97 }],
    [even.id, { favorite: "Mike", margin: 0, winProbability: 0.5 }],
    [forfeit.id, { favorite: "Oak", margin: 9, winProbability: 0.8 }],
    [tie.id, { favorite: "Reed", margin: 9, winProbability: 0.8 }],
    [disputed.id, { favorite: "Tide", margin: 9, winProbability: 0.8 }],
  ]);
  const found = upsets([home, away, longer, lower, even, forfeit, tie, disputed, unrated], before, new Set([disputed.id]));
  assert.deepEqual(found.map((u) => [u.winner, u.loser, Math.round(u.chance * 100)]), [["Lima", "Kilo", 3], ["Beta", "Alpha", 20]]);
  assert.ok(found.every((u) => u.chance < 0.5));
  assert.deepEqual(upsets([home], new Map(), none), []);
});

/** Games for one team's season, one a week from `start`, each result W or L (or T), from the team's own side. */
function season(team, results, year = 2026, start = "09-04") {
  return results.map((r, i) => {
    const d = new Date(Date.parse(`${year}-${start}T12:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10);
    const [us, them] = r === "W" ? [30, 12] : r === "L" ? [12, 30] : [20, 20];
    return { ...game(team, `Opp${i}-${year}`, us, them, { date: d }), season: year };
  });
}

test("a streak ends at five or more, and reaches a mark at every fifth win", () => {
  const games = [
    ...season("Red", ["W", "W", "W", "W", "W", "W", "L", "W"]), // six wins, then a loss in week 7
    ...season("Blue", ["L", "L", "L", "L", "L", "W", "W"]), // five losses, then a win in week 6
    ...season("Green", ["W", "W", "W", "W", "W", "W", "W"]), // reaches five in week 5
    ...season("Gold", ["W", "W", "W", "W", "T", "W"]), // four wins and a tie: never five
    ...season("Plum", ["W", "W", "W", "W", "W", "W", "W", "W", "W", "W"]), // reaches ten in week 10
  ];
  const sequences = teamSequences(games, none);
  const at = (week) => {
    const monday = new Date(Date.parse("2026-08-31T12:00:00Z") + (week - 1) * 7 * 86_400_000).toISOString().slice(0, 10);
    const sunday = new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    return [monday, sunday];
  };
  const run = (week) => streakChanges(sequences, [...sequences.keys()], [2026], ...at(week)).map((s) => [s.team, s.change, s.kind, s.length]);
  assert.deepEqual(run(5), [["Green", "reached", "win", 5], ["Plum", "reached", "win", 5], ["Red", "reached", "win", 5]]);
  assert.deepEqual(run(7), [["Red", "ended", "win", 6]]);
  assert.deepEqual(run(6), [["Blue", "ended", "loss", 5]]);
  assert.deepEqual(run(10), [["Plum", "reached", "win", 10]]);
  assert.deepEqual(run(2), []);
  assert.deepEqual(run(30), []);
  const ended = streakChanges(sequences, ["Red"], [2026], ...at(7))[0];
  assert.equal(ended.opponent, "Opp6-2026"); // the game that ended it, not the run's last win
  assert.equal(ended.id, sequences.get("Red")[6].id);
});

test("a streak joins seasons, but not across a season with none of the team's games, and a disputed final is never claimed", () => {
  const before = season("Red", ["W", "W", "W", "W"], 2025, "10-03");
  const games = [...before, ...season("Red", ["W", "L"], 2026)];
  const monday = "2026-09-07"; // the week of the second 2026 game; week 1 of 2026 started 2026-08-31
  const joined = streakChanges(teamSequences(games, none), ["Red"], [2025, 2026], monday, "2026-09-13");
  assert.deepEqual(joined.map((s) => [s.change, s.length]), [["ended", 5]]); // four in 2025 and the first of 2026 made five; the loss ended it
  const gap = streakChanges(teamSequences([...before, ...season("Red", ["W", "L"], 2027)], none), ["Red"], [2025, 2026, 2027], "2027-09-07", "2027-09-13");
  assert.deepEqual(gap, []); // 2026 was read and the team had no game in it: the run does not reach 2027
  const sequences = teamSequences([...season("Red", ["W", "W", "W", "W", "W", "W"])], new Set([season("Red", ["W", "W", "W", "W", "W", "W"])[5].id]));
  assert.deepEqual(streakChanges(sequences, ["Red"], [2026], "2026-10-05", "2026-10-11"), []); // the sixth is disputed: the run may be alive
});

test("a first loss needs four or more games with no loss, a played loss, and the week it happened", () => {
  const games = [
    ...season("Red", ["W", "W", "W", "W", "W", "L"]), // five games unbeaten, first loss in week 6
    ...season("Blue", ["W", "W", "W", "L"]), // only three games
    ...season("Green", ["W", "W", "W", "W", "T"]), // a tie is not a loss
    ...season("Gold", ["W", "W", "W", "W", "L", "L"]), // first loss in week 5, not week 6
  ];
  const sequences = teamSequences(games, none);
  const all = [...sequences.keys()];
  assert.deepEqual(firstLosses(sequences, all, 2026, "2026-10-05", "2026-10-11").map((l) => [l.team, l.unbeaten]), [["Red", 5]]);
  assert.deepEqual(firstLosses(sequences, all, 2026, "2026-09-28", "2026-10-04").map((l) => [l.team, l.unbeaten]), [["Gold", 4]]);
  assert.deepEqual(firstLosses(sequences, ["Blue"], 2026, "2026-09-21", "2026-09-27"), []);
  // A loss by forfeit is not claimed.
  const forfeited = teamSequences([...season("Red", ["W", "W", "W", "W"]), { ...game("Red", "Foe", 0, 1, { date: "2026-10-02", forfeit: true }), season: 2026 }], none);
  assert.deepEqual(firstLosses(forfeited, ["Red"], 2026, "2026-09-28", "2026-10-04"), []);
});

test("a first playoff win is the team's earliest win in the data, a renamed school counts under its new name, and a forfeit win counts", () => {
  const p = (round, date, home, away, homeScore, awayScore, extra = {}) => ({ round, date, home, away, homeScore, awayScore, forfeit: false, confirmed: true, ...extra });
  const same = (team) => (team === "Old Name" ? "New Name" : team);
  const all = [
    p("bi-district", "2021-11-12", "Old Name", "Ant", 40, 8), // an earlier win under the old name
    p("bi-district", "2026-11-13", "New Name", "Bee", 50, 6), // not a first for this program
    p("bi-district", "2026-11-13", "Cat", "Dog", 30, 12), // Cat's first
    p("bi-district", "2026-11-13", "Elk", "Fox", 6, 40), // Fox's first
    p("bi-district", "2026-11-13", "Hen", "Ibis", 14, 14), // a tie: no win
    p("bi-district", "2026-11-13", "Jay", "Kite", 0, 1, { forfeit: true }), // a forfeit win: Kite's first, but never claimed
    p("bi-district", "2026-11-13", "Lark", "Moth", 50, 0, { confirmed: false }), // disputed: no winner
    p("area", "2026-11-20", "Cat", "Newt", 7, 3),
    p("bi-district", "2020-11-13", "Owl", "Pig", 1, 0, { forfeit: true }), // an earlier forfeit win: Owl is never a first below
    p("bi-district", "2026-11-13", "Owl", "Quail", 20, 14),
  ];
  const first = firstPlayoffWins(all, same);
  const week = all.filter((g) => g.date === "2026-11-13");
  assert.deepEqual(firstWinsIn(week, first, same).map((w) => w.team).sort(), ["Cat", "Fox"]);
  assert.equal(firstWinsIn(all.filter((g) => g.date === "2026-11-20"), first, same).length, 0); // Cat's second win
  assert.deepEqual(firstWinsIn([], first, same), []);
});
