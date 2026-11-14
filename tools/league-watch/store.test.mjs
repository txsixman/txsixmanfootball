import assert from "node:assert/strict";
import { test } from "node:test";
import { changeLines, CHANGE_COLUMNS, countsLine, mergeStored, movedDate, movesCsv, MOVES_COLUMNS, parseCsv, pendingCsv, readMoves, readPending, rowKey } from "./store.mjs";
import { COLUMNS } from "./maxpreps.mjs";

// The store's merge rules (ADR 0031), on invented schools.
const H = COLUMNS;
const row = (date, home, away, hs = "", as = "", src = `https://www.maxpreps.com/tx/football/game/x/?c=${home}`) =>
  ["I", "season", date, home, away, "false", hs, as, hs === "" ? "" : "unknown", "", src, ""].join(",");
const csv = (...rows) => [H, ...rows].join("\n") + "\n";
const none = () => false;
const all = () => true;
const scoreOf = (text, home) => parseCsv(text).rows.find((r) => r.home === home);
const merge = (stored, fresh, pending = [], readTeam = none, now = "2026-11-14T12:00:00Z") => mergeStored({ file: "games.csv", stored, fresh, pending, readTeam, now });

test("a first read is stored as it is", () => {
  const fresh = csv(row("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"));
  const m = merge("", fresh);
  assert.equal(m.text, fresh);
  assert.equal(m.counts.added, 1);
});

test("a stored final survives a read where the source shows no score, or does not list the game", () => {
  const stored = csv(row("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"), row("2026-11-07", "Dry Wash", "Mesa Verde", "50", "0"));
  // Cedar Gap's game shows no score now; Dry Wash's is gone from the source. Both teams' pages were read.
  const m = merge(stored, csv(row("2026-11-06", "Cedar Gap", "Salt Fork")), [], all);
  assert.equal(scoreOf(m.text, "Cedar Gap").home_score, "42");
  assert.equal(scoreOf(m.text, "Dry Wash").home_score, "50");
  assert.equal(m.counts.keptBlank, 1);
  assert.equal(m.counts.keptUnlisted, 1);
  assert.deepEqual(m.changes, []);
});

test("a stored or read 0-0 with no forfeit is no score: removed from games.csv; a tie and a 0-0 forfeit stay", () => {
  const forfeit = ["I", "season", "2026-10-02", "Far Hill", "Low Creek", "false", "0", "0", "forfeit", "", "https://example.test/f", ""].join(",");
  const stored = csv(row("2026-10-23", "Cedar Gap", "Salt Fork", "0", "0"), row("2026-10-30", "Dry Wash", "Mesa Verde", "7", "7"), forfeit);
  // Nothing read: the stored 0-0 leaves games.csv at once, which holds played games only (no blank-score row).
  const m = merge(stored, csv());
  assert.equal(scoreOf(m.text, "Cedar Gap"), undefined);
  assert.ok(parseCsv(m.text).rows.every((r) => r.home_score !== "" && r.away_score !== ""), "games.csv has no blank-score row");
  assert.equal(scoreOf(m.text, "Dry Wash").home_score, "7");
  assert.equal(scoreOf(m.text, "Far Hill").end_reason, "forfeit");
  assert.equal(m.counts.zeroZero, 1);
  assert.match(countsLine("games.csv", m.counts), /1 stored 0-0 non-forfeit "finals" removed\.$/);
  // A read that still shows 0-0 adds nothing; a real score later adds the game.
  assert.equal(scoreOf(merge(m.text, csv(row("2026-10-23", "Cedar Gap", "Salt Fork", "0", "0"))).text, "Cedar Gap"), undefined);
  assert.equal(scoreOf(merge(m.text, csv(row("2026-10-23", "Cedar Gap", "Salt Fork", "34", "28"))).text, "Cedar Gap").home_score, "34");
});

test("in playoffs.csv a 0-0 with no forfeit keeps the bracket game, its score blank", () => {
  const P = ["league", ...COLUMNS.split(",")].join(",");
  const prow = (date, home, away, hs, as) => ["UIL", "I", "Bi-District", date, home, away, "true", hs, as, hs === "" ? "" : "unknown", "", "https://example.test/p", ""].join(",");
  const m = mergeStored({ file: "playoffs.csv", stored: [P, prow("2026-11-13", "Cedar Gap", "Salt Fork", "0", "0")].join("\n") + "\n", fresh: "", pending: [], readTeam: none, now: "t" });
  const r = parseCsv(m.text).rows.find((x) => x.home === "Cedar Gap");
  assert.deepEqual([r.home_score, r.away_score, r.end_reason], ["", "", ""]);
  assert.match(countsLine("playoffs.csv", m.counts), /1 stored 0-0 non-forfeit "finals" written blank\.$/);
});

test("an empty score is filled at once; an unplayed game gone from a page that was read is dropped", () => {
  const stored = csv(row("2026-11-13", "Cedar Gap", "Salt Fork"), row("2026-11-13", "Dry Wash", "Mesa Verde"), row("2026-11-13", "Far Hill", "Low Creek"));
  // Cedar Gap's final is in; Dry Wash's game was moved (gone from its page, which was read); Far Hill's pages were not read.
  const read = (name) => ["Dry Wash", "Mesa Verde", "Cedar Gap", "Salt Fork"].includes(name);
  const m = merge(stored, csv(row("2026-11-13", "Cedar Gap", "Salt Fork", "28", "30"), row("2026-11-20", "Dry Wash", "Mesa Verde")), [], read);
  assert.equal(scoreOf(m.text, "Cedar Gap").away_score, "30");
  assert.equal(m.counts.filled, 1);
  assert.equal(m.counts.droppedUnplayed, 1);
  assert.equal(parseCsv(m.text).rows.filter((r) => r.home === "Dry Wash").map((r) => r.game_date).join(), "2026-11-20");
  assert.ok(scoreOf(m.text, "Far Hill"), "a row whose pages were not read stays");
});

test("a different score on one read is only proposed; the same on the next read applies it and logs it", () => {
  const stored = csv(row("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"));
  const fresh = csv(row("2026-11-06", "Cedar Gap", "Salt Fork", "42", "38"));
  const first = merge(stored, fresh, [], all, "2026-11-14T12:00:00Z");
  assert.equal(scoreOf(first.text, "Cedar Gap").away_score, "36", "one read does not overwrite");
  assert.equal(first.counts.proposed, 1);
  assert.deepEqual(first.changes, []);
  assert.deepEqual(first.pending, [{ file: "games.csv", key: "2026-11-06|cedar-gap|salt-fork", home_score: "42", away_score: "38", first_seen: "2026-11-14T12:00:00Z" }]);

  // The proposal goes through the file and back, as the reader stores it.
  const pending = readPending(pendingCsv(first.pending));
  const second = merge(first.text, fresh, pending, all, "2026-11-15T12:00:00Z");
  assert.equal(scoreOf(second.text, "Cedar Gap").away_score, "38", "two reads in a row do");
  assert.equal(second.counts.changed, 1);
  assert.deepEqual(second.pending, []);
  assert.deepEqual(second.changes, [
    { changed_at: "2026-11-15T12:00:00Z", file: "games.csv", key: "2026-11-06|cedar-gap|salt-fork", old_home_score: "42", old_away_score: "36", new_home_score: "42", new_away_score: "38", source_url: "https://www.maxpreps.com/tx/football/game/x/?c=Cedar Gap" },
  ]);
  // The log only grows: a header once, then a line a change.
  assert.equal(changeLines(second.changes, false).split("\n")[0], CHANGE_COLUMNS);
  assert.equal(changeLines(second.changes, true).split("\n").filter(Boolean).length, 1);
});

test("a proposal is dropped when the next read shows the stored score again, and replaced by another score", () => {
  const stored = csv(row("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"));
  const pending = [{ file: "games.csv", key: "2026-11-06|cedar-gap|salt-fork", home_score: "42", away_score: "38", first_seen: "2026-11-14T12:00:00Z" }];
  const back = merge(stored, stored, pending, all);
  assert.deepEqual(back.pending, []);
  assert.equal(back.counts.same, 1);
  const other = merge(stored, csv(row("2026-11-06", "Cedar Gap", "Salt Fork", "44", "36")), pending, all, "2026-11-15T00:00:00Z");
  assert.equal(scoreOf(other.text, "Cedar Gap").home_score, "42");
  assert.deepEqual(other.pending.map((p) => [p.home_score, p.away_score, p.first_seen]), [["44", "36", "2026-11-15T00:00:00Z"]]);
  // Another file's proposals pass through untouched.
  const theirs = { file: "playoffs.csv", key: "k", home_score: "1", away_score: "2", first_seen: "t" };
  assert.deepEqual(merge(stored, stored, [theirs], all).pending, [theirs]);
});

test("a game listed with home and away swapped is the same game, and its score is compared team by team", () => {
  const stored = csv(row("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"));
  const m = merge(stored, csv(row("2026-11-06", "Salt Fork", "Cedar Gap", "36", "42")), [], all);
  assert.equal(m.counts.same, 1);
  assert.equal(m.counts.proposed, 0);
  assert.equal(rowKey(parseCsv(m.text).rows[0]), "2026-11-06|cedar-gap|salt-fork");
});

test("playoffs.csv keeps its league column and order; a header change fails loudly", () => {
  const P = `league,${COLUMNS}`;
  const prow = (league, date, home) => `${league},I,area,${date},${home},Zed,,,,,,https://www.maxpreps.com/tx/football/game/p/?c=${home},`;
  const m = mergeStored({ file: "playoffs.csv", stored: [P, prow("UIL", "2026-11-13", "Cedar Gap")].join("\n") + "\n", fresh: [P, prow("TAPPS", "2026-11-13", "Abbey")].join("\n") + "\n", pending: [], readTeam: none, now: "t" });
  assert.deepEqual(parseCsv(m.text).rows.map((r) => r.league), ["TAPPS", "UIL"]);
  assert.throws(() => merge(csv(row("2026-11-06", "A", "B")), "x,y\n1,2\n"), /header/);
  assert.match(countsLine("games.csv", m.counts), /^games\.csv: 1 added, 0 scores filled/);
});

test("a finished season makes zero requests: the reader stops before reading a page, unless --reread", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { SEASON_FILE, seasonComplete } = await import("./maxpreps.mjs");
  const dir = mkdtempSync(path.join(tmpdir(), "store-"));
  mkdirSync(path.join(dir, "maxpreps-2019"));
  assert.equal(seasonComplete(path.join(dir, "maxpreps-2019")), false);
  writeFileSync(path.join(dir, "maxpreps-2019", SEASON_FILE), '{ "complete": true, "read": "2026-11-13" }\n');
  assert.equal(seasonComplete(path.join(dir, "maxpreps-2019")), true);
  // Every request would fail: the proxy is a closed port. The run must still end cleanly, having read nothing.
  const reader = fileURLToPath(new URL("./maxpreps.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [reader, "--season", "2019"], {
    env: { ...process.env, PRIVATE_DATA: dir, NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", MAXPREPS_CACHE: "" },
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /marked complete .*nothing read/);
});

test("filling a score keeps the stored row's round and order; only the score, its end and its source come from the read", () => {
  const P = `league,${COLUMNS}`;
  const stored = `${P}\nUIL,I,area,2026-11-13,Cedar Gap,Salt Fork,,,,,,https://www.maxpreps.com/tx/football/game/a/?c=1,\n`;
  const fresh = `${P}\nUIL,I,state,2026-11-13,Salt Fork,Cedar Gap,,30,28,unknown,,https://www.maxpreps.com/tx/football/game/a/?c=2,\n`;
  const m = mergeStored({ file: "playoffs.csv", stored, fresh, pending: [], readTeam: none, now: "t" });
  assert.equal(m.text.trim().split("\n")[1], "UIL,I,area,2026-11-13,Cedar Gap,Salt Fork,,28,30,unknown,,https://www.maxpreps.com/tx/football/game/a/?c=2,");
  assert.equal(m.counts.filled, 1);
});

test("full or targeted: a full read is the first of a season, a past season, Monday's audit or --full; the rest are targeted", async () => {
  const { isFullRead } = await import("./maxpreps.mjs");
  const friday = Date.parse("2026-11-13T12:00:00Z");
  const monday = Date.parse("2026-11-16T12:00:00Z");
  assert.equal(isFullRead({ argv: [], now: friday, past: false, scheduleStored: true }), false);
  assert.equal(isFullRead({ argv: [], now: monday, past: false, scheduleStored: true }), true);
  assert.equal(isFullRead({ argv: ["--full"], now: friday, past: false, scheduleStored: true }), true);
  assert.equal(isFullRead({ argv: [], now: friday, past: false, scheduleStored: false }), true);
  assert.equal(isFullRead({ argv: [], now: friday, past: true, scheduleStored: true }), true);
});

test("a targeted read reads only teams with a game in the last 14 days, a recent bracket game, or nothing stored", async () => {
  const { targetPages } = await import("./maxpreps.mjs");
  const g = (game_date, home, away, s = "") => ({ game_date, home, away, home_score: s, away_score: s });
  const teams = new Map(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => [s, `https://www.maxpreps.com/tx/x/${s}/football/`]));
  const t = targetPages({
    today: "2026-11-13",
    schedule: [g("2026-11-12", "A", "B"), g("2026-10-01", "C", "D"), g("2026-11-20", "C", "D")], // last night; long ago; next week
    games: [g("2026-09-04", "C", "D", "40"), g("2026-11-06", "E", "F", "30")], // final: not read again
    playoffs: [g("2026-11-07", "E", "F", "30")], // a recent bracket game: its winner's next game
    teams,
    schools: ["a", "b", "c", "d", "e", "f", "g", "z"], // g has no stored game; z has no known page
  });
  assert.deepEqual(t.pages.map((u) => u.split("/")[5]).sort(), ["a", "b", "e", "f", "g"]);
  assert.equal(t.uncaptured, 2);
  assert.equal(t.noPage, 1);
});

test("a targeted read names playoff rounds from the whole stored bracket, not only the games it read", async () => {
  const { playoffsCsv, storedBracketGame, slugify } = await import("./maxpreps.mjs");
  const P = `league,${COLUMNS}`;
  // Eight first-round games: a four-round bracket, so the second week is the area round.
  const names = ["Abbey", "Bend", "Cove", "Dale", "Eden", "Fern", "Gale", "Hope", "Iris", "Jade", "Knox", "Lark", "Mesa", "Nile", "Oak", "Pike"];
  const stored = parseCsv([P, ...Array.from({ length: 8 }, (_, i) => `UIL,I,bi-district,2026-11-06,${names[2 * i]},${names[2 * i + 1]},,40,0,unknown,,https://www.maxpreps.com/tx/football/game/${i}/?c=${i},`)].join("\n") + "\n").rows.map(storedBracketGame);
  const fresh = { date: "2026-11-13", bracket: { league: "UIL", division: "I" }, home: { slug: "abbey", score: null }, away: { slug: "cove", score: null }, played: false, gameUrl: "https://www.maxpreps.com/tx/football/game/3/?c=3" };
  const bySlug = new Map(names.map((s) => [slugify(s), { school: s, division: "I" }]));
  const rows = parseCsv(playoffsCsv([...stored, fresh], bySlug)).rows;
  assert.equal(rows.find((r) => r.game_date === "2026-11-13").round, "area");
  assert.equal(parseCsv(playoffsCsv([fresh], bySlug)).rows[0].round !== "area", true, "alone, the one game would be named wrongly");
});

test("a moved game: every game listed on its old date between its two teams is laid on its new date (ADR 0046)", () => {
  const text = movesCsv("", [{ from_date: "2026-11-13", home: "Cedar Gap", away: "Salt Fork", to_date: "2026-11-14", source: "league bracket" }]);
  assert.equal(text.split("\n")[0], MOVES_COLUMNS);
  assert.equal(movesCsv(text, [{ from_date: "2026-11-13", home: "Salt Fork", away: "Cedar Gap", to_date: "2026-11-14", source: "by hand" }]), text, "a move already there is not repeated");
  const moves = readMoves(text);
  assert.equal(movedDate(moves, "2026-11-13", "salt-fork", "cedar-gap"), "2026-11-14", "either order, slugs or names");
  assert.equal(movedDate(moves, "2026-11-13", "cedar-gap", "dry-wash"), "2026-11-13");
  assert.equal(movedDate(moves, "2026-11-20", "cedar-gap", "salt-fork"), "2026-11-20", "another date is another game");
  assert.throws(() => movesCsv("", [{ from_date: "2026-11-13", home: "A, B", away: "C", to_date: "2026-11-14", source: "" }]), /comma/);
});
