// Each team's chance to reach each later round and to win the State Championship, worked out exactly up the bracket
// (lib/advancement.ts, ADR 0071). Invented teams, plus UIL Division I and II from their own bracket file and the rows of
// Nov 14, 2026 (fixtures/uil-2026-playoffs-nov14.csv) with invented ratings.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { advancement, slotShares } from "../lib/advancement.ts";
import { ownSlots, ROUND_ORDER, uilSlotRows } from "../lib/bracket-fill.ts";
import { parseCsv, UIL_BRACKET_COLUMNS, UilBracketRow } from "../lib/data-schemas.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "advancement-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error", alias: { "@": WEB } });
  return import(pathToFileURL(outfile).href);
};
const { project, projectAt, STATE_CHAMPIONSHIP_ROUNDS } = await load("projection");
const { winChance } = await load("brackets");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

/** A ratings table of invented teams: `ratings` by name, each with `rated` games (8 unless given). */
const table = (ratings, rated = {}) => ({
  games: 100, home_field: 3, sigma: 14, playoff_edge: 0.5, calibration: { family: "logistic", scale: 8 },
  teams: Object.entries(ratings).map(([team, rating]) => ({ team, rating, rated: rated[team] ?? 8, won: 5, lost: 3, tied: 0 })),
});
const game = (round, home, away, score, extra = {}) => ({ round, date: "2026-11-20", home, away, neutral: true, confirmed: !!score, ...(score ? { homeScore: score[0], awayScore: score[1] } : {}), ...extra });
const slot = (id, round, a, b) => ({ slot: id, round, a: a.startsWith("winner:") ? { winnerOf: a.slice(7) } : { team: a }, b: b.startsWith("winner:") ? { winnerOf: b.slice(7) } : { team: b } });
const ORDER = ["quarterfinal", "semifinal", "final"];
/** Eight teams, three rounds: Q1–Q4 feed S1–S2 feed F. */
const EIGHT = [
  slot("Q1", "quarterfinal", "A", "B"), slot("Q2", "quarterfinal", "C", "D"), slot("Q3", "quarterfinal", "E", "F"), slot("Q4", "quarterfinal", "G", "H"),
  slot("S1", "semifinal", "winner:Q1", "winner:Q2"), slot("S2", "semifinal", "winner:Q3", "winner:Q4"),
  slot("F", "final", "winner:S1", "winner:S2"),
];
const RATED = table({ A: 40, B: 10, C: 30, D: 25, E: 20, F: 18, G: 35, H: 5 });
const near = (x, y, msg) => assert.ok(Math.abs(x - y) < 1e-9, `${msg}: ${x} vs ${y}`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("each slot's winner shares, each side's and the title's, add up to 1; each round's reach to two a slot", () => {
  const win = winChance(RATED);
  for (const s of slotShares(EIGHT, [], ORDER, win)) {
    near(sum([...s.winner.values()]), 1, s.slot);
    for (const side of s.sides) near(sum([...side.values()]), 1, `${s.slot} side`);
  }
  const a = advancement(EIGHT, [], ORDER, win, STATE_CHAMPIONSHIP_ROUNDS);
  assert.deepEqual(a.rounds, ["semifinal", "final"]);
  assert.equal(a.rows.length, 8);
  near(sum(a.rows.map((r) => r.reach[0])), 4, "semifinal");
  near(sum(a.rows.map((r) => r.reach[1])), 2, "final");
  near(sum(a.rows.map((r) => r.title)), 1, "title");
  assert.equal(a.rows[0].team, "A", "most likely champion first");
  for (const r of a.rows) assert.ok(r.title <= r.reach[1] && r.reach[1] <= r.reach[0], `${r.team}: a later round is never likelier`);
});

test("a played game's winner gets 100% for the next round and its loser is out, however the ratings read", () => {
  const win = winChance(RATED);
  // H, rated 30 points under G, won: a final is never overridden.
  const games = [game("quarterfinal", "G", "H", [6, 28])];
  const a = advancement(EIGHT, games, ORDER, win, STATE_CHAMPIONSHIP_ROUNDS);
  const row = (t) => a.rows.find((r) => r.team === t);
  assert.equal(row("G"), undefined, "the loser is not still in");
  assert.equal(row("H").reach[0], 1);
  // Every quarterfinal played: the semifinal round is set and leaves the table; each winner is in.
  const all = [game("quarterfinal", "A", "B", [40, 0]), game("quarterfinal", "C", "D", [20, 21]), game("quarterfinal", "E", "F", [30, 7]), ...games];
  const b = advancement(EIGHT, all, ORDER, win, STATE_CHAMPIONSHIP_ROUNDS);
  assert.deepEqual(b.rounds, ["final"]);
  assert.deepEqual(b.rows.map((r) => r.team).sort(), ["A", "D", "E", "H"]);
  near(sum(b.rows.map((r) => r.title)), 1, "title");
  // A projected side names the likelier winner and its share.
  const s1 = slotShares(EIGHT, all, ORDER, win).find((s) => s.slot === "F");
  assert.equal(s1.projected[0].team, "A");
  near(s1.projected[0].chance, win("A", "D"), "A over D on a neutral field");
});

test("a two-team bracket: the title chance is the single game's chance to win, listed or not", () => {
  const t = table({ Alpha: 30, Beta: 21 });
  const win = winChance(t);
  const final = [slot("F", "final", "Alpha", "Beta")];
  // Not listed: a neutral field, the State Championship (ADR 0057).
  const open = advancement(final, [], ["final"], win, STATE_CHAMPIONSHIP_ROUNDS);
  const neutral = project(t, "Alpha", "Beta", true, true);
  assert.deepEqual(open.rounds, []);
  near(open.rows.find((r) => r.team === "Alpha").title, neutral.winProbability, "neutral");
  // Listed at Alpha's own field: the game page's chance there.
  const listed = game("final", "Alpha", "Beta", undefined, { neutral: false });
  const atHome = advancement(final, [listed], ["final"], win, STATE_CHAMPIONSHIP_ROUNDS);
  near(atHome.rows.find((r) => r.team === "Alpha").title, projectAt(t, listed).winProbability, "at its own site");
  assert.ok(projectAt(t, listed).winProbability > neutral.winProbability);
  // A State Championship played: the season is over, nothing to project.
  assert.equal(advancement(final, [game("final", "Alpha", "Beta", [14, 20])], ["final"], win, STATE_CHAMPIONSHIP_ROUNDS), undefined);
});

test("a team with too few rated games is never given a number: its side and what it feeds say so", () => {
  const t = table({ A: 40, B: 10, C: 30, D: 25, E: 20, F: 18, G: 35, H: 5 }, { H: 3 });
  const win = winChance(t);
  assert.equal(win("G", "H"), undefined);
  const shares = slotShares(EIGHT, [], ORDER, win);
  const at = new Map(shares.map((s) => [s.slot, s]));
  assert.deepEqual(at.get("S2").projected[1], { unknown: true });
  assert.equal(at.get("S1").projected[0].team, "A", "the other half is still projected");
  const a = advancement(EIGHT, [], ORDER, win, STATE_CHAMPIONSHIP_ROUNDS);
  assert.ok(a.rows.every((r) => r.title === undefined));
  assert.equal(a.rows.find((r) => r.team === "A").reach[0] > 0, true, "A's semifinal chance does not rest on H");
  assert.equal(a.rows.find((r) => r.team === "H").reach[0], undefined);
  // Once H's game is played, its winner is through and everything is known again.
  const b = advancement(EIGHT, [game("quarterfinal", "G", "H", [35, 0])], ORDER, win, STATE_CHAMPIONSHIP_ROUNDS);
  near(sum(b.rows.map((r) => r.title)), 1, "title");
});

test("UIL Division I and II, Nov 14: every slot still open shows a projected team, from regional to the State Championship", () => {
  const structure = parseCsv("b.csv", readFileSync(new URL("../../../data/seed/uil-2026-28/bracket-2026.csv", import.meta.url), "utf8"), UIL_BRACKET_COLUMNS, UilBracketRow).map(({ row }) => row);
  const [header, ...lines] = readFileSync(new URL("fixtures/uil-2026-playoffs-nov14.csv", import.meta.url), "utf8").trim().split("\n");
  const rows = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [header.split(",")[i], v])));
  for (const division of ["I", "II"]) {
    const games = rows.filter((r) => r.division === division).map((r) => ({
      round: r.round, date: r.game_date, home: r.home, away: r.away, neutral: r.neutral !== "false", confirmed: r.home_score !== "",
      ...(r.home_score !== "" ? { homeScore: Number(r.home_score), awayScore: Number(r.away_score) } : {}),
    }));
    const slots = ownSlots(uilSlotRows(structure), { league: "UIL", division });
    // Invented ratings: each team by its name's length, every team on eight rated games.
    const t = table(Object.fromEntries(structure.flatMap((s) => [s.a, s.b]).filter((x) => !x.startsWith("winner:")).map((x) => [x, x.length * 3])));
    const win = winChance(t);
    const shares = slotShares(slots, games, ROUND_ORDER, win);
    for (const s of shares.filter((x) => ["regional", "semifinal", "state"].includes(x.round))) {
      assert.ok(s.projected.every((p) => p && "team" in p && p.chance > 0 && p.chance < 1), `${division} ${s.slot}`);
    }
    const a = advancement(slots, games, ROUND_ORDER, win, STATE_CHAMPIONSHIP_ROUNDS);
    // Division II's last bi-district game was still to be played on Nov 14: its area slot is open too.
    const open = games.filter((g) => g.round === "bi-district" && g.homeScore == null).length;
    assert.deepEqual(a.rounds, [...(open ? ["area"] : []), "regional", "semifinal", "state"], division);
    assert.equal(a.rows.length, 16 + open, `${division}: every bi-district winner, and both teams of a game not played`);
    a.rounds.forEach((r, i) => near(sum(a.rows.map((x) => x.reach[i])), { area: 16, regional: 8, semifinal: 4, state: 2 }[r], `${division} ${r}`));
    near(sum(a.rows.map((x) => x.title)), 1, `${division} title`);
  }
});
