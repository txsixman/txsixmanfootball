// What was projected beside what happened (lib/outcome.ts, ADR 0044), and the projection a played game shows: the one from
// the week before it (lib/pregame.ts projectBefore), which rating the game itself never changes. Invented teams only.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { outcomeText, projectedLine, resultOutcome } from "../lib/outcome.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "projected-vs-result-"));
const load = async (name) => {
  const outfile = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [path.join(WEB, `lib/${name}.ts`)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
  return import(pathToFileURL(outfile).href);
};
const { projectBefore } = await load("pregame");
const { project, projectionText } = await load("projection");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const final = (homeScore, awayScore, extra = {}) => ({ home: "Alpha", away: "Beta", homeScore, awayScore, state: "final", ...extra });

test("a final reads its winner and margin beside the projection; a miss reads as one", () => {
  assert.equal(projectedLine("Alpha by 45+ · 99% chance to win", final(60, 8)), "Projected: Alpha by 45+ · 99% chance to win · Final: Alpha by 52");
  assert.equal(projectedLine("Alpha by 7 · 70% chance to win", final(20, 23)), "Projected: Alpha by 7 · 70% chance to win · Final: Beta by 3");
  assert.equal(outcomeText(final(28, 28)), "Final: tied");
});

test("a forfeit and a disputed final name no score and no winner; an unconfirmed final is reported, not called", () => {
  assert.equal(projectedLine("Alpha by 12 · 80% chance to win", final(1, 0, { forfeit: true })), "Projected: Alpha by 12 · 80% chance to win · Forfeit");
  assert.equal(projectedLine("Alpha by 12 · 80% chance to win", final(40, 20, { disputed: true })), "Projected: Alpha by 12 · 80% chance to win · Disputed");
  assert.equal(outcomeText(final(40, 20, { unconfirmed: true })), "Reported: 20–40 · Unconfirmed");
});

test("a game under way shows its live score with no leader named; a game not started shows the projection alone", () => {
  assert.equal(projectedLine("Alpha by 7 · 70% chance to win", { home: "Alpha", away: "Beta", homeScore: 14, awayScore: 28, state: "live" }), "Projected: Alpha by 7 · 70% chance to win · Now: 28–14 · Unconfirmed");
  assert.equal(outcomeText({ home: "Alpha", away: "Beta", homeScore: 7, awayScore: 7, state: "live" }), "Now: tied");
  assert.equal(projectedLine("Alpha by 7 · 70% chance to win", { home: "Alpha", away: "Beta", state: "scheduled" }), "Projected: Alpha by 7 · 70% chance to win");
  assert.equal(projectedLine(undefined, final(40, 20)), undefined); // no projection, no line
});

test("a robot-read result's outcome carries its forfeit and dispute", () => {
  const r = { home: "Alpha", away: "Beta", homeScore: 2, awayScore: 0, forfeit: true };
  assert.equal(outcomeText(resultOutcome(r)), "Forfeit");
  assert.equal(outcomeText(resultOutcome({ ...r, homeScore: 30, forfeit: false }, true)), "Disputed");
  assert.equal(outcomeText(resultOutcome({ ...r, homeScore: 30, forfeit: false })), "Final: Alpha by 30");
});

test("no line uses a betting word or an upset label", () => {
  const lines = [
    projectedLine("Alpha by 7 · 70% chance to win", final(20, 23)),
    projectedLine("Alpha by 7 · 70% chance to win", final(40, 20, { disputed: true })),
    projectedLine("Alpha by 7 · 70% chance to win", { home: "Alpha", away: "Beta", homeScore: 14, awayScore: 28, state: "live" }),
  ].join(" ");
  assert.doesNotMatch(lines.replace(/chance to win/g, ""), /\b(upset|spread|line|odds|cover|covers|bet|pick|lock|win|wins|winner|beat|beats)\b/i);
});

// A season's table: current ratings (which count every game read) and the trend, each week's ratings through its Sunday.
const table = {
  sigma: 15,
  home_field: 4,
  weeks: ["2030-09-08", "2030-09-15"],
  week_sigma: [13, 14],
  week_home_field: [2, 2.5],
  teams: [
    { team: "Alpha", rating: 30, trend: [10, 12] },
    { team: "Beta", rating: -20, trend: [5, 4] },
    { team: "Gamma", rating: 0, trend: [null, 1] },
  ],
};
const game = { date: "2030-09-18", home: "Alpha", away: "Beta" };

test("a played game is projected from the week before it, never from today's ratings", () => {
  const before = projectBefore(table, game, false);
  assert.equal(before.favorite, "Alpha");
  assert.equal(before.margin, 12 - 4 + 2.5); // the week ending 2030-09-15: its ratings and its home edge
  assert.notEqual(projectionText(before), projectionText(project(table, "Alpha", "Beta", false))); // today's would say more
  assert.equal(projectBefore(table, { ...game, date: "2030-09-07" }, false), undefined); // before the trend starts
  assert.equal(projectBefore(table, { date: "2030-09-12", home: "Gamma", away: "Alpha" }, false), undefined); // Gamma unrated that week
});

test("a played game's projection does not change once its own result, and later ones, are rated", () => {
  const before = projectionText(projectBefore(table, game, false));
  // The game is read and rated: the current ratings, the current home edge and spread move, and a week is added.
  const rated = {
    ...table,
    sigma: 16,
    home_field: 1,
    weeks: [...table.weeks, "2030-09-22", "2030-09-29"],
    week_sigma: [...table.week_sigma, 16, 17],
    week_home_field: [...table.week_home_field, 1, 0],
    teams: [
      { team: "Alpha", rating: -10, trend: [10, 12, -10, -12] },
      { team: "Beta", rating: 40, trend: [5, 4, 40, 41] },
      { team: "Gamma", rating: 3, trend: [null, 1, 2, 3] },
    ],
  };
  assert.equal(projectionText(projectBefore(rated, game, false)), before);
  assert.notEqual(projectionText(project(rated, "Alpha", "Beta", false)), before);
});
