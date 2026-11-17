// The game preview's pure parts (lib/preview-parts.ts, ADR 0088): a team's last five results and where the winner goes next.
// Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "game-preview-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const { lastGames, nextGame, boxOf, centralDate } = await load("preview-parts");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const game = (date, home, away, homeScore, awayScore, extra = {}) => ({ href: `/scores/${date}-${away}-at-${home}`, date, home, away, homeScore, awayScore, forfeit: false, ...extra });

test("last games: the team's own five before the date, newest first, each score from the team's side with a W, L or T", () => {
  const games = [
    game("2026-09-04", "Aldan", "Bexar", 40, 8),
    game("2026-09-11", "Corvus", "Aldan", 30, 36),
    game("2026-09-18", "Aldan", "Dunn", 12, 12),
    game("2026-09-25", "Eagle Pass", "Aldan", 50, 6),
    game("2026-10-02", "Aldan", "Fenn", 44, 0),
    game("2026-10-09", "Gorda", "Aldan", 20, 21),
    game("2026-10-09", "Gorda", "Hale", 70, 0), // not Aldan's
    game("2026-11-20", "Aldan", "Ivy", 1, 0), // on the game's day or later: not yet played
  ];
  const last = lastGames("Aldan", games, "2026-11-20");
  assert.equal(last.length, 5);
  assert.deepEqual(last.map((g) => [g.date, g.opponent, g.score, g.mark]), [
    ["2026-10-09", "Gorda", "21-20", "W"],
    ["2026-10-02", "Fenn", "44-0", "W"],
    ["2026-09-25", "Eagle Pass", "6-50", "L"],
    ["2026-09-18", "Dunn", "12-12", "T"],
    ["2026-09-11", "Corvus", "36-30", "W"],
  ]);
  assert.equal(last[0].href, "/scores/2026-10-09-Aldan-at-Gorda");
});

test("last games: a team with fewer than five shows what it has; one with none shows none; matching ignores case", () => {
  assert.deepEqual(lastGames("Aldan", [game("2026-09-04", "Aldan", "Bexar", 3, 0)], "2026-10-01").length, 1);
  assert.deepEqual(lastGames("Aldan", [], "2026-10-01"), []);
  assert.deepEqual(lastGames("Aldan", [game("2026-11-20", "Aldan", "Bexar", 3, 0)], "2026-11-20"), []);
  assert.equal(lastGames("Aldan Prep", [game("2026-09-04", "ALDAN PREP", "Bexar", 3, 0)], "2026-10-01").length, 1);
});

test("last games: a forfeit is the word with no score and no mark; a disputed final keeps its score and names no winner", () => {
  const games = [game("2026-09-04", "Aldan", "Bexar", 1, 0, { forfeit: true }), game("2026-09-11", "Corvus", "Aldan", 30, 36)];
  const last = lastGames("Aldan", games, "2026-10-01", (g) => g.home === "Corvus");
  assert.deepEqual(last.map((g) => [g.opponent, g.score, g.mark]), [
    ["Corvus", "36-30", undefined],
    ["Bexar", "Forfeit", undefined],
  ]);
  assert.ok(!JSON.stringify(last).includes("1-0"));
});

// An area bracket: G1 and G2 feed the regional final G5 (with the winner of G3 and G4 on the other side), which feeds G7.
const side = (team) => (team ? { text: team, team } : { text: "To be decided" });
const box = (id, round, feeds, a, b, extra = {}) => ({ id, round, feeds, sides: [side(a), side(b)], ...extra });
const tree = [
  box("G1", "area", [null, null], "Aldan", "Bexar"),
  box("G2", "area", [null, null], "Corvus", "Dunn"),
  box("G3", "area", [null, null], "Eagle Pass", "Fenn"),
  box("G5", "regional", ["G1", "G2"], undefined, undefined, { kickoff_utc: "2026-11-28T01:00:00Z", site: "Sterling City High School" }),
  box("G6", "regional", ["G3", "G4"], undefined, undefined),
  { id: "G7", round: "semifinal", feeds: ["G5", "G6"], sides: [{ text: "Winner of G5" }, { text: "Winner of G6" }] },
  { id: "G9", round: "area", feeds: [null, null], sides: [{ text: "Gorda", team: "Gorda" }, { text: "Bye", bye: true }] },
];

test("next game: the box this game feeds, the other side as the bracket words it, and the league's own date, kickoff and site", () => {
  const step = nextGame(tree, "area", "Aldan", "Bexar");
  assert.equal(step.round, "regional");
  assert.equal(step.other.text, "winner of Corvus and Dunn");
  assert.equal(step.other.team, undefined);
  // 7:00 PM Central on Friday, Nov 27 is Saturday in UTC: the day is the Central one.
  assert.equal(step.date, "2026-11-27");
  assert.equal(step.kickoff, "2026-11-28T01:00:00Z");
  assert.equal(step.site, "Sterling City High School");
  // The other side is read from either side of the game: the second feeder's winner meets the first's.
  assert.equal(nextGame(tree, "area", "Dunn", "Corvus").other.text, "winner of Aldan and Bexar");
});

test("next game: a side no game sets yet is the bracket's own words, and a missing date or site is left out, not guessed", () => {
  // G3's winner goes to G6, whose other side (G4) has no teams in the data.
  const step = nextGame([...tree, box("G4", "area", [null, null], undefined, undefined)], "area", "Eagle Pass", "Fenn");
  assert.equal(step.round, "regional");
  assert.equal(step.other, undefined);
  assert.deepEqual(Object.keys(step).sort(), ["round"]);
  // A named source for a side is kept as the bracket says it.
  const coded = [box("G1", "area", [null, null], "Aldan", "Bexar"), { id: "G5", round: "regional", feeds: ["G1", "G2"], sides: [{ text: "To be decided" }, { text: "Winner of G2" }] }];
  assert.equal(nextGame(coded, "area", "Aldan", "Bexar").other.text, "winner of G2");
});

test("next game: none for a State Championship, a game in no box, an unnamed pair or a winner with a bye", () => {
  const closing = [box("SF1", "semifinal", [null, null], "Aldan", "Bexar"), { id: "F", round: "final", feeds: ["SF1", "SF2"], sides: [{ text: "To be decided" }, { text: "To be decided" }] }, box("FINAL", "final", [null, null], "Gorda", "Hale")];
  assert.equal(nextGame(closing, "final", "Gorda", "Hale"), undefined);
  assert.equal(nextGame(tree, "area", "Aldan", "Eagle Pass"), undefined); // two teams that are in no one box
  assert.equal(nextGame(tree, "regional", "Aldan", "Bexar"), undefined); // right teams, wrong round
  assert.equal(boxOf(tree, "area", "Bexar", "Aldan").id, "G1"); // either way round
  const bye = [...tree, box("G10", "round-1", [null, null], "Hale", "Ivy"), { id: "G11", round: "area", feeds: ["G10", "G9"], sides: [{ text: "Hale", team: "Hale" }, { text: "Bye", bye: true }] }];
  assert.equal(nextGame(bye, "round-1", "Hale", "Ivy"), undefined);
});

test("a kickoff's day is its Central day: an evening kickoff is already the next day in UTC", () => {
  assert.equal(centralDate("2026-11-21T00:00:00Z"), "2026-11-20"); // 6:00 PM CST, Friday Nov 20
  assert.equal(centralDate("2026-11-28T01:00:00Z"), "2026-11-27"); // 7:00 PM CST, Friday Nov 27
  assert.equal(centralDate("2026-12-16T20:00:00Z"), "2026-12-16"); // 2:00 PM CST: an afternoon State Championship keeps its day
  assert.equal(centralDate("2026-09-05T01:30:00Z"), "2026-09-04"); // daylight time: 8:30 PM CDT
});
