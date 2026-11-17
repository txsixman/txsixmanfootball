// Team scoring leaders (lib/leaders.ts, ADR 0101): per-game averages, who qualifies, ties, and what is left out.
// Invented schools only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "leaders-"));
const outfile = path.join(tmp, "leaders.mjs");
await build({ entryPoints: [path.join(WEB, "lib/leaders.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { leaderBoards, topRows, leadersHref, viewOfSchool, inLeaderView, LEADER_VIEWS, MERCY_MARGIN, HIGH_SCORE, SEASON_MIN_GAMES } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const game = (home, away, homeScore, awayScore, extra = {}) => ({ home, away, homeScore, awayScore, forfeit: false, date: `2026-09-${String(++n % 28 + 1).padStart(2, "0")}`, href: `/scores/${n}`, ...extra });
/** `team` plays `count` games against "Out", scoring `scored` and allowing `allowed` in each. */
const games = (team, count, scored, allowed) => Array.from({ length: count }, () => game(team, "Out", scored, allowed));
const mine = (t) => t !== "Out";
const names = (rows) => rows.map((r) => r.team);

test("per-game points scored, points allowed and margin, best first, rounded to one decimal", () => {
  const g = [...games("Aldine", 6, 50, 10), ...games("Brook", 5, 40, 20), game("Brook", "Out", 47, 20), ...games("Cedar", 6, 30, 30), game("Cedar", "Out", 31, 30)];
  const b = leaderBoards(g, mine);
  assert.deepEqual(b.scored.map((r) => [r.team, r.value, r.games]), [["Aldine", 50, 6], ["Brook", 41.2, 6], ["Cedar", 30.1, 7]]); // 247 / 6 = 41.17
  assert.deepEqual(b.allowed.map((r) => [r.team, r.value]), [["Aldine", 10], ["Brook", 20], ["Cedar", 30]]);
  assert.deepEqual(b.margin.map((r) => [r.team, r.value]), [["Aldine", 40], ["Brook", 21.2], ["Cedar", 0.1]]); // 127 / 6 = 21.17, 1 / 7 = 0.14
  assert.equal(b.counted, 19, "each game counts once: 6 + 6 + 7 games against \"Out\", a team outside the view");
});

test("a team lists only with the minimum number of games, and the season total needs more", () => {
  const g = [...games("Aldine", 5, 50, 0), ...games("Brook", 6, 40, 20), ...games("Cedar", 8, 30, 10)];
  const b = leaderBoards(g, mine);
  assert.deepEqual(names(b.scored), ["Brook", "Cedar"], "Aldine has five games");
  assert.deepEqual(names(b.shutouts), [], "five shutouts do not list a team with five games");
  assert.equal(SEASON_MIN_GAMES, 8);
  assert.deepEqual(b.seasonAllowed.map((r) => [r.team, r.value, r.games]), [["Cedar", 80, 8]], "only Cedar has played eight");
  assert.deepEqual(names(leaderBoards(g, mine, { min: 5 }).scored), ["Aldine", "Brook", "Cedar"]);
  assert.deepEqual(names(leaderBoards(g, (t) => t === "Brook").scored), ["Brook"], "only the view's teams are listed");
});

test("ties share a place, a count list leaves out zero, and a tie past the tenth row is said", () => {
  const g = [...games("Aldine", 6, 40, 10), ...games("Brook", 6, 40, 10), ...games("Cedar", 6, 40, 12), ...games("Dale", 6, 30, 10)];
  const b = leaderBoards(g, mine);
  assert.deepEqual(b.scored.map((r) => [r.team, r.place, r.tied]), [["Aldine", 1, true], ["Brook", 1, true], ["Cedar", 1, true], ["Dale", 4, false]]);
  assert.deepEqual(b.allowed.map((r) => [r.team, r.place, r.tied]), [["Aldine", 1, true], ["Brook", 1, true], ["Dale", 1, true], ["Cedar", 4, false]]);
  // Two averages that print the same figure are tied, though the sums differ slightly: 40.04 and 39.96 both read 40.0.
  const close = [...games("Eve", 25, 40, 0), game("Eve", "Out", 41, 0), ...games("Finn", 24, 40, 0), game("Finn", "Out", 39, 0), game("Finn", "Out", 40, 0)];
  const c = leaderBoards(close, mine).scored;
  assert.deepEqual(c.map((r) => [r.team, r.value, r.place]), [["Eve", 40, 1], ["Finn", 40, 1]]);
  assert.deepEqual(b.shutouts, [], "no shutouts: a count list has no zero rows");
  const many = Array.from({ length: 14 }, (_, i) => `T${String(i).padStart(2, "0")}`);
  const sixties = leaderBoards(many.flatMap((t) => games(t, 6, 60, 0)), mine).sixty;
  assert.equal(sixties.length, 14);
  assert.ok(sixties.every((r) => r.place === 1 && r.tied && r.value === 6));
  assert.deepEqual({ ...topRows(sixties), shown: topRows(sixties).shown.length }, { shown: 10, more: 4, place: 1 });
  const distinct = leaderBoards([...games("A1", 6, 60, 0), ...games("B1", 7, 60, 0)], mine).sixty;
  assert.deepEqual(topRows(distinct), { shown: distinct, more: 0, place: 2 });
  assert.deepEqual(topRows([]), { shown: [], more: 0, place: 0 });
});

test("a forfeit, a disputed final and a 0-0 are left out, and the first two are counted", () => {
  const g = [
    ...games("Aldine", 6, 40, 20),
    game("Aldine", "Out", 1, 0, { forfeit: true }),
    game("Out", "Aldine", 2, 0, { forfeit: true }),
    game("Aldine", "Out", 70, 0, { disputed: true }),
    game("Aldine", "Out", 0, 0),
    game("Out", "Out", 1, 0, { forfeit: true }), // no team of the view: not counted
  ];
  const b = leaderBoards(g, mine);
  assert.deepEqual(b.left, { forfeits: 2, disputed: 1 });
  assert.equal(b.counted, 6);
  assert.deepEqual(b.scored.map((r) => [r.team, r.value, r.games]), [["Aldine", 40, 6]], "the forfeits are not a seventh game");
  assert.deepEqual(b.shutouts, [], "the disputed 70-0 is not a shutout");
  assert.deepEqual(b.sixty, [], "nor a 60-point game");
  assert.equal(b.singles.length, 6, "the single-game list holds the sides of the view only, and none of the games left out");
  assert.ok(b.singles.every((r) => r.team === "Aldine" && r.points === 40));
});

test("shutouts, wins by 45 or more and 60-point games count exactly at their edges", () => {
  assert.equal(MERCY_MARGIN, 45);
  assert.equal(HIGH_SCORE, 60);
  const g = [
    game("Aldine", "Out", 59, 14), // margin 45: a mercy win, not a 60-point game
    game("Aldine", "Out", 60, 16), // margin 44: a 60-point game, not a mercy win
    game("Aldine", "Out", 45, 0), // a shutout and a mercy win
    game("Out", "Aldine", 0, 7), // a shutout, margin 7
    game("Out", "Aldine", 50, 0), // a loss by 50 is nobody's mercy win in the view
    ...games("Aldine", 1, 20, 20),
  ];
  const b = leaderBoards(g, mine, { min: 1 });
  const row = (list) => list.find((r) => r.team === "Aldine")?.value;
  assert.equal(row(b.shutouts), 2);
  assert.equal(row(b.mercy), 2);
  assert.equal(row(b.sixty), 1);
});

test("the single-game list has no minimum, takes each side of a game, and ties share the place", () => {
  const g = [game("Aldine", "Out", 62, 0), game("Out", "Brook", 14, 62), game("Cedar", "Brook", 40, 36)];
  const b = leaderBoards(g, mine);
  assert.deepEqual(b.scored, [], "no team has the minimum, yet the games are listed");
  assert.deepEqual(b.singles.map((r) => [r.team, r.points, r.against, r.opponent, r.place, r.tied]), [
    ["Aldine", 62, 0, "Out", 1, true],
    ["Brook", 62, 14, "Out", 1, true],
    ["Cedar", 40, 36, "Brook", 3, false],
    ["Brook", 36, 40, "Cedar", 4, false],
  ]);
  assert.ok(b.singles.every((r) => r.href.startsWith("/scores/")));
});

test("views: UIL's divisions, other organizations, a school's own view and the addresses", () => {
  assert.deepEqual(LEADER_VIEWS.map((v) => v.slug).slice(0, 4), ["", "division-1", "division-2", "tapps"]);
  const [uil, one, two, tapps] = LEADER_VIEWS;
  assert.equal(viewOfSchool({ league: "UIL", division: "II" }), two);
  assert.equal(viewOfSchool({ league: "UIL", division: "I" }), one);
  assert.equal(viewOfSchool({ league: "TAPPS", division: "I" }), tapps, "TAPPS has divisions, but is ranked as one organization");
  assert.equal(viewOfSchool({ league: "UIL", division: "" }), uil);
  assert.equal(viewOfSchool({ league: "Nowhere", division: "I" }), undefined);
  assert.equal(inLeaderView(one, [{ league: "UIL", division: "I" }]), true);
  assert.equal(inLeaderView(one, [{ league: "UIL", division: "II" }]), false);
  assert.equal(inLeaderView(uil, [{ league: "UIL", division: "II" }]), true);
  assert.equal(inLeaderView(tapps, [{ league: "UIL", division: "I" }, { league: "TAPPS", division: "II" }]), true, "a school two leagues list is in both");
  assert.equal(inLeaderView(uil, undefined), false, "a team no alignment lists is in no view");
  assert.equal(leadersHref(2026, 2026, uil), "/leaders");
  assert.equal(leadersHref(2026, 2026, tapps), "/leaders/tapps");
  assert.equal(leadersHref(2025, 2026, uil), "/leaders/2025");
  assert.equal(leadersHref(2025, 2026, two), "/leaders/2025/division-2");
});
