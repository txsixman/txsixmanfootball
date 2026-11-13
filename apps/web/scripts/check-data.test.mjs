// The Zod data checks (lib/data-schemas.ts): bad rows fail with their file and line, good rows pass, and every file in
// the repo passes today.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as s from "../lib/data-schemas.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkAll, checkMaxprepsFolders } from "./check-data.mjs";

// Robot-read games as this repo holds them: the facts, no source column (data-schemas.ts RESULT_COLUMNS).
const HEADER = s.RESULT_COLUMNS.join(",");
const good = "I,season,2026-09-04,Jayton,Guthrie,false,52,6,mercy_half,";
const games = (...lines) => [HEADER, ...lines].join("\n");
const fails = (csv, pattern) => assert.throws(() => s.parseCsv("games.csv", csv, s.RESULT_COLUMNS, s.PlayedGameRow), pattern);
// Hand captures keep their source column.
const HAND = s.GAME_COLUMNS.join(",");

test("a good played game passes", () => {
  const [{ row, line }] = s.parseCsv("games.csv", games(good), s.RESULT_COLUMNS, s.PlayedGameRow);
  assert.equal(row.home, "Jayton");
  assert.equal(line, 2);
});

test("bad game rows fail loudly, naming the file and line", () => {
  fails(games(good.replace("52", "5x")), /games\.csv: 1 bad row.*line 2: home_score/s);
  fails(games(good.replace("Guthrie", "Jayton")), /cannot play itself/);
  fails(games(good.replace("2026-09-04", "2026-13-40")), /game_date/);
  fails(games(good.replace("season", "playoff")), /round/);
  fails(games(good.replace(",52,6,", ",52,,")), /both scores or neither/);
  fails(games(good.replace(",52,6,", ",,,")), /played games only/);
  fails(games(good.replace("mercy_half", "kneel")), /end_reason/);
  fails(games(`${good},extra`), /11 fields, expected 10/);
  const hand = "II,semifinal,2026-12-05,Jayton,Guthrie,,52,6,regulation,,not a url,";
  assert.throws(() => s.parseCsv("p.csv", `${HAND}\n${hand}`, s.GAME_COLUMNS, s.PlayoffRow), /source_url/);
  fails(`${HEADER.replace("home,away", "away,home")}\n${good}`, /header is/);
});

test("every bad row is listed, not just the first", () => {
  fails(games(good, good.replace("52", "x"), good.replace("6,mercy", "y,mercy")), /2 bad row.*line 3.*line 4/s);
});

test("an unplayed playoff game needs no score; a robot playoff row needs a known league", () => {
  const unplayed = "II,semifinal,2026-12-05,Jayton,Guthrie,,,,,,https://example.com/g,";
  assert.equal(s.parseCsv("p.csv", `${HAND}\n${unplayed}`, s.GAME_COLUMNS, s.PlayoffRow).length, 1);
  const robot = ["league," + HEADER, "XYZ,II,semifinal,2026-12-05,Jayton,Guthrie,,,,,"].join("\n");
  assert.throws(() => s.parseCsv("p.csv", robot, ["league", ...s.RESULT_COLUMNS], s.RobotPlayoffRow), /league/);
});

test("a ratings table with a bad number fails", () => {
  const table = { season: 2026, games: 1, teams: [{ team: "Jayton", rating: "high", rated: 1, won: 1, lost: 0, tied: 0 }] };
  assert.throws(() => s.parseJson("2026.json", JSON.stringify(table), s.RatingsTable), /teams\.0\.rating/);
  assert.throws(() => s.parseJson("2026.json", "{", s.RatingsTable), /not JSON/);
});

test("colors must be hex; notes are allowed", () => {
  assert.doesNotThrow(() => s.parseJson("c.json", JSON.stringify({ _note: "how", red: "#bf1e2e" }), s.ColorsFile));
  assert.throws(() => s.parseJson("c.json", JSON.stringify({ red: "crimson" }), s.ColorsFile), /#rrggbb/);
});

const scores = { accuracy: 0.85, mae: 14.2, log_loss: 0.36, brier: 0.1 };
const methods = { model: scores, elo: scores, last_season: scores, model_no_prior: scores };
const split = { label: "2022", games: 12, said: 0.86, happened: 0.85, bands: [{ from: 0.5, to: 0.6, games: 12, said: 0.86, happened: 0.85 }] };
const scorecard = { bands: [0.5, 1], season: [split], phase: [split], league: [split] };
const backtest = { scorecard, seasons: [{ season: 2021, games: 10, ...methods, last_season: null }, { season: 2022, games: 12, ...methods }], overall_from_2022: { games: 12, ...methods } };

test("a backtest file passes; a bad accuracy, a missing method or an empty season list fails", () => {
  assert.doesNotThrow(() => s.parseJson("backtest.json", JSON.stringify(backtest), s.BacktestFile));
  const bad = (edit) => JSON.stringify(edit(structuredClone(backtest)));
  assert.throws(() => s.parseJson("b.json", bad((b) => ((b.seasons[1].model.accuracy = 85), b)), s.BacktestFile), /seasons\.1\.model\.accuracy/);
  assert.throws(() => s.parseJson("b.json", bad((b) => (delete b.seasons[1].elo, b)), s.BacktestFile), /seasons\.1\.elo/);
  assert.throws(() => s.parseJson("b.json", bad((b) => ((b.seasons = []), b)), s.BacktestFile), /seasons/);
  assert.throws(() => s.parseJson("b.json", bad((b) => (delete b.overall_from_2022, b)), s.BacktestFile), /overall_from_2022/);
  assert.throws(() => s.parseJson("b.json", bad((b) => (delete b.scorecard, b)), s.BacktestFile), /scorecard/);
  assert.throws(() => s.parseJson("b.json", bad((b) => ((b.scorecard.phase[0].happened = 85), b)), s.BacktestFile), /scorecard\.phase\.0\.happened/);
});

test("the aliases file maps spellings to names; a non-string value fails", () => {
  assert.doesNotThrow(() => s.parseJson("a.json", JSON.stringify({ _note: "x", Mozella: "Mozelle" }), s.AliasesFile));
  assert.throws(() => s.parseJson("a.json", JSON.stringify({ Mozella: 3 }), s.AliasesFile), /Mozella/);
});

test("every data file in the repo passes", () => {
  const bad = checkAll().filter((r) => !r.ok);
  assert.deepEqual(bad, []);
});

test("a robot-read folder holds games.csv and playoffs.csv only; a capture or an oddly named folder fails", () => {
  const seedDir = mkdtempSync(path.join(tmpdir(), "seed-"));
  const put = (f) => {
    mkdirSync(path.dirname(path.join(seedDir, f)), { recursive: true });
    writeFileSync(path.join(seedDir, f), "x\n");
  };
  for (const f of ["maxpreps-2019/games.csv", "maxpreps-2019/playoffs.csv", "maxpreps-2019/.DS_Store", "maxpreps-2020/games.csv", "uil-2026-28/alignments.csv"]) put(f);
  assert.deepEqual(checkMaxprepsFolders(seedDir), []);
  for (const f of ["maxpreps-2020/teams.csv", "maxpreps-2020/pages/a.html", "maxpreps-2020-old/coverage.txt"]) put(f);
  const bad = checkMaxprepsFolders(seedDir);
  assert.deepEqual(bad.map((r) => [r.file, r.ok]), [["data/seed/maxpreps-2020", false], ["data/seed/maxpreps-2020-old", false]]);
  assert.match(bad[0].note, /only games\.csv and playoffs\.csv.*: pages, teams\.csv$/);
  assert.match(bad[1].note, /maxpreps-<year>/);
});
