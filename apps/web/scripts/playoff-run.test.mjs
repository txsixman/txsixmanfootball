// The playoff run's pure logic (lib/playoff-status.ts, lib/playoff-path.ts): a game's status line, the round shown first,
// the next pairing (a team's opponents ahead are in road.test.mjs). Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "playoff-run-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const { gameStatus, centralClock, currentRound } = await load("playoff-status");
const { pairsOf, previewOf, gamesOf } = await load("playoff-path");
const { project, projectAt, fieldOf } = await load("projection");
const { chancesFor } = await load("title-chances");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const TODAY = "2026-11-13";
const g = (date, extra = {}) => ({ date, forfeit: false, confirmed: false, ...extra });

test("status: a robot score is reported and unconfirmed, a game with no score is not yet played, tonight or awaiting", () => {
  assert.deepEqual(gameStatus(g("2026-11-14"), TODAY), { kind: "scheduled", label: "Not yet played", unconfirmed: false });
  assert.deepEqual(gameStatus(g(TODAY), TODAY), { kind: "tonight", label: "Tonight, no score yet", unconfirmed: false });
  assert.deepEqual(gameStatus(g("2026-11-12"), TODAY), { kind: "awaiting", label: "Score not reported yet", unconfirmed: false });
  assert.deepEqual(gameStatus(g(TODAY, { homeScore: 40 }), TODAY), { kind: "reported", label: "Reported tonight", unconfirmed: true });
  assert.deepEqual(gameStatus(g("2026-11-06", { homeScore: 40 }), TODAY), { kind: "reported", label: "Score reported", unconfirmed: true });
  assert.deepEqual(gameStatus(g("2026-11-06", { homeScore: 40, confirmed: true }), TODAY), { kind: "final", label: "Final", unconfirmed: false });
  // A forfeit is the word, with or without a score, and is never marked as a score.
  assert.deepEqual(gameStatus(g("2026-11-06", { homeScore: 1, forfeit: true }), TODAY), { kind: "forfeit", label: "Forfeit", unconfirmed: false });
});

test("central clock: the date and time are Central's, not UTC's", () => {
  // 2:30 AM UTC on Nov 14 is 8:30 PM on Friday Nov 13 in Central (CST).
  assert.deepEqual(centralClock(new Date("2026-11-14T02:30:00Z")), { date: "2026-11-13", label: "Fri, Nov 13, 8:30 PM CT" });
});

test("the round shown first: today's, else the next with games to play, else the last", () => {
  const r = (round, ...games) => ({ round, games: games.map(([date, homeScore]) => ({ date, homeScore })) });
  const rounds = [r("bi-district", ["2026-11-06", 40], ["2026-11-06", undefined]), r("area", ["2026-11-20"]), r("regional", ["2026-11-27"])];
  assert.equal(currentRound(rounds, "2026-11-06").round, "bi-district"); // a game today wins
  assert.equal(currentRound(rounds, "2026-11-13").round, "area"); // a stray unplayed old game does not pull it back
  assert.equal(currentRound([r("bi-district", ["2026-11-06", 40])], TODAY).round, "bi-district"); // all played: the last round
  assert.equal(currentRound([], TODAY), undefined);
});

// Invented teams: A..H, rated 8, 6, 4, 2, 0, -2, -4, -6 points; a table with no calibration uses the normal chance at sigma.
const table = {
  games: 100, home_field: 4, sigma: 20, playoff_edge: 0,
  teams: [..."ABCDEFGH"].map((team, i) => ({ team, rating: 8 - 2 * i, rated: 9, won: 5, lost: 4, tied: 0 })),
};
const game = (round, home, away, extra = {}) => ({ league: "TAPPS", bracket: "B", round, date: "2026-11-20", home, away, forfeit: false, neutral: true, confirmed: false, ...extra });
const rounds = (...list) => list.map(([round, ...games]) => ({ round, label: round, games }));

test("two unplayed semifinals pair up, and not once a final is listed or a semifinal is played", () => {
  const semis = [game("semifinal", "A", "D"), game("semifinal", "B", "C")];
  const pairs = pairsOf(rounds(["semifinal", ...semis]));
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].next, "final");
  assert.deepEqual(pairsOf(rounds(["semifinal", ...semis], ["final", game("final", "A", "B")])), []);
  assert.deepEqual(pairsOf(rounds(["semifinal", game("semifinal", "A", "D", { homeScore: 30, awayScore: 6 }), semis[1]])), []);
  assert.deepEqual(pairsOf(rounds(["semifinal", semis[0]])), []); // one semifinal alone settles nothing
});

test("area games pair only inside one region, and only two to a region", () => {
  const region = (t) => ({ A: "1", B: "1", C: "1", D: "1", E: "2", F: "2", G: "1", H: "2" })[t];
  const [a1, a2] = [game("area", "A", "D"), game("area", "B", "C")];
  const pairs = pairsOf(rounds(["area", a1, a2, game("area", "E", "F")]), region);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].region, "1");
  assert.equal(pairs[0].next, "regional");
  assert.deepEqual(pairsOf(rounds(["area", a1, a2]), undefined), []); // no region data: no pairing is guessed
  assert.deepEqual(pairsOf(rounds(["area", a1, game("area", "E", "G")]), region), []); // a game linking regions
});

test("the pairing preview takes the higher-rated side of each game", () => {
  const [pair] = pairsOf(rounds(["semifinal", game("semifinal", "D", "A"), game("semifinal", "C", "B")]));
  const preview = previewOf(table, pair);
  assert.deepEqual(preview.sides.map((s) => s.team), ["A", "B"]);
  assert.ok(preview.sides.every((s) => s.reach > 0.5 && s.reach < 1));
  assert.equal(preview.projection.favorite, "A");
});

test("a team's games in a bracket, in round order", () => {
  const list = rounds(["quarterfinal", game("quarterfinal", "A", "H", { homeScore: 50, awayScore: 0 }), game("quarterfinal", "B", "G")], ["semifinal", game("semifinal", "C", "A")]);
  assert.deepEqual(gamesOf(list, "A").map((s) => [s.round, s.opponent, s.home]), [["quarterfinal", "H", true], ["semifinal", "C", false]]);
  assert.deepEqual(gamesOf(list, "Z"), []);
});

test("a row's neutral value reads one way on every page: \"true\" no edge, \"false\" the home field, \"\" the playoff share", () => {
  assert.deepEqual(fieldOf("true"), { neutral: true, trueNeutral: true });
  assert.deepEqual(fieldOf("false"), { neutral: false });
  assert.deepEqual(fieldOf(""), { neutral: true });
  const edged = { ...table, playoff_edge: 1 };
  const at = (neutral) => projectAt(edged, { home: "D", away: "C", ...fieldOf(neutral) });
  assert.deepEqual(at("true"), project(edged, "D", "C", true, true)); // what /scores shows for the same row
  assert.equal(at("true").favorite, "C"); // C (+4) over D (+2), no edge
  assert.equal(at("").favorite, "D"); // the listed home team's playoff share of 4 points
  assert.equal(at("false").margin, at("").margin); // the whole share at playoff_edge 1
  // The bracket's pairing preview reads the game's site the same way (it gave a true neutral site the playoff share).
  const [pair] = pairsOf(rounds(["semifinal", game("semifinal", "D", "C", fieldOf("true")), game("semifinal", "A", "B")]));
  assert.equal(previewOf(edged, pair).sides[0].team, "C");
});

test("a State Championship is a neutral site: its game row and its title chance give the same chance (ADR 0057)", () => {
  assert.deepEqual(fieldOf("", "final"), { neutral: true, trueNeutral: true });
  assert.deepEqual(fieldOf("", "state"), { neutral: true, trueNeutral: true });
  assert.deepEqual(fieldOf("false", "state"), { neutral: false }); // a row that names a home field says for itself
  assert.deepEqual(fieldOf("", "semifinal"), { neutral: true }); // earlier rounds: the listed home team's playoff share
  const edged = { ...table, playoff_edge: 1 };
  const final = { bracket: "B", round: "final", home: "D", away: "C", played: false, ...fieldOf("", "final") };
  const row = projectAt(edged, final);
  assert.equal(row.favorite, "C"); // C (+4) over D (+2), no edge for the listed home team
  const { round, chances } = chancesFor(edged, [final]);
  assert.equal(round, "final");
  assert.equal(chances.find((c) => c.team === "C").chance, row.winProbability);
  // An unplayed semifinal inside the last four counts at its own field, as its game row shows it.
  const semis = [{ bracket: "B", round: "semifinal", home: "D", away: "C", played: false, ...fieldOf("", "semifinal") }, { bracket: "B", round: "semifinal", home: "A", away: "B", played: false, ...fieldOf("", "semifinal") }];
  const withEdge = chancesFor(edged, semis).chances;
  const without = chancesFor(table, semis).chances; // playoff_edge 0: no edge
  assert.ok(withEdge.find((c) => c.team === "D").chance > without.find((c) => c.team === "D").chance);
  // Every list of title chances is shown rounded with the rest of the list, so it adds up to 100%.
  const shownSum = withEdge.reduce((n, c) => n + Number(c.shown.replace(/[<>%]/g, "")), 0);
  assert.ok(withEdge.every((c) => /^(<1|>99|\d{1,2})%$/.test(c.shown)));
  assert.ok(withEdge.some((c) => /[<>]/.test(c.shown)) || shownSum === 100, `${shownSum}`);
});
