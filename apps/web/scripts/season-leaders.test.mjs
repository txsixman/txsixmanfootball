// Team leaders for a season hub (lib/season-leaders.ts): per-game averages, forfeits out entirely, a minimum of games.
// Invented schools only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "season-leaders-"));
const outfile = path.join(tmp, "season-leaders.mjs");
await build({ entryPoints: [path.join(WEB, "lib/season-leaders.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const { teamLeaders, LEADER_MIN_GAMES } = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const game = (home, away, homeScore, awayScore, forfeit = false) => ({ home, away, homeScore, awayScore, forfeit });
const all = () => true;

/** `team` plays `n` games against `opp`, scoring `scored` and allowing `allowed` each time. */
const games = (team, opp, n, scored, allowed) => Array.from({ length: n }, () => game(team, opp, scored, allowed));

test("averages points scored and allowed per game, best first, and keeps the top three", () => {
  const g = [...games("Aldine", "Out A", 6, 50, 10), ...games("Brook", "Out B", 6, 40, 20), ...games("Cedar", "Out C", 6, 60, 30), ...games("Dale", "Out D", 6, 30, 5)];
  const { scored, allowed } = teamLeaders(g, (t) => !t.startsWith("Out"));
  assert.deepEqual(scored.map((l) => [l.team, l.average]), [["Cedar", 60], ["Aldine", 50], ["Brook", 40]]);
  assert.deepEqual(allowed.map((l) => [l.team, l.average]), [["Dale", 5], ["Aldine", 10], ["Brook", 20]]);
});

test("a team needs the minimum number of played games, and only listed teams count", () => {
  assert.equal(LEADER_MIN_GAMES, 6);
  const g = [...games("Aldine", "Out A", 5, 70, 0), ...games("Brook", "Out B", 6, 40, 20)];
  assert.deepEqual(teamLeaders(g, (t) => !t.startsWith("Out")).scored.map((l) => l.team), ["Brook"]);
  assert.deepEqual(teamLeaders(g, all).scored.map((l) => l.team).includes("Out A"), false, "Out A played only 5");
  assert.equal(teamLeaders(g, (t) => t === "Brook", { min: 7 }).scored.length, 0);
});

test("a forfeit leaves the points and the game count out entirely", () => {
  // Six real games of 40-20 and one forfeit recorded 1-0: the average stays 40, and the forfeit is not a seventh game.
  const g = [...games("Aldine", "Out A", 6, 40, 20), game("Aldine", "Out A", 1, 0, true), game("Out B", "Aldine", 2, 0, true)];
  const [lead] = teamLeaders(g, (t) => t === "Aldine").scored;
  assert.deepEqual(lead, { team: "Aldine", games: 6, average: 40 });
  // Five real games plus forfeits is still not enough games.
  assert.equal(teamLeaders([...games("Brook", "Out B", 5, 40, 20), game("Brook", "Out B", 0, 1, true)], (t) => t === "Brook").scored.length, 0);
});

test("a team counts its games as the home or the away side; ties go to more games, then name", () => {
  const g = [
    ...Array.from({ length: 3 }, () => game("Aldine", "Out A", 40, 10)),
    ...Array.from({ length: 3 }, () => game("Out A", "Aldine", 10, 40)),
    ...games("Brook", "Out B", 6, 40, 10),
    ...games("Cedar", "Out C", 7, 40, 10),
  ];
  const { scored } = teamLeaders(g, (t) => !t.startsWith("Out"));
  assert.deepEqual(scored.map((l) => l.team), ["Cedar", "Aldine", "Brook"]);
});
