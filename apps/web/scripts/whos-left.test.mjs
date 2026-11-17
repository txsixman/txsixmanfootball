// Who is left in a bracket, each team's next game and road (ADR 0094; lib/whos-left.ts), worked out from the tree's boxes.
// UIL Division I from its own bracket and the live rows of Nov 14, 2026 (the same fixture the tree tests read), and small
// invented brackets for a bye, a disputed final, a forfeit, a bracket drawn by rounds only, and a champion.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ownSlots, ROUND_ORDER, uilSlotRows } from "../lib/bracket-fill.ts";
import { treeGames } from "../lib/bracket-tree.ts";
import { parseCsv, UIL_BRACKET_COLUMNS, UilBracketRow } from "../lib/data-schemas.ts";
import { dayLine, openRound, pathSteps, stepText, teamStatus, whosLeft } from "../lib/whos-left.ts";

const STRUCTURE = parseCsv("b.csv", readFileSync(new URL("../../../data/seed/uil-2026-28/bracket-2026.csv", import.meta.url), "utf8"), UIL_BRACKET_COLUMNS, UilBracketRow).map(({ row }) => row);
const [header, ...lines] = readFileSync(new URL("fixtures/uil-2026-playoffs-nov14.csv", import.meta.url), "utf8").trim().split("\n");
const LIVE = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [header.split(",")[i], v])));
const toGame = (r) => ({
  round: r.round, date: r.game_date, home: r.home, away: r.away, confirmed: r.home_score !== "",
  ...(r.home_score !== "" ? { homeScore: Number(r.home_score), awayScore: Number(r.away_score) } : {}),
});
const game = (round, date, home, away, score, extra = {}) => ({ round, date, home, away, confirmed: !!score, ...(score ? { homeScore: score[0], awayScore: score[1] } : {}), ...extra });
const label = { "round-1": "First round", "bi-district": "Bi-district", quarterfinal: "Quarterfinal", area: "Area", regional: "Regional", semifinal: "Semifinal", final: "State Championship", state: "State Championship" };
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The tree as the page hands it to "Who's left": boxes with the next game each goes on to, and the rounds in order. (The page builds
 * this in app/playoffs/tree/data.ts buildTree; the same fields, from the same tree.) */
function data(tree) {
  const to = new Map(tree.flatMap((n) => n.feeds.filter((f) => f !== null).map((f) => [f, n.id])));
  const boxes = tree.map((n) => ({
    id: n.id, label: label[n.round] ?? n.round, state: n.state, ...(n.code ? { code: n.code } : {}),
    sides: n.sides.map((s) => ({ text: s.text, ...(s.team ? { key: slug(s.team), program: slug(s.team) } : {}), ...(s.score != null ? { score: s.score } : {}), ...(s.won ? { won: true } : {}), ...(s.bye ? { bye: true } : {}) })),
    ...(to.has(n.id) ? { to: to.get(n.id) } : {}), ...(n.game?.forfeit ? { forfeit: true } : {}),
    ...(n.game ? { date: n.game.date } : {}),
  }));
  const rounds = [...new Set(tree.map((n) => n.round))].map((round) => ({ round, label: label[round] ?? round, ids: tree.filter((n) => n.round === round).map((n) => n.id) }));
  return { boxes, rounds };
}
const names = (rows) => rows.map((r) => r.name);

test("UIL Division I after bi-district: the 16 winners are left, none of the 16 that lost, each with its area game", () => {
  const games = LIVE.filter((r) => r.division === "I").map(toGame);
  const d = data(treeGames(ownSlots(uilSlotRows(STRUCTURE), { league: "UIL", division: "I" }), games, ROUND_ORDER));
  const left = whosLeft(d);
  assert.equal(left.length, 16);
  const losers = d.boxes.filter((b) => b.state === "final" && b.label === "Bi-district").flatMap((b) => b.sides.filter((s) => !s.won).map((s) => s.text));
  assert.equal(losers.length, 16);
  for (const l of losers) assert.ok(!names(left).includes(l), `${l} lost and is not left`);
  // Every one has an area game next (G17 to G24), the team beside a team or "Winner of …"; none has a State Championship chance yet.
  for (const l of left) {
    assert.equal(l.next?.label, "Area", l.name);
    assert.ok(/^G(1[7-9]|2[0-4])$/.test(l.next.id), `${l.name} next ${l.next?.id}`);
    assert.equal(l.state, "alive");
    assert.equal(l.title, undefined);
  }
  // Nazareth and Hermleigh meet in G17: each other's opponent.
  const g17 = left.filter((l) => l.next.id === "G17").map((l) => l.name).sort();
  assert.deepEqual(g17, ["Hermleigh", "Nazareth"]);
});

test("a team's own game before any result: everyone is left, the next game is the one it is in", () => {
  const d = data(treeGames(ownSlots(uilSlotRows(STRUCTURE), { league: "UIL", division: "I" }), [], ROUND_ORDER));
  const left = whosLeft(d);
  assert.equal(left.length, 32);
  assert.ok(left.every((l) => l.next?.label === "Bi-district"));
});

test("most likely champion first, a team with no chance after, then by name; the page's own words for each chance", () => {
  const d = data(treeGames(ownSlots(uilSlotRows(STRUCTURE), { league: "UIL", division: "I" }), LIVE.filter((r) => r.division === "I").map(toGame), ROUND_ORDER));
  const all = whosLeft(d);
  const [a, b, c] = [all[0].key, all[1].key, all[2].key];
  const out = whosLeft(d, { [a]: "9%", [b]: "30%", [c]: "30%" }, { [a]: 0.09, [b]: 0.3, [c]: 0.3 });
  assert.deepEqual(out.slice(0, 3).map((l) => l.title), ["30%", "30%", "9%"]);
  assert.ok(out[0].name.localeCompare(out[1].name) < 0, "a tie is by name");
  assert.ok(out.slice(3).every((l) => l.title === undefined));
});

/** Eight teams: bye for A in the first round, B beats C, D forfeits to E, F v G is disputed, H waits. */
function small() {
  const rows = [
    ["round-1", "R1", "A", "bye"], ["round-1", "R2", "B", "C"], ["round-1", "R3", "D", "E"], ["round-1", "R4", "F", "G"],
    ["semifinal", "S1", "winner:R1", "winner:R2"], ["semifinal", "S2", "winner:R3", "winner:R4"], ["final", "FIN", "winner:S1", "winner:S2"],
  ].map(([round, slot, a, b]) => ({ league: "X", division: "1", round, slot, a, b }));
  const games = [
    game("round-1", "2026-11-06", "B", "C", [28, 21]),
    game("round-1", "2026-11-06", "E", "D", [1, 0], { forfeit: true }),
    game("round-1", "2026-11-06", "F", "G", [30, 28], { confirmed: false }),
  ];
  return data(treeGames(ownSlots(rows, { league: "X", division: "1" }), games, ROUND_ORDER));
}

test("a bye, a won game, a forfeit win and a disputed final: who is left and where each goes next", () => {
  const d = small();
  const left = whosLeft(d);
  assert.deepEqual(names(left).sort(), ["A", "B", "E", "F", "G"], "C and D lost; F and G stay in a disputed final, naming no winner");
  const next = Object.fromEntries(left.map((l) => [l.name, l.next?.id]));
  assert.deepEqual(next, { A: "S1", B: "S1", E: "S2", F: "R4", G: "R4" });
  assert.equal(teamStatus(d, "c").state, "out");
  assert.equal(teamStatus(d, "d").state, "out");
  assert.equal(teamStatus(d, "zzz"), undefined, "a name the bracket does not hold");
});

test("a team's road: games played, the one next, then what its wins would lead to", () => {
  const d = small();
  assert.deepEqual(pathSteps(d, "b").map((s) => [s.round, s.kind]), [["round-1", "played"], ["semifinal", "next"], ["final", "ahead"]]);
  assert.equal(pathSteps(d, "b")[0].text, "First round: won 28-21 over C");
  assert.equal(pathSteps(d, "c")[0].text, "First round: lost 21-28 to B");
  assert.equal(pathSteps(d, "c").length, 1, "a team that is out has no road ahead");
  assert.equal(pathSteps(d, "a")[0].text, "First round: bye");
  // A forfeit says so and shows no score; a disputed final names no winner.
  assert.equal(stepText(d.boxes.find((b) => b.id === "R3"), "e"), "First round: won by forfeit over D");
  assert.equal(stepText(d.boxes.find((b) => b.id === "R4"), "f"), "First round: result under review, against G");
  assert.equal(stepText(d.boxes.find((b) => b.id === "S1"), "b"), "Semifinal: date not listed yet, against A");
});

test("the State Championship won: one team left, a champion, with no next game", () => {
  const rows = [["semifinal", "S1", "A", "B"], ["semifinal", "S2", "C", "D"], ["final", "FIN", "winner:S1", "winner:S2"]].map(([round, slot, a, b]) => ({ league: "X", division: "1", round, slot, a, b }));
  const games = [game("semifinal", "2026-11-13", "A", "B", [21, 14]), game("semifinal", "2026-11-13", "C", "D", [7, 35]), game("final", "2026-11-21", "A", "D", [28, 42])];
  const d = data(treeGames(ownSlots(rows, { league: "X", division: "1" }), games, ROUND_ORDER));
  const left = whosLeft(d);
  assert.deepEqual(left.map((l) => [l.name, l.state, l.next]), [["D", "champion", undefined]]);
  assert.equal(pathSteps(d, "d").at(-1).text, "State Championship: won 42-28 over A");
});

test("a bracket drawn by rounds only (no feeds): a winner stays in with no next game set yet", () => {
  const qf = [game("quarterfinal", "2026-11-06", "A", "B", [21, 14]), game("quarterfinal", "2026-11-06", "C", "D", [7, 35])];
  const boxes = qf.map((g, i) => ({
    id: `game:${i}`, label: "Quarterfinal", state: "final",
    sides: [{ text: g.away, key: slug(g.away), ...(g.awayScore > g.homeScore ? { won: true } : {}), score: g.awayScore }, { text: g.home, key: slug(g.home), ...(g.homeScore > g.awayScore ? { won: true } : {}), score: g.homeScore }],
  }));
  const d = { boxes, rounds: [{ round: "quarterfinal", label: "Quarterfinal", ids: boxes.map((b) => b.id) }] };
  assert.deepEqual(names(whosLeft(d)).sort(), ["A", "D"]);
  assert.ok(whosLeft(d).every((l) => l.next === undefined && l.state === "alive"));
});

test("the round to open on: the page's pick when the bracket has it, else the first with a game still to play, else the last", () => {
  const d = small();
  assert.equal(openRound(d), 1, "the first round is all played, a bye and a disputed final: the semifinals are the first with a game still to play");
  assert.equal(openRound(d, "final"), 2);
  assert.equal(openRound(d, "nope"), openRound(d));
  const played = { boxes: [{ id: "x", state: "final" }], rounds: [{ round: "a", ids: ["x"] }, { round: "b", ids: ["x"] }] };
  assert.equal(openRound(played), 1, "every game played: the last round");
});

test("a day line says the weekday and the date, or that the date is not listed", () => {
  assert.equal(dayLine("2026-11-20"), "Fri, Nov 20");
  assert.equal(dayLine(undefined), "Date not listed yet");
});
