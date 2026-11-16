// One recorded State Championship updates the champions everywhere (ADR 0083): finalOf names the champion, withRecorded
// fills the UIL list, appearancesOf and championLine count the title. Invented schools only.
//   node --test apps/web/scripts/state-finals.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { appearancesOf, championLine, finalOf, withRecorded } from "../lib/state-finals.ts";

const game = (over = {}) => ({
  league: "TAPPS", bracket: "TAPPS Division I", division: "I", round: "final", date: "2026-12-05",
  home: "Alder Prep", away: "Birch Academy", homeScore: 52, awayScore: 20, forfeit: false, confirmed: true, ...over,
});

test("finalOf names the champion, runner-up and score of a confirmed played final", () => {
  const f = finalOf(2026, game());
  assert.equal(f.champion, "Alder Prep");
  assert.equal(f.runnerUp, "Birch Academy");
  assert.equal(f.championScore, 52);
  assert.equal(f.runnerUpScore, 20);
  assert.equal(f.season, 2026);
  assert.equal(f.bracket, "TAPPS Division I");
});

test("finalOf names an away winner, and UIL's last round is 'state'", () => {
  const f = finalOf(2026, game({ league: "UIL", bracket: "UIL Division II", division: "II", round: "state", homeScore: 14, awayScore: 21 }));
  assert.equal(f.champion, "Birch Academy");
  assert.equal(f.championScore, 21);
  assert.equal(f.runnerUpScore, 14);
});

test("finalOf names no champion for an unplayed, disputed or tied game or an earlier round", () => {
  assert.equal(finalOf(2026, game({ homeScore: undefined, awayScore: undefined })), undefined);
  assert.equal(finalOf(2026, game({ confirmed: false })), undefined);
  assert.equal(finalOf(2026, game({ homeScore: 21, awayScore: 21 })), undefined);
  assert.equal(finalOf(2026, game({ round: "semifinal" })), undefined);
});

test("a forfeit names its winner with no score", () => {
  const f = finalOf(2026, game({ forfeit: true, homeScore: 0, awayScore: 1 }));
  assert.equal(f.champion, "Birch Academy");
  assert.equal(f.forfeit, true);
  assert.equal("championScore" in f, false);
  assert.equal("runnerUpScore" in f, false);
});

const archive = (season, division, champion) => ({
  season, conference: "1A", division, champion, runnerUp: "Old Runner", championScore: 40, runnerUpScore: 7, scoreNote: "", notes: "",
});

test("withRecorded adds a recorded UIL final the archive lacks, in season order", () => {
  const recorded = [finalOf(2026, game({ league: "UIL", bracket: "UIL Division I", division: "I", round: "state" }))];
  const list = withRecorded([archive(2025, "I", "Cedar Valley")], recorded);
  assert.deepEqual(list.map((f) => `${f.season}${f.division}`), ["2025I", "2026I"]);
  const added = list.at(-1);
  assert.equal(added.champion, "Alder Prep");
  assert.equal(added.championScore, 52);
  assert.equal(added.runnerUpScore, 20);
});

test("withRecorded keeps the archive's row when both list the season and division", () => {
  const recorded = [finalOf(2026, game({ league: "UIL", bracket: "UIL Division I", division: "I", round: "state" }))];
  const list = withRecorded([archive(2026, "I", "Cedar Valley")], recorded);
  assert.equal(list.length, 1);
  assert.equal(list[0].champion, "Cedar Valley");
});

test("withRecorded ignores private leagues", () => {
  const list = withRecorded([archive(2025, "I", "Cedar Valley")], [finalOf(2026, game())]);
  assert.equal(list.length, 1);
});

test("one recorded final adds the title to appearancesOf and championLine", () => {
  const before = [];
  const after = [finalOf(2026, game())];
  const titles = (finals) => appearancesOf("Alder Prep", finals).filter((a) => a.won).length;
  assert.equal(titles(before), 0);
  assert.equal(titles(after), titles(before) + 1);
  const [a] = appearancesOf("Alder Prep", after);
  assert.deepEqual([a.season, a.bracket, a.won, a.opponent, a.score], [2026, "TAPPS Division I", true, "Birch Academy", "52-20"]);
  const [b] = appearancesOf("Birch Academy", after);
  assert.equal(b.won, false);
  assert.equal(b.opponent, "Alder Prep");

  assert.equal(championLine("Alder Prep", 2026, before), undefined);
  assert.equal(championLine("Alder Prep", 2026, after), "2026 State Champion");
  assert.equal(championLine("Alder Prep", 2026, after, true), "2026 TAPPS Division I State Champion");
  assert.equal(championLine("Birch Academy", 2026, after), undefined);
  assert.equal(championLine("Alder Prep", 2027, after), undefined);
});

test("appearancesOf counts a renamed school's title under the program it became", () => {
  const finals = [finalOf(2026, game({ home: "Old Name", away: "Birch Academy" }))];
  const successors = new Map([["old-name", "Alder Prep"]]);
  assert.equal(appearancesOf("Alder Prep", finals, successors).filter((a) => a.won).length, 1);
});
