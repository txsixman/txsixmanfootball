// A team's road to the State Championship (lib/road.ts, ADR 0104): the rounds still ahead with the chance to reach and win each,
// and the opponents it could meet. Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { advancement } from "../lib/advancement.ts";
import { derivedSlots } from "../lib/bracket-fill.ts";
import { roads } from "../lib/road.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "road-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error", alias: { "@": WEB } });
  return import(pathToFileURL(outfile).href);
};
const { project, projectAt, STATE_CHAMPIONSHIP_ROUNDS } = await load("projection");
const { winChance } = await load("win-chance");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const table = (ratings, rated = {}) => ({
  games: 100, home_field: 3, sigma: 14, playoff_edge: 0.5, calibration: { family: "logistic", scale: 8 },
  teams: Object.entries(ratings).map(([team, rating]) => ({ team, rating, rated: rated[team] ?? 8, won: 5, lost: 3, tied: 0 })),
});
const game = (round, home, away, score, extra = {}) => ({ round, date: "2026-11-20", home, away, neutral: true, confirmed: !!score, ...(score ? { homeScore: score[0], awayScore: score[1] } : {}), ...extra });
const feed = (x) => (x === "bye" ? { bye: true } : x.startsWith("winner:") ? { winnerOf: x.slice(7) } : { team: x });
const slot = (id, round, a, b) => ({ slot: id, round, a: feed(a), b: feed(b) });
const ORDER = ["quarterfinal", "semifinal", "final"];
const EIGHT = [
  slot("Q1", "quarterfinal", "A", "B"), slot("Q2", "quarterfinal", "C", "D"), slot("Q3", "quarterfinal", "E", "F"), slot("Q4", "quarterfinal", "G", "H"),
  slot("S1", "semifinal", "winner:Q1", "winner:Q2"), slot("S2", "semifinal", "winner:Q3", "winner:Q4"),
  slot("F", "final", "winner:S1", "winner:S2"),
];
const RATED = table({ A: 40, B: 10, C: 30, D: 25, E: 20, F: 18, G: 35, H: 5 });
const near = (x, y, msg) => assert.ok(Math.abs(x - y) < 1e-9, `${msg}: ${x} vs ${y}`);
/** The roads of `slots` and `games` on `t`, with the site pages use: the listed game's own, else a neutral field. */
const roadsOf = (slots, games, t = RATED, order = ORDER) =>
  roads(slots, games, order, winChance(t), (a, b, g) => (g ? projectAt(t, g) : project(t, a, b, true, true)), STATE_CHAMPIONSHIP_ROUNDS);

test("a team in the first round: every round ahead in order, ending in the final, its chances from the same model as the table", () => {
  const road = roadsOf(EIGHT, []).get("A");
  assert.equal(road.state, "alive");
  assert.deepEqual(road.steps.map((s) => s.round), ["quarterfinal", "semifinal", "final"]);
  const [q, s, f] = road.steps;
  // The next game: its one opponent, a sure thing, and the projection for it.
  assert.equal(q.reach, 1);
  assert.deepEqual(q.opponents.map((o) => [o.team, o.reach]), [["B", 1]]);
  near(q.opponents[0].projection.margin, project(RATED, "A", "B", true, true).margin, "margin against B");
  near(q.win, winChance(RATED)("A", "B"), "chance to win the first game");
  // Reaching a round is winning the one before; the last round's win is the title, which the table also gives.
  near(s.reach, q.win, "semifinal reach is the quarterfinal win");
  near(f.reach, s.win, "final reach is the semifinal win");
  const title = advancement(EIGHT, [], ORDER, winChance(RATED), STATE_CHAMPIONSHIP_ROUNDS).rows.find((r) => r.team === "A").title;
  near(f.win, title, "the final's win is the State Championship chance");
  // Two possible semifinal opponents, each with the chance it gets there, most likely first; and they add up.
  assert.deepEqual(s.opponents.map((o) => o.team), ["C", "D"]);
  near(s.opponents.reduce((n, o) => n + o.reach, 0), 1, "semifinal opponents");
  assert.ok(s.opponents[0].reach > s.opponents[1].reach);
  // The final's other half has four teams: three named, the fourth counted, and the shares still add up.
  assert.equal(f.opponents.length, 3);
  assert.equal(f.more.count, 1);
  near(f.opponents.reduce((n, o) => n + o.reach, f.more.reach), 1, "final opponents");
});

test("a team that is out has no road, only the round it was out in; its conqueror's road runs on", () => {
  const roadsAfter = roadsOf(EIGHT, [game("quarterfinal", "G", "H", [6, 28]), game("quarterfinal", "A", "B", [40, 0])]);
  const g = roadsAfter.get("G");
  assert.deepEqual([g.state, g.outRound, g.steps], ["out", "quarterfinal", []]);
  const h = roadsAfter.get("H");
  assert.equal(h.state, "alive");
  assert.equal(h.steps[0].round, "semifinal", "a confirmed win settles that game: the road starts at the next");
  assert.equal(h.steps[0].reach, 1);
  assert.equal(roadsAfter.get("B").state, "out");
});

test("a champion has no rounds ahead", () => {
  const all = [
    game("quarterfinal", "A", "B", [40, 0]), game("quarterfinal", "C", "D", [20, 21]), game("quarterfinal", "E", "F", [30, 7]), game("quarterfinal", "G", "H", [35, 0]),
    game("semifinal", "A", "D", [28, 14]), game("semifinal", "E", "G", [7, 21]), game("final", "A", "G", [14, 20]),
  ];
  const r = roadsOf(EIGHT, all);
  assert.deepEqual([r.get("G").state, r.get("G").steps], ["champion", []]);
  assert.deepEqual([r.get("A").state, r.get("A").outRound], ["out", "final"]);
});

test("a score no source confirms advances no one: the game stays on the road, undecided", () => {
  // G (rated 30 over H) reported a win, unconfirmed: G is not through, and H is not out.
  const r = roadsOf(EIGHT, [game("quarterfinal", "G", "H", [35, 0], { confirmed: false })]);
  for (const t of ["G", "H"]) {
    const road = r.get(t);
    assert.equal(road.state, "alive", t);
    assert.equal(road.steps[0].round, "quarterfinal");
    assert.equal(road.steps[0].reported, true);
    assert.ok(road.steps[0].reach === 1 && road.steps[0].win < 1);
  }
  near(r.get("G").steps[0].win + r.get("H").steps[0].win, 1, "the game's chances add up, as before the score");
});

test("a bracket with a bye: the round is noted, and the road starts at the next game", () => {
  const slots = [slot("Q1", "quarterfinal", "A", "bye"), slot("Q2", "quarterfinal", "C", "D"), slot("S1", "semifinal", "winner:Q1", "winner:Q2"), slot("F", "final", "winner:S1", "E")];
  const r = roadsOf(slots, []);
  const a = r.get("A");
  assert.deepEqual(a.byes, ["quarterfinal"]);
  assert.deepEqual(a.steps.map((s) => s.round), ["semifinal", "final"]);
  assert.equal(a.steps[0].reach, 1);
  assert.deepEqual(a.steps[0].opponents.map((o) => o.team).sort(), ["C", "D"]);
  assert.equal(r.get("C").steps[0].round, "quarterfinal", "the team playing in the bye's round still has it ahead");
  // Still a bye ahead when the team itself is not yet placed: the bye is the step, with no opponent.
  const pending = [slot("Q1", "quarterfinal", "A", "B"), slot("S1", "semifinal", "winner:Q1", "bye"), slot("F", "final", "winner:S1", "E")];
  const p = roadsOf(pending, []).get("A");
  assert.deepEqual(p.steps.map((s) => [s.round, s.kind]), [["quarterfinal", "game"], ["semifinal", "bye"], ["final", "game"]]);
  near(p.steps[1].reach, p.steps[0].win, "a bye is reached by winning, and won by being there");
  near(p.steps[1].win, p.steps[1].reach, "a bye is won by being there");
});

test("a private league's bracket from its listed games: the two semifinals, then the final that closes them", () => {
  const t = table({ North: 30, South: 24, East: 20, West: 10 });
  const games = [game("semifinal", "North", "West"), game("semifinal", "South", "East")];
  const slots = derivedSlots(games, "final", ORDER);
  const r = roadsOf(slots, games, t);
  const road = r.get("North");
  assert.deepEqual(road.steps.map((s) => s.round), ["semifinal", "final"]);
  assert.equal(road.steps[0].game, games[0], "the listed game is the step's");
  assert.deepEqual(road.steps[1].opponents.map((o) => o.team), ["South", "East"]);
  // The listed game's projection is at its own site, the final's on a neutral field.
  near(road.steps[0].opponents[0].projection.margin, projectAt(t, games[0]).margin, "at the listed site");
  assert.ok(Math.abs(road.steps[1].opponents[0].projection.margin - project(t, "North", "South", true, true).margin) < 1e-9);
  // Win the semifinal and the final is the next game.
  const after = roadsOf(derivedSlots([game("semifinal", "North", "West", [30, 6]), games[1]], "final", ORDER), [game("semifinal", "North", "West", [30, 6]), games[1]], t);
  assert.deepEqual(after.get("North").steps.map((s) => s.round), ["final"]);
  assert.equal(after.get("West").state, "out");
});

test("a team with too few rated games is given no chance and no projection, and nothing it touches is guessed", () => {
  const t = table({ A: 40, B: 10, C: 30, D: 25, E: 20, F: 18, G: 35, H: 5 }, { H: 3 });
  const r = roadsOf(EIGHT, [], t);
  const g = r.get("G").steps[0];
  assert.equal(g.win, undefined);
  assert.equal(g.opponents[0].team, "H");
  assert.equal(g.opponents[0].projection, undefined, "no projection against a team the model cannot project");
  assert.ok(r.get("A").steps[1].reach > 0, "the other half of the bracket is still projected");
});

test("the slot's own kickoff and site, from the bracket file, ride with the step", () => {
  const slots = EIGHT.map((s) => (s.slot === "F" ? { ...s, kickoff_utc: "2026-12-12T01:00:00Z", site: "Stadium, City" } : s));
  const f = roadsOf(slots, []).get("A").steps.at(-1);
  assert.deepEqual([f.kickoff_utc, f.site], ["2026-12-12T01:00:00Z", "Stadium, City"]);
});
