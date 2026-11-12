import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRows, noFinalRows, parseArchive, sixMan, splitScore, toCsv, toRows } from "./uil-champions.mjs";

// The table shape uiltexas.org/football/archives served on Nov 10, 2026, with invented schools.
const row = (years, conf, champ, runner, score) =>
  `<tr>\n<td>${years}</td>\n<td><strong>${conf}</strong></td>\n<td><strong><a href="x">${champ}</a></strong></td>\n<td><a href="y">${runner}</a></td>\n<td><a href="z">${score}</a></td>\n<td><a href="b">Playoff Bracket</a></td>\n<td></td>\n</tr>`;
const page = (...rows) =>
  `<table><thead><tr><th>Year</th><th>Conference</th><th>Champion</th><th>Runner-Up</th><th>Score</th><th>Playoff Bracket</th><th>Notes</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;

test("reads every final on a page and decodes names", () => {
  const finals = parseArchive(page(
    row("2025-2026", "1A Six-Man Division 1", "Cedar Gap", "Salt Fork", "69-22 - Mercy Rule 3Q"),
    row("1972-1973", "1A Six-Man", "O&#8217;Dell", "Dry Wash", "60-14 (boxscore not available)"),
    row("2025-2026", "6A Division 1", "Big City", "Bigger City", "21-7"),
  ));
  assert.equal(finals.length, 3);
  assert.equal(finals[1].champion, "O'Dell");
  assert.equal(finals[0].season, 2025);
  assert.throws(() => parseArchive("<table></table>"), /header changed/);
});

test("keeps six-man only, with class and division", () => {
  assert.deepEqual(sixMan("1A Six-Man Division 2"), { conference: "1A", division: "II" });
  assert.deepEqual(sixMan("1A Six-Man"), { conference: "1A", division: "" });
  assert.equal(sixMan("2A Division 1"), null);
});

test("splits a score from its note", () => {
  assert.deepEqual(splitScore("69-22 - Mercy Rule 3Q"), [69, 22, "Mercy Rule 3Q"]);
  assert.deepEqual(splitScore("43-12 (boxscore not available)"), [43, 12, ""]);
  assert.deepEqual(splitScore("62-16: Mercy Rule-Halftime"), [62, 16, "Mercy Rule-Halftime"]);
  assert.deepEqual(splitScore("Forfeit"), [null, null, "Forfeit"]);
});

test("a season with no state final is its own record, not a final", () => {
  const finals = [
    { season: 1950, conference: "1A Six-Man", champion: "None", runnerUp: "", score: "Played to Bi-District (boxscore not available)", notes: "" },
    { season: 1980, conference: "1A Six-Man", champion: "Cedar Gap", runnerUp: "Salt Fork", score: "40-26", notes: "" },
  ];
  assert.equal(toRows(finals, () => "u").length, 1);
  assert.equal(toRows(finals, () => "u", { "Cedar Gap": "Cedar Gap-Mesa" })[0].champion, "Cedar Gap-Mesa");
  assert.deepEqual(noFinalRows(finals, () => "u"), [{ season: 1950, conference: "1A", playedTo: "bi-district", source: "u" }]);
});

test("checks fail loudly, and the CSV has one line a final", () => {
  const ok = Array.from({ length: 40 }, (_, i) => ({ season: 1980 + i, conference: "1A", division: "", champion: "A", runnerUp: "B", champ: 30, runner: 20, note: "", notes: "", source: "u" }));
  assert.doesNotThrow(() => checkRows(ok));
  assert.throws(() => checkRows([...ok, ok[0]]), /two finals for 1980/);
  assert.throws(() => checkRows([...ok.slice(1), { ...ok[0], champ: 10 }]), /champion scored less/);
  assert.throws(() => checkRows(ok.slice(0, 5)), /only 5/);
  assert.equal(toCsv(ok.slice(0, 1)).trim().split("\n")[1], "1980,1A,,A,B,30,20,,,u");
});
