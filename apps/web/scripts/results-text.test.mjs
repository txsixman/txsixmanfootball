// A results week as plain text (lib/results-text.ts, ADR 0102): the grouping, the order, a forfeit, a score reported and
// the credit line. Invented teams only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { resultsText } from "../lib/results-text.ts";

const game = (over) => ({ date: "2026-10-30", home: "Cedar Gap", away: "Salt Fork", homeScore: 77, awayScore: 22, forfeit: false, reported: false, section: "non-district", ...over });
const week = (games, over = {}) => resultsText({ title: "UIL six-man football results, 2026 season, week 10", from: "2026-10-26", to: "2026-11-01", games, ...over });

test("a final reads 'Away 22, Home 77', after a title, the dates, and a note that the away team is first", () => {
  const lines = week([game({})]).split("\n");
  assert.deepEqual(lines.slice(0, 7), [
    "UIL six-man football results, 2026 season, week 10",
    "Games played Oct 26 to Nov 1, 2026",
    "Away team listed first.",
    "",
    "NON-DISTRICT GAMES",
    "",
    "Salt Fork 22, Cedar Gap 77",
  ]);
});

test("the file is plain text that ends with the credit line and one newline, and names no source", () => {
  const text = week([game({})]);
  assert.ok(text.endsWith("\nScores from txsixmanfootball.com\n"));
  assert.equal(text.match(/\n/g).length - text.trimEnd().match(/\n/g).length, 1);
  assert.doesNotMatch(text, /maxpreps|source|\bwon\b|winner|leading|\bline\b/i);
});

test("a forfeit never shows its recorded score: it names the team given the game, and explains the parentheses", () => {
  const home = week([game({ homeScore: 1, awayScore: 0, forfeit: true })]);
  assert.match(home, /^Salt Fork vs Cedar Gap, forfeit \(Cedar Gap\)$/m);
  const away = week([game({ homeScore: 0, awayScore: 2, forfeit: true })]);
  assert.match(away, /^Salt Fork vs Cedar Gap, forfeit \(Salt Fork\)$/m);
  assert.doesNotMatch(home + away, /^Salt Fork vs .*\d.*$/m);
  assert.match(home, /Forfeit: the team in parentheses was awarded the game\./);
  assert.doesNotMatch(week([game({})]), /Forfeit:/);
});

test("a score the sources disagree on reads 'score reported' with no score", () => {
  const text = week([game({ reported: true })]);
  assert.match(text, /^Salt Fork vs Cedar Gap, score reported$/m);
  assert.doesNotMatch(text, /22|77/);
});

test("a tie reads like any score", () => {
  assert.match(week([game({ homeScore: 14, awayScore: 14 })]), /^Salt Fork 14, Cedar Gap 14$/m);
});

test("sections run district, non-district, playoff, and an empty one is left out", () => {
  const text = week([
    game({ section: "playoff", group: "UIL Division I, Bi-district", order: 1 }),
    game({ section: "non-district", away: "Pine Rock" }),
    game({ section: "district", group: "UIL Division I, Region 1, District 2", away: "Elm Creek" }),
  ]);
  const heads = [...text.matchAll(/^(DISTRICT GAMES|NON-DISTRICT GAMES|PLAYOFF GAMES)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ["DISTRICT GAMES", "NON-DISTRICT GAMES", "PLAYOFF GAMES"]);
  assert.deepEqual([...week([game({})]).matchAll(/^([A-Z-]+ )?GAMES$/gm)].map((m) => m[0]), ["NON-DISTRICT GAMES"]);
});

test("districts are in numeric order, each with its heading, and games by date, then home, then away", () => {
  const text = week([
    game({ section: "district", group: "UIL Division I, Region 2, District 10", away: "Ash", home: "Birch" }),
    game({ section: "district", group: "UIL Division I, Region 2, District 9", away: "Oak", home: "Pine", date: "2026-10-31" }),
    game({ section: "district", group: "UIL Division I, Region 2, District 9", away: "Elm", home: "Fir", date: "2026-10-30" }),
    game({ section: "district", group: "UIL Division I, Region 2, District 9", away: "Yew", home: "Ash", date: "2026-10-30" }),
  ]);
  const body = text.slice(text.indexOf("DISTRICT GAMES")).split("\n").filter(Boolean).slice(1, -1);
  assert.deepEqual(body, [
    "UIL Division I, Region 2, District 9",
    "Yew 22, Ash 77", // Oct 30, home Ash
    "Elm 22, Fir 77", // Oct 30, home Fir
    "Oak 22, Pine 77", // Oct 31
    "UIL Division I, Region 2, District 10",
    "Ash 22, Birch 77",
  ]);
});

test("playoff games group by round, earliest round first, then by bracket; a later round never comes first", () => {
  const text = week([
    game({ section: "playoff", group: "UIL Division I, Area", order: 2, away: "A1" }),
    game({ section: "playoff", group: "UIL Division II, Bi-district", order: 1, away: "B1" }),
    game({ section: "playoff", group: "UIL Division I, Bi-district", order: 1, away: "C1" }),
  ]);
  const groups = text.split("\n").filter((l) => /^UIL Division/.test(l));
  assert.deepEqual(groups, ["UIL Division I, Bi-district", "UIL Division II, Bi-district", "UIL Division I, Area"]);
});

test("a week that crosses New Year says both years, and a week with no game says so", () => {
  assert.match(week([], { from: "2026-12-28", to: "2027-01-03" }), /^Games played Dec 28, 2026 to Jan 3, 2027$/m);
  const none = week([]);
  assert.match(none, /^No games reported this week\.$/m);
  assert.ok(none.endsWith("Scores from txsixmanfootball.com\n"));
});

test("a season whose districts are not known lists its games under GAMES, never as non-district", () => {
  const text = week([game({ section: "games" }), game({ section: "playoff", group: "UIL Division I, Area", order: 2 })]);
  assert.deepEqual([...text.matchAll(/^([A-Z-]+ )?GAMES$/gm)].map((m) => m[0]), ["GAMES", "PLAYOFF GAMES"]);
});
