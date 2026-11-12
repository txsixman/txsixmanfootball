// Corrections: the shared cases (the ratings' reader, services/ratings/corrections.py, runs the same table), the file
// schemas, and the rules a correction must keep (ADR 0011: no winner, never confirmed).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyToGame, buildCorrections, NO_CORRECTIONS, resolveMerges } from "../lib/corrections.ts";
import * as s from "../lib/data-schemas.ts";
import { buildSeasonResults } from "../lib/season-results.ts";

const cases = JSON.parse(readFileSync(new URL("../lib/correction-cases.json", import.meta.url), "utf8"));
const forfeitCases = JSON.parse(readFileSync(new URL("../lib/forfeit-cases.json", import.meta.url), "utf8")).cases;
const stamp = { source_url: "https://example.com/box", reason: "box score", corrected_on: "2030-11-01" };
const build = () => buildCorrections(cases.merges.map((m) => ({ ...m, ...stamp })), cases.games.map((g) => ({ ...g, ...stamp })));

for (const c of cases.cases) {
  test(`shared case: ${c.name}`, () => {
    const [game_date, home, away, home_score, away_score, end_reason] = c.row;
    const got = applyToGame(build(), { game_date, home, away, home_score, away_score, end_reason });
    if (c.expect === null) return assert.equal(got, null);
    const [h, a, hs, as, reason, corrected] = c.expect;
    assert.deepEqual(got, { row: { game_date, home: h, away: a, home_score: hs, away_score: as, end_reason: reason }, corrected });
  });
}

test("with no corrections a row comes back untouched, not even copied", () => {
  const row = { game_date: "2030-09-05", home: "Alpha", away: "Beta", home_score: "40", away_score: "20", end_reason: "regulation" };
  const got = applyToGame(NO_CORRECTIONS, row);
  assert.equal(got.row, row);
  assert.equal(got.corrected, false);
});

test("a merge into a merged name, or a loop, is refused", () => {
  const rows = (...pairs) => pairs.map(([name, same_as]) => ({ name, same_as, ...stamp }));
  assert.throws(() => resolveMerges(rows(["A", "B"], ["B", "C"])), /itself merged/);
  assert.throws(() => resolveMerges(rows(["A", "B"], ["B", "A"])), /itself merged/);
  assert.equal(resolveMerges(rows(["A", "B"], ["C", "B"])).size, 2);
});

const HEADER = s.GAME_CORRECTION_COLUMNS.join(",");
const line = (over = {}) => {
  const row = { game_date: "2026-09-04", home: "Jayton", away: "Guthrie", action: "score", home_score: "52", away_score: "6", ...stamp, ...over };
  return s.GAME_CORRECTION_COLUMNS.map((c) => row[c]).join(",");
};
const parse = (...lines) => s.parseCsv("games.csv", [HEADER, ...lines].join("\n"), s.GAME_CORRECTION_COLUMNS, s.GameCorrectionRow);
const bad = (over, pattern) => assert.throws(() => parse(line(over)), pattern);

test("a good score, forfeit and void row pass", () => {
  assert.equal(parse(line(), line({ action: "forfeit", home_score: "1", away_score: "0" }), line({ action: "void", home_score: "", away_score: "" })).length, 3);
});

test("bad correction rows fail loudly", () => {
  bad({ home_score: "201" }, /0 to 200/);
  bad({ home_score: "5x" }, /home_score/);
  bad({ source_url: "http://example.com/x" }, /source_url/);
  bad({ source_url: "https://localhost/x" }, /source_url/);
  bad({ source_url: "not a url" }, /source_url/);
  bad({ reason: "" }, /reason/);
  bad({ home: "Guthrie" }, /cannot play itself/);
  bad({ action: "void" }, /no score/);
  bad({ action: "forfeit", home_score: "7", away_score: "0" }, /forfeit is recorded 1-0 or 2-0/);
  bad({ home_score: "1", away_score: "0" }, /use forfeit or void/);
  bad({ home_score: "0", away_score: "0" }, /use forfeit or void/);
  bad({ action: "winner" }, /action/);
  bad({ corrected_on: "yesterday" }, /corrected_on/);
  assert.throws(() => parse(`${line()},extra`), /fields, expected 9/);
});

test("the forfeit rule in the correction schema is the one the pages and the ratings use", () => {
  for (const [home, away, forfeit] of forfeitCases) {
    const score = (action) => parse(line({ action, home_score: String(home), away_score: String(away) }));
    if (forfeit) assert.equal(score("forfeit").length, 1, `${home}-${away}`);
    else assert.throws(() => score("forfeit"), /forfeit is recorded/, `${home}-${away}`);
    // A plain score is any real score: not a forfeit's, and not 0-0 (that is a game nobody played).
    if (forfeit || (home === 0 && away === 0)) assert.throws(() => score("score"), /use forfeit or void/, `${home}-${away}`);
    else assert.equal(score("score").length, 1, `${home}-${away}`);
  }
});

test("no field of a correction can hold a comma or line break, so the file stays plain CSV", () => {
  const row = { game_date: "2026-09-04", home: "Jayton", away: "Guthrie", action: "void", home_score: "", away_score: "", ...stamp };
  assert.equal(s.GameCorrectionRow.safeParse(row).success, true);
  for (const field of ["reason", "home", "source_url"]) {
    assert.equal(s.GameCorrectionRow.safeParse({ ...row, [field]: `${row[field]}, x` }).success, false, field);
    assert.equal(s.GameCorrectionRow.safeParse({ ...row, [field]: `${row[field]}\nx` }).success, false, `${field} newline`);
  }
  const merge = (over) => s.parseCsv("p.csv", ["name,same_as,source_url,reason,corrected_on", `${over},https://example.com/p,why,2030-01-01`].join("\n"), s.PROGRAM_MERGE_COLUMNS, s.ProgramMergeRow);
  assert.equal(merge("Faith Acad,Faith Academy").length, 1);
  assert.throws(() => merge("Same,Same"), /itself/);
});

test("a double quote is refused in every field, and the shared quote file is refused whole", () => {
  const row = { game_date: "2026-09-04", home: "Jayton", away: "Guthrie", action: "void", home_score: "", away_score: "", ...stamp };
  for (const field of ["reason", "home", "away", "source_url"]) {
    assert.equal(s.GameCorrectionRow.safeParse({ ...row, [field]: `${row[field]}"x` }).success, false, field);
    assert.equal(s.GameCorrectionRow.safeParse({ ...row, [field]: `"${row[field]}` }).success, false, `${field} leading`);
  }
  // The same lines the ratings reader is tested on (services/ratings/test_corrections.py): the site refuses them.
  const { header, lines } = cases.quoteFile;
  assert.throws(() => s.parseCsv("games.csv", [header, ...lines].join("\n"), s.GAME_CORRECTION_COLUMNS, s.GameCorrectionRow), /double quote/);
});

test("a cell a spreadsheet would run as a formula is refused: no leading = + - or @", () => {
  const row = { game_date: "2026-09-04", home: "Jayton", away: "Guthrie", action: "void", home_score: "", away_score: "", ...stamp };
  for (const lead of ["=", "+", "-", "@"]) {
    for (const field of ["reason", "home"]) {
      assert.equal(s.GameCorrectionRow.safeParse({ ...row, [field]: `${lead}SUM(A1)` }).success, false, `${field} ${lead}`);
      assert.equal(s.GameCorrectionRow.safeParse({ ...row, [field]: ` ${lead}SUM(A1)` }).success, false, `${field} ${lead} after a space`);
    }
  }
  assert.equal(s.GameCorrectionRow.safeParse({ ...row, reason: "scores 2-1 = final" }).success, true, "inside the text is fine");
});

test("a correction row has no way to name a winner or confirm a score", () => {
  assert.deepEqual(s.GAME_CORRECTION_COLUMNS, ["game_date", "home", "away", "action", "home_score", "away_score", "source_url", "reason", "corrected_on"]);
  // The row type has no winner, verification or confirmed field, and the applied row's end_reason is only "unknown" or "forfeit".
  const applied = applyToGame(build(), { game_date: "2030-09-05", home: "Alpha", away: "Beta", home_score: "40", away_score: "20", end_reason: "mercy_half" });
  assert.equal(applied.row.end_reason, "unknown");
});

// The game pages (lib/game-pages.ts) are built from these results, so what they hold is what a game page shows.
const GAMES = [
  "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period",
  "I,season,2030-09-05,Alpha,Beta,false,40,20,regulation,",
  "I,season,2030-09-12,Beta,Gamma,false,12,14,unknown,",
  "I,season,2030-09-19,Gamma,Alpha,false,7,6,unknown,",
  "I,season,2030-10-03,Faith Acad,Delta,false,28,12,unknown,",
  "I,season,2030-10-10,Echo,Delta,false,9,7,unknown,",
].join("\n");
const key = (date, a, b) => [date, ...[a, b].sort()].join("|");

test("season results carry the corrections: a voided game is gone (so it has no page), a fixed score shows, a merged name is one program", () => {
  const { results, voided } = buildSeasonResults(2030, GAMES, build(), new Map(), key);
  assert.equal(voided, 1);
  assert.deepEqual(results.map((r) => r.id), [
    "2030-09-05-beta-at-alpha",
    "2030-09-12-gamma-at-beta",
    "2030-10-03-delta-at-faith-academy",
    "2030-10-10-delta-at-echo",
  ]);
  const by = Object.fromEntries(results.map((r) => [r.id, r]));
  assert.deepEqual([by["2030-09-05-beta-at-alpha"].homeScore, by["2030-09-05-beta-at-alpha"].awayScore], [41, 20]);
  assert.equal(by["2030-09-12-gamma-at-beta"].forfeit, true); // a forfeit shows the word, never the score (ADR 0004)
  assert.equal(by["2030-10-03-delta-at-faith-academy"].home, "Faith Academy");
  assert.equal(by["2030-10-03-delta-at-faith-academy"].homeScore, 30);
  assert.equal(by["2030-10-10-delta-at-echo"].homeScore, 9); // untouched
  assert.equal(by["2030-09-05-beta-at-alpha"].href, "/scores/2030-09-05-beta-at-alpha");
  assert.equal(results.some((r) => r.date === "2030-09-19"), false);
});

test("with no corrections the results are exactly the file's rows", () => {
  const { results, voided } = buildSeasonResults(2030, GAMES, NO_CORRECTIONS, new Map(), key);
  assert.equal(results.length, 5);
  assert.equal(voided, 0);
  assert.deepEqual([results[0].homeScore, results[0].awayScore], [40, 20]);
});
