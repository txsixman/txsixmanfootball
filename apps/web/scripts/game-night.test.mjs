// Game night's pure logic (lib/game-night.ts, lib/game-preview.ts): which night it is, how a night's games are grouped,
// and the opponents two teams have in common. Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "game-night-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const { gameNight, isNight, nightTitle, onNight, groupNight } = await load("game-night");
const { commonOpponents } = await load("game-preview");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test("the game night is the Central date until 6 AM, whatever zone the clock is in (same table as the reader's own test)", () => {
  assert.equal(gameNight(new Date("2026-11-14T02:30:00Z")), "2026-11-13"); // 8:30 PM Friday Central
  assert.equal(gameNight(new Date("2026-11-14T05:59:00Z")), "2026-11-13"); // 11:59 PM Friday Central
  assert.equal(gameNight(new Date("2026-11-14T06:30:00Z")), "2026-11-13"); // 12:30 AM Saturday: still Friday's night
  assert.equal(gameNight(new Date("2026-11-14T11:59:00Z")), "2026-11-13"); // 5:59 AM Saturday Central
  assert.equal(gameNight(new Date("2026-11-14T12:00:00Z")), "2026-11-14"); // 6:00 AM Saturday Central
  assert.equal(gameNight(new Date("2026-11-14T19:00:00Z")), "2026-11-14"); // 1 PM Saturday Central
  assert.equal(gameNight(new Date("2026-03-08T11:30:00Z")), "2026-03-07"); // the spring change to daylight time
  assert.equal(gameNight(new Date("2026-03-08T12:30:00Z")), "2026-03-08");
});

test("a night is a real calendar date, and has a readable title", () => {
  assert.equal(isNight("2026-11-13"), true);
  for (const bad of [undefined, "", "2026-02-30", "2026-13-01", "11/13/2026", "2026-11-13T00:00", "tomorrow"]) assert.equal(isNight(bad), false, String(bad));
  assert.equal(nightTitle("2026-11-13"), "Friday, November 13");
});

test("a night's games are the ones dated that night; a game with no date is on none", () => {
  const games = [{ id: "a", date: "2026-11-13" }, { id: "b", date: "2026-11-14" }, { id: "c" }, { id: "d", date: "2026-11-13" }];
  assert.deepEqual(onNight(games, "2026-11-13").map((g) => g.id), ["a", "d"]);
  assert.deepEqual(onNight(games, "2026-11-15"), []);
});

test("groups: organizations in the site's order, rounds in bracket order, regular season last, games by their sort key; none mixed", () => {
  const ORGS = ["uil", "tapps", "taiao"];
  const ROUNDS = ["round-1", "bi-district", "area", "quarterfinal", "regional", "semifinal", "final", "state"];
  const slot = (org, round, sort, game = sort) => ({ org, round, sort, game });
  const groups = groupNight(
    [slot("tapps", "semifinal", "b"), slot("uil", "", "x"), slot("uil", "area", "z"), slot("uil", "bi-district", "m"), slot("uil", "bi-district", "c"), slot("tapps", "mystery", "q"), slot("tapps", "quarterfinal", "a")],
    ORGS,
    ROUNDS,
  );
  assert.deepEqual(groups, [
    { org: "uil", rounds: [{ round: "bi-district", games: ["c", "m"] }, { round: "area", games: ["z"] }, { round: "", games: ["x"] }] },
    { org: "tapps", rounds: [{ round: "quarterfinal", games: ["a"] }, { round: "semifinal", games: ["b"] }, { round: "mystery", games: ["q"] }] },
  ]);
  assert.deepEqual(groupNight([], ORGS, ROUNDS), []);
  // A game two organizations both have a team in comes as two slots, one under each.
  const both = groupNight([slot("uil", "", "g", "game"), slot("taiao", "", "g", "game")], ORGS, ROUNDS);
  assert.deepEqual(both.map((g) => g.org), ["uil", "taiao"]);
});

const g = (date, home, away, homeScore, awayScore, forfeit = false) => ({ date, home, away, homeScore, awayScore, forfeit });

test("common opponents: each team's score against it, own score first, scores only", () => {
  const alpha = [g("2026-09-04", "Alpha", "Cedar", 42, 20), g("2026-09-11", "Dune", "Alpha", 7, 35), g("2026-09-18", "Alpha", "Solo", 50, 0)];
  const beta = [g("2026-09-05", "Cedar", "Beta", 36, 30), g("2026-09-12", "Beta", "Dune", 28, 14), g("2026-09-19", "Other", "Beta", 3, 40)];
  const { shown, rest } = commonOpponents("Alpha", "Beta", alpha, beta, "2026-11-13");
  assert.equal(rest, 0);
  assert.deepEqual(shown.map(({ opponent, a, b }) => ({ opponent, a, b })), [
    { opponent: "Dune", a: ["35–7"], b: ["28–14"] }, // newest first
    { opponent: "Cedar", a: ["42–20"], b: ["30–36"] },
  ]);
  const text = JSON.stringify(shown);
  assert.doesNotMatch(text, /won|lost|beat|win|loss|W-L/i); // no word for how a game went
});

test("common opponents: a forfeit is the word, never 1-0; a repeat opponent lists each game oldest first", () => {
  const alpha = [g("2026-09-04", "Alpha", "Cedar", 1, 0, true), g("2026-10-30", "Alpha", "Dune", 40, 6), g("2026-09-11", "Dune", "Alpha", 14, 21)];
  const beta = [g("2026-09-05", "Beta", "Cedar", 2, 0, true), g("2026-09-12", "Beta", "Dune", 28, 14), g("2026-10-24", "Dune", "Beta", 0, 0)];
  const { shown } = commonOpponents("Alpha", "Beta", alpha, beta, "2026-11-13");
  const cedar = shown.find((s) => s.opponent === "Cedar");
  assert.deepEqual([cedar.a, cedar.b], [["Forfeit"], ["Forfeit"]]);
  assert.doesNotMatch(JSON.stringify(shown), /\b[12]–0\b|\b0–[12]\b/);
  const dune = shown.find((s) => s.opponent === "Dune");
  assert.deepEqual(dune.a, ["21–14", "40–6"]);
  assert.deepEqual(dune.b, ["28–14", "0–0"]);
});

test("common opponents: not each other, nothing from the game's own night or later, spelling and case do not matter", () => {
  const alpha = [g("2026-09-04", "Alpha", "Beta", 20, 10), g("2026-09-11", "Alpha", "Cedar", 21, 7), g("2026-11-13", "Alpha", "Dune", 30, 0)];
  const beta = [g("2026-09-04", "Alpha", "Beta", 20, 10), g("2026-09-12", "CEDAR", "Beta", 3, 9), g("2026-11-13", "Dune", "Beta", 1, 2)];
  const { shown } = commonOpponents("Alpha", "Beta", alpha, beta, "2026-11-13");
  assert.deepEqual(shown.map((s) => s.opponent), ["Cedar"]); // Beta and Alpha are not each other's common opponent; Dune is tonight's
  assert.deepEqual(commonOpponents("Alpha", "Beta", [], [], "2026-11-13"), { shown: [], rest: 0 });
  assert.deepEqual(commonOpponents("Alpha", "Beta", alpha, [], "2026-11-13"), { shown: [], rest: 0 });
});

test("common opponents: capped, with a count of the rest", () => {
  const names = Array.from({ length: 11 }, (_, i) => `Team ${String.fromCharCode(65 + i)}`);
  const mk = (team) => names.map((n, i) => g(`2026-09-${String(i + 1).padStart(2, "0")}`, team, n, 10 + i, 3));
  const all = commonOpponents("Alpha", "Beta", mk("Alpha"), mk("Beta"), "2026-11-13", 8);
  assert.equal(all.shown.length, 8);
  assert.equal(all.rest, 3);
  assert.equal(all.shown[0].opponent, "Team K"); // newest first
  const none = commonOpponents("Alpha", "Beta", mk("Alpha"), mk("Beta"), "2026-11-13", 20);
  assert.deepEqual([none.shown.length, none.rest], [11, 0]);
});
