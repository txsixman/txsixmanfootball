// The data-gaps check (data-gaps.mjs): each kind is found on the row that has it and not on rows that look like it but are
// fine; rules and the allow list make a gap known; a new gap, a stale entry or a bad entry fails; the repo's own data passes.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { CURRENT_SEASON } from "../lib/season.ts";
import { findGaps, gameKey, judgeGaps, KINDS, report } from "./data-gaps.mjs";

const S = CURRENT_SEASON;
const game = (game_date, home, away, home_score = "", away_score = "", extra = {}) => ({
  division: "II", round: "season", game_date, home, away, neutral: "false", home_score, away_score, end_reason: home_score === "" ? "" : "unknown", end_period: "", ...extra,
});
const playoff = (league, round, ...rest) => ({ ...game(...rest), league, round, neutral: "" });
const ALIGN = ["Jayton", "Guthrie", "Kress", "Spur"].map((school) => ({ league: "UIL", division: "II", region: "1", district: "1", school }));
const team = (t, rated, won, lost, tied = 0) => ({ team: t, rated, won, lost, tied });
// Clean: everyone plays, the table counts what the files hold, and every program has a logo.
const base = (over = {}) => ({
  today: `${S}-11-16`,
  alignments: ALIGN,
  seasons: [{
    season: S,
    games: [game(`${S}-09-04`, "Jayton", "Guthrie", "52", "6"), game(`${S}-09-04`, "Kress", "Spur", "30", "40")],
    playoffs: [],
    ratings: { teams: [team("Jayton", 1, 1, 0), team("Guthrie", 1, 0, 1), team("Kress", 1, 0, 1), team("Spur", 1, 1, 0)] },
  }],
  identity: { removed: [], schools: Object.fromEntries(["jayton", "guthrie", "kress", "spur"].map((p) => [p, { logo: { file: `${p}.png` } }])) },
  kickoffs: new Set(),
  sites: new Set(),
  ...over,
});
const withSeason = (patch, over = {}) => base({ ...over, seasons: [{ ...base().seasons[0], ...patch }] });
const kinds = (data) => findGaps(data).map((g) => `${g.kind}${g.rule ? " (rule)" : ""}`);

test("clean data has no gap", () => {
  assert.deepEqual(findGaps(base()), []);
});

test("no-date: an impossible date or one outside the season; no-score: a game 4 days past with no score", () => {
  assert.deepEqual(kinds(withSeason({ games: [...base().seasons[0].games, game(`${S}-02-30`, "Jayton", "Kress")] })), ["no-date"]);
  assert.deepEqual(kinds(withSeason({ games: [...base().seasons[0].games, game(`${S}-05-01`, "Jayton", "Kress")] })), ["no-date"]);
  assert.deepEqual(kinds(withSeason({ games: [...base().seasons[0].games, game(`${S}-11-12`, "Jayton", "Kress")] })), ["no-score"]);
  assert.deepEqual(kinds(withSeason({ games: [...base().seasons[0].games, game(`${S}-11-13`, "Jayton", "Kress")] })), []);
});

test("unknown-team: in games, ratings and side files; a past bracket game against an unlisted school is known by rule", () => {
  const g = base().seasons[0].games;
  assert.deepEqual(kinds(withSeason({ games: [...g, game(`${S}-11-27`, "Jayton", "Nowhere")] })), ["unknown-team"]);
  assert.deepEqual(kinds(base({ details: [{ date: `${S}-09-04`, home: "Jayton", away: "Nowhere" }] })), ["unknown-team"]);
  assert.deepEqual(kinds(base({ homeFields: [{ program: "nowhere" }] })), ["unknown-team"]);
  assert.deepEqual(kinds(base({ brackets: [{ a: "winner:G1", b: "bye" }] })), []);
  const past = { season: S - 1, games: [], playoffs: [playoff("TAPPS", "area", `${S - 1}-11-13`, "Nowhere", "Jayton", "30", "20")] };
  assert.deepEqual(kinds(base({ seasons: [past, ...base().seasons] })), ["unknown-team (rule)"]);
});

test("duplicate: the same game twice, in games.csv or a side file", () => {
  const g = base().seasons[0].games;
  assert.deepEqual(kinds(withSeason({ games: [...g, game(`${S}-09-05`, "Guthrie", "Jayton", "6", "52")] })), ["duplicate"]);
  const d = { date: `${S}-09-04`, home: "Jayton", away: "Guthrie" };
  assert.deepEqual(kinds(base({ details: [d, { ...d, home: "Guthrie", away: "Jayton" }] })), ["duplicate"]);
});

test("score-mismatch: a playoff game games.csv disagrees with or lacks", () => {
  const g = [...base().seasons[0].games, game(`${S}-11-13`, "Jayton", "Spur", "40", "30")];
  const teams = [team("Jayton", 2, 2, 0), team("Guthrie", 1, 0, 1), team("Kress", 1, 0, 1), team("Spur", 2, 1, 1)];
  const p = (h, a) => playoff("UIL", "bi-district", `${S}-11-13`, "Jayton", "Spur", h, a);
  assert.deepEqual(kinds(withSeason({ games: g, playoffs: [p("40", "30")], ratings: { teams } }, { kickoffs: new Set([gameKey(`${S}-11-13`, "Jayton", "Spur")]), sites: new Set([gameKey(`${S}-11-13`, "Jayton", "Spur")]) })), []);
  assert.deepEqual(kinds(withSeason({ games: g, playoffs: [p("40", "31")], ratings: { teams } }, { kickoffs: new Set([gameKey(`${S}-11-13`, "Jayton", "Spur")]), sites: new Set([gameKey(`${S}-11-13`, "Jayton", "Spur")]) })), ["score-mismatch"]);
});

test("no-kickoff and no-site: a playoff game a day past; known by rule: TAPPS and TCAF rounds, a forfeit, a withheld site, not due", () => {
  const today = `${S}-11-15`; // the day before base().today
  const run = (league, round, date = today, h = "", a = "", over = {}) => kinds(withSeason({ playoffs: [playoff(league, round, date, "Jayton", "Spur", h, a)] }, over));
  assert.deepEqual(run("UIL", "area"), ["no-kickoff", "no-site"]);
  assert.deepEqual(run("UIL", "area", `${S}-11-16`), ["no-kickoff (rule)", "no-site (rule)"]); // tonight: not due yet
  // A forfeit (in games.csv too, and in the record, not the rating).
  const ff = withSeason({
    games: [...base().seasons[0].games, game(today, "Jayton", "Spur", "1", "0")],
    playoffs: [playoff("UIL", "area", today, "Jayton", "Spur", "1", "0")],
    ratings: { teams: base().seasons[0].ratings.teams.map((t) => (t.team === "Jayton" ? { ...t, won: 2 } : t.team === "Spur" ? { ...t, lost: 1 } : t)) },
  });
  assert.deepEqual(kinds(ff), ["no-kickoff (rule)", "no-site (rule)"]);
  assert.deepEqual(run("TAPPS", "semifinal"), ["no-kickoff (rule)", "no-site (rule)"]);
  assert.deepEqual(run("TAPPS", "final"), ["no-kickoff", "no-site"]); // ADR 0075: TAPPS finals are filled by hand
  assert.deepEqual(run("TCAF", "final"), ["no-kickoff (rule)", "no-site (rule)"]);
  const k = gameKey(today, "Jayton", "Spur");
  assert.deepEqual(run("UIL", "area", today, "", "", { kickoffs: new Set([k]), withheld: [{ date: today, home: "Spur", away: "Jayton" }] }), ["no-site (rule)"]);
});

test("empty-season: no game this season; a program with only forfeits is known by rule", () => {
  const align = [...ALIGN, { league: "UIL", division: "II", region: "1", district: "1", school: "Paducah" }];
  const logos = { removed: [], schools: { ...base().identity.schools, paducah: { logo: {} } } };
  assert.deepEqual(kinds(base({ alignments: align, identity: logos })), ["empty-season"]);
  const g = [...base().seasons[0].games, game(`${S}-09-11`, "Paducah", "Jayton", "0", "1")];
  const teams = [team("Jayton", 1, 2, 0), team("Guthrie", 1, 0, 1), team("Kress", 1, 0, 1), team("Spur", 1, 1, 0)];
  assert.deepEqual(kinds(withSeason({ games: g, ratings: { teams } }, { alignments: align, identity: logos })), ["empty-season (rule)"]);
});

test("no-league: a row with no division or an organization the site does not know", () => {
  assert.deepEqual(kinds(base({ alignments: [...ALIGN.slice(1), { ...ALIGN[0], division: "" }] })), ["no-league"]);
  assert.deepEqual(kinds(base({ alignments: [...ALIGN.slice(1), { ...ALIGN[0], league: "TCAL" }] })), ["no-league"]);
});

test("ratings-mismatch: a game the table skips with no reason, or a stale record; forfeits, 0-0 and copies are reasons", () => {
  const teams = base().seasons[0].ratings.teams;
  assert.deepEqual(kinds(withSeason({ ratings: { teams: teams.map((t) => (t.team === "Jayton" ? { ...t, rated: 0 } : t)) } })), ["ratings-mismatch"]);
  assert.deepEqual(kinds(withSeason({ ratings: { teams: teams.map((t) => (t.team === "Spur" ? { ...t, won: 0, lost: 1 } : t)) } })), ["ratings-mismatch"]);
  // A forfeit counts in the record, not the rating; a 0-0 in neither.
  const g = [...base().seasons[0].games, game(`${S}-09-11`, "Jayton", "Kress", "1", "0"), game(`${S}-09-18`, "Guthrie", "Spur", "0", "0")];
  const after = teams.map((t) => (t.team === "Jayton" ? { ...t, won: 2 } : t.team === "Kress" ? { ...t, lost: 2 } : t));
  assert.deepEqual(kinds(withSeason({ games: g, ratings: { teams: after } })), []);
});

test("no-logo: no entry, or no logo unless removed on request", () => {
  const schools = { ...base().identity.schools, spur: { logo: null } };
  assert.deepEqual(kinds(base({ identity: { removed: [], schools } })), ["no-logo"]);
  assert.deepEqual(kinds(base({ identity: { removed: ["spur"], schools } })), []);
});

test("judgeGaps: counts by kind; an allowed gap is known; a new gap, a stale entry and a bad entry fail", () => {
  const gaps = [
    { kind: "no-logo", key: "no-logo spur", text: "spur has no logo" },
    { kind: "no-site", key: "no-site x", text: "x has no site", rule: "ADR 0076" },
    { kind: "no-logo", key: "no-logo kress", text: "kress has no logo" },
  ];
  const entry = { kind: "no-logo", key: "no-logo spur", reason: "no allowed page has a logo for this school", reviewed: "2026-11-16" };
  const out = judgeGaps(gaps, [entry, { ...entry, key: "no-logo gone" }, { kind: "no-logo", key: "no-logo x", reason: "short" }]);
  assert.deepEqual(out.counts["no-logo"], { total: 2, rule: 0, allowed: 1, new: 1 });
  assert.deepEqual(out.counts["no-site"], { total: 1, rule: 1, allowed: 0, new: 0 });
  assert.equal(Object.keys(out.counts).length, KINDS.length);
  assert.match(out.failures.join("\n"), /kress has no logo/);
  assert.match(out.failures.join("\n"), /stale entry .*no-logo gone/);
  assert.match(out.failures.join("\n"), /needs a kind, a key/);
  assert.equal(out.failures.length, 3);
  assert.equal(judgeGaps(gaps.slice(0, 2), [entry]).failures.length, 0);
  // An entry for a gap a rule explains is noise: it fails.
  assert.equal(judgeGaps(gaps.slice(1, 2), [{ ...entry, kind: "no-site", key: "no-site x" }]).failures.length, 1);
});

test("report prints the table and gives the exit code", () => {
  const lines = [];
  assert.equal(report(judgeGaps([], []), {}, (l) => lines.push(l)), 0);
  assert.match(lines.join("\n"), /\| no-logo \| 0 \| 0 \| 0 \| 0 \|/);
  assert.equal(report(judgeGaps([{ kind: "no-logo", key: "no-logo a", text: "a" }], []), {}, () => {}), 1);
});

