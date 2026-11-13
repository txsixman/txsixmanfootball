// The cross-file data checks (data-integrity.mjs): each hard rule fails on the row that breaks it and passes on the
// rows that look like it but are fine; soft rules warn; history only warns; exceptions excuse and go stale.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkIntegrity, reportIntegrity } from "./check-data.mjs";
import { applyExceptions, checkSeason, mondayOf } from "./data-integrity.mjs";

const game = (game_date, home, away, home_score = "", away_score = "", extra = {}) => ({
  division: "I", round: "season", game_date, home, away, neutral: "false", home_score, away_score, end_reason: home_score === "" ? "" : "unknown", end_period: "", ...extra,
});
const playoff = (league, division, round, ...rest) => ({ ...game(...rest), league, division, round, neutral: "" });
const PROGRAMS = new Set(["jayton", "guthrie", "kress", "spur", "paducah", "motley-county", "ira", "loraine"]);
const run = (games, playoffs = [], extra = {}) =>
  checkSeason({ season: 2026, current: true, games, playoffs, programs: PROGRAMS, today: "2026-11-13", ...extra });
const hard = (out) => out.hard.map((h) => h.text).join("\n");

test("clean data has no problem", () => {
  const out = run([game("2026-09-04", "Jayton", "Guthrie", "52", "6"), game("2026-09-11", "Kress", "Jayton", "30", "40")]);
  assert.deepEqual(out, { hard: [], soft: [] });
});

test("a program with two games on one date fails; a forfeit or a 0-0 beside a played game does not", () => {
  assert.match(hard(run([game("2026-09-04", "Jayton", "Guthrie", "52", "6"), game("2026-09-04", "Kress", "Jayton", "30", "40")])), /jayton has 2 games on 2026-09-04/);
  assert.equal(run([game("2026-09-04", "Jayton", "Guthrie", "2", "0"), game("2026-09-04", "Kress", "Jayton", "30", "40")]).hard.length, 0);
  assert.equal(run([game("2026-09-04", "Jayton", "Guthrie", "0", "0"), game("2026-09-04", "Kress", "Jayton", "30", "40")]).hard.length, 0);
  // A playoff game is in both files: one game, not two.
  const both = game("2026-11-13", "Jayton", "Guthrie", "52", "6");
  assert.equal(run([both], [playoff("UIL", "II", "bi-district", "2026-11-13", "Guthrie", "Jayton", "6", "52")]).hard.length, 0);
});

test("a played playoff game must be in games.csv with the same score, either way round", () => {
  const p = playoff("UIL", "II", "bi-district", "2026-11-13", "Jayton", "Guthrie", "52", "6");
  assert.match(hard(run([], [p])), /playoff game not in games\.csv/);
  assert.match(hard(run([game("2026-11-13", "Guthrie", "Jayton", "6", "50")], [p])), /playoff score 6-52 but games\.csv has 6-50/);
  assert.equal(run([game("2026-11-13", "Guthrie", "Jayton", "6", "52")], [p]).hard.length, 0);
  // Not played yet: nothing to match.
  assert.equal(run([], [playoff("UIL", "II", "area", "2026-11-20", "Jayton", "Kress")]).hard.length, 0);
});

test("a later round's teams came out of the round before, by the score, confirmed or not", () => {
  const r1 = [playoff("UIL", "II", "bi-district", "2026-11-13", "Jayton", "Guthrie", "52", "6"), playoff("UIL", "II", "bi-district", "2026-11-13", "Kress", "Spur", "20", "30")];
  const games = r1.map((r) => ({ ...r, round: "season" }));
  assert.equal(run(games, [...r1, playoff("UIL", "II", "area", "2026-11-20", "Jayton", "Spur")]).hard.length, 0);
  assert.match(hard(run(games, [...r1, playoff("UIL", "II", "area", "2026-11-20", "Jayton", "Kress")])), /Kress is in the area but lost its bi-district game/);
  const tie = [playoff("UIL", "II", "bi-district", "2026-11-13", "Jayton", "Guthrie", "20", "20")];
  assert.match(hard(run(tie.map((r) => ({ ...r, round: "season" })), [...tie, playoff("UIL", "II", "area", "2026-11-20", "Jayton", "Ira")])), /tied its bi-district game/);
  // Another bracket's rounds are not this one's.
  assert.equal(run(games, [...r1, playoff("UIL", "I", "area", "2026-11-20", "Kress", "Ira")]).hard.length, 0);
});

test("a round's team with no earlier game is a bye while the bracket has byes, a warning past that", () => {
  const r1 = ["Jayton", "Kress", "Paducah"].map((h, i) => playoff("TAIAO", "1", "round-1", "2026-11-06", h, ["Guthrie", "Spur", "Ira"][i], "40", "10"));
  const games = r1.map((r) => ({ ...r, round: "season" }));
  // Three games, a bracket of four: one bye.
  const qf = [playoff("TAIAO", "1", "quarterfinal", "2026-11-13", "Jayton", "Kress"), playoff("TAIAO", "1", "quarterfinal", "2026-11-13", "Paducah", "Loraine")];
  assert.deepEqual(run(games, [...r1, ...qf]), { hard: [], soft: [] });
  const two = run(games, [...r1, playoff("TAIAO", "1", "quarterfinal", "2026-11-13", "Motley County", "Loraine")]);
  assert.equal(two.hard.length, 0);
  assert.match(two.soft.join("\n"), /2 team\(s\) in the quarterfinal with no round-1 game listed, 1 bye/);
  // Next round scheduled before the last one's score is in: a warning, not a failure.
  const unscored = [playoff("TAIAO", "1", "round-1", "2026-11-06", "Jayton", "Guthrie")];
  const late = run([], [...unscored, playoff("TAIAO", "1", "quarterfinal", "2026-11-13", "Jayton", "Kress")]);
  assert.equal(late.hard.length, 0);
  assert.match(late.soft.join("\n"), /Jayton plays the quarterfinal but its round-1 game has no score yet/);
});

test("scores are 0 to 200, and a forfeit's reason matches its score", () => {
  assert.match(hard(run([game("2026-09-04", "Jayton", "Guthrie", "201", "6")])), /not a whole number 0 to 200/);
  assert.match(hard(run([game("2026-09-04", "Jayton", "Guthrie", "52", "6", { end_reason: "forfeit" })])), /marked forfeit but not recorded 1-0 or 2-0/);
  assert.match(hard(run([game("2026-09-04", "Jayton", "Guthrie", "2", "0", { end_reason: "regulation" })])), /forfeit's score \(1-0 or 2-0\) marked regulation/);
  assert.equal(run([game("2026-09-04", "Jayton", "Guthrie", "0", "1", { end_reason: "forfeit" })]).hard.length, 0);
  assert.equal(run([game("2026-09-04", "Jayton", "Guthrie", "2", "0")]).hard.length, 0); // robot rows say "unknown"
});

test("every team is a program in the alignments", () => {
  assert.match(hard(run([game("2026-09-04", "Jayton", "Nowhere Prep", "52", "6")])), /team not in the alignments.*Nowhere Prep/);
  assert.equal(run([game("2026-09-04", "JAYTON", "Motley County", "52", "6")]).hard.length, 0); // by slug
});

test("soft: a margin over 90, a score more than 3 days ahead, an idle program, a playoff game out of its round's week", () => {
  assert.match(run([game("2026-09-04", "Jayton", "Guthrie", "92", "0")]).soft.join(), /margin over 90/);
  assert.equal(run([game("2026-09-04", "Jayton", "Guthrie", "90", "0")]).soft.length, 0);
  assert.match(run([game("2026-11-17", "Jayton", "Guthrie", "52", "6")]).soft.join(), /more than 3 days ahead/);
  assert.equal(run([game("2026-11-16", "Jayton", "Guthrie", "52", "6")]).soft.length, 0);
  // Week 1 is the week of 2026-08-20; week 5 starts 2026-09-14. Only Jayton and Guthrie played after it.
  const idle = run([game("2026-08-20", "Kress", "Spur", "20", "10"), game("2026-10-02", "Jayton", "Guthrie", "52", "6")], [], {
    programs: new Set(["jayton", "guthrie", "kress", "spur"]),
  });
  assert.match(idle.soft.join(), /2 program\(s\) with no game after week 4: kress, spur/);
  assert.equal(run([game("2026-08-20", "Kress", "Spur", "20", "10")], [], { programs: new Set(["kress", "spur"]), today: "2026-09-13" }).soft.length, 0);
  const rounds = [
    playoff("UIL", "II", "bi-district", "2026-11-13", "Jayton", "Guthrie"),
    playoff("UIL", "II", "bi-district", "2026-11-14", "Kress", "Spur"),
    playoff("UIL", "II", "bi-district", "2026-11-19", "Paducah", "Ira"),
  ];
  assert.match(run([], rounds).soft.join(), /UIL bi-district: outside the round's usual week \(of 2026-11-09\).*Ira at Paducah/);
  assert.equal(mondayOf("2026-11-15"), "2026-11-09");
});

test("an earlier season only warns, and only for what would fail today", () => {
  const out = checkSeason({
    season: 2023, current: false, today: "2026-11-13",
    games: [game("2023-09-04", "Jayton", "Guthrie", "52", "6"), game("2023-09-04", "Kress", "Jayton", "99", "0")],
    playoffs: [],
  });
  assert.equal(out.hard.length, 0);
  assert.equal(out.soft.length, 1);
  assert.match(out.soft[0], /^2023 \(history\): jayton has 2 games/);
});

test("exceptions excuse a known problem and fail once they match nothing", () => {
  const problems = [{ key: "two-games 2026-08-20 jayton", text: "jayton has 2 games" }, { key: "other", text: "something else" }];
  const known = { key: "two-games 2026-08-20 jayton", reason: "listed twice by the source", reviewed: "2026-11-13" };
  assert.deepEqual(applyExceptions(problems, [known]), { failures: ["something else"], excused: ["jayton has 2 games [known: listed twice by the source]"] });
  assert.deepEqual(applyExceptions([], [known]).failures, ["stale exception in data/integrity-exceptions.json (no such problem now; remove it): two-games 2026-08-20 jayton"]);
});

test("the repo's data passes the hard checks today", () => {
  const { failures } = checkIntegrity("2026-11-13");
  assert.deepEqual(failures, []);
});

test("blocking mode (CI, check.sh): a hard failure exits 1; warnings alone exit 0", () => {
  const quiet = () => {};
  assert.equal(reportIntegrity({ failures: ["jayton has 2 games"], warnings: [], excused: [] }, {}, quiet), 1);
  assert.equal(reportIntegrity({ failures: [], warnings: ["margin over 90"], excused: ["known"] }, {}, quiet), 0);
});

test("report mode (Results watch): a hard failure is written down and the summary says so, but the push is not blocked", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "integrity-"));
  const env = { INTEGRITY: "report", INTEGRITY_REPORT: path.join(dir, "failures.txt"), GITHUB_STEP_SUMMARY: path.join(dir, "summary.md") };
  const lines = [];
  const result = { failures: ["jayton has 2 games on 2026-09-04", "playoff game not in games.csv"], warnings: ["margin over 90"], excused: [] };
  assert.equal(reportIntegrity(result, env, (l) => lines.push(l)), 0);
  assert.equal(readFileSync(env.INTEGRITY_REPORT, "utf8"), "jayton has 2 games on 2026-09-04\nplayoff game not in games.csv\n");
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), /Failed \(reported; pushed anyway, the job fails at the end\).*- jayton has 2 games.*Warnings.*margin over 90/s);
  assert.match(lines.join("\n"), /BAD  integrity: jayton has 2 games.*2 cross-file check\(s\) failed \(report mode: not blocking/s);
  // Nothing failed: no file, so the workflow's last step passes.
  const clean = { ...env, INTEGRITY_REPORT: path.join(dir, "none.txt") };
  assert.equal(reportIntegrity({ failures: [], warnings: [], excused: [] }, clean, () => {}), 0);
  assert.equal(existsSync(clean.INTEGRITY_REPORT), false);
});

test("report mode without a file to report to blocks rather than letting a failure pass unseen", () => {
  const lines = [];
  assert.equal(reportIntegrity({ failures: ["x"], warnings: [], excused: [] }, { INTEGRITY: "report" }, (l) => lines.push(l)), 1);
  assert.match(lines.at(-1), /needs INTEGRITY_REPORT/);
});
