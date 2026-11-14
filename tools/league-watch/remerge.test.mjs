import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { COLUMNS } from "./maxpreps.mjs";
import { CHANGE_COLUMNS, MOVES_COLUMNS, PENDING_COLUMNS, parseCsv } from "./store.mjs";
import { remerge } from "./remerge.mjs";

// Laying a run's copy of maxpreps-<season>/ on the private repo's newest main (ADR 0051), on invented schools. Three
// folders: base (as the run started), run (the base plus what the read did), main (the base plus what someone else did).
const game = (date, home, away, hs = "", as = "") => ["I", "season", date, home, away, "false", hs, as, hs === "" ? "" : "unknown", "", `https://example.test/${home}`, ""].join(",");
const games = (...rows) => [COLUMNS, ...rows].join("\n") + "\n";
const PLAYOFF_COLUMNS = "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
const bracket = (date, home, away, hs = "", as = "") => ["TAIAO", "1", "round-1", date, home, away, "", hs, as, hs === "" ? "" : "unknown", "", `https://example.test/${home}`, ""].join(",");
const playoffs = (...rows) => [PLAYOFF_COLUMNS, ...rows].join("\n") + "\n";
const pend = (...rows) => [PENDING_COLUMNS, ...rows].join("\n") + "\n";

function folders(files) {
  const root = mkdtempSync(path.join(tmpdir(), "remerge-"));
  const dirs = Object.fromEntries(["base", "run", "main"].map((d) => [d, path.join(root, d)]));
  for (const [d, dir] of Object.entries(dirs)) {
    mkdirSync(dir, { recursive: true });
    for (const [name, versions] of Object.entries(files)) {
      const text = versions[d] ?? versions.base;
      if (text !== undefined) writeFileSync(path.join(dir, name), text);
    }
  }
  return dirs;
}
const go = (d, now = "2026-11-14T12:00:00Z") => remerge({ run: d.run, main: d.main, base: d.base, now });
const text = (d, name) => readFileSync(path.join(d.main, name), "utf8");

test("nothing changed on main since the run started: the run's copy goes in exactly as it is", () => {
  const base = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"));
  const run = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"), game("2026-11-13", "Dry Wash", "Mesa Verde", "50", "0"));
  const d = folders({ "games.csv": { base, run, main: base }, "coverage.txt": { base: "old\n", run: "new\n", main: "old\n" } });
  const r = go(d);
  assert.equal(text(d, "games.csv"), run);
  assert.equal(text(d, "coverage.txt"), "new\n");
  assert.deepEqual(r.merged, []);
});

test("a row only main has survives (a hand fill committed during the run), and the run's new row is added", () => {
  const base = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"));
  const main = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"), game("2026-11-07", "Hand Fill", "Wren Hill", "20", "14"));
  const run = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"), game("2026-11-13", "Dry Wash", "Mesa Verde", "50", "0"));
  const d = folders({ "games.csv": { base, run, main } });
  const r = go(d);
  assert.match(text(d, "games.csv"), /Hand Fill/);
  assert.match(text(d, "games.csv"), /Dry Wash/);
  assert.match(text(d, "games.csv"), /Cedar Gap/);
  assert.deepEqual(r.merged, ["games.csv"]);
});

test("a final on main is not overwritten by the run's different score: it becomes a proposal, and nothing is logged as changed", () => {
  const base = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"), game("2026-11-13", "Late One", "Other", "", ""));
  const main = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"), game("2026-11-13", "Late One", "Other", "21", "14"));
  const run = games(game("2026-11-06", "Cedar Gap", "Salt Fork", "42", "36"), game("2026-11-13", "Late One", "Other", "28", "14"));
  const d = folders({ "games.csv": { base, run, main } });
  go(d);
  const row = parseCsv(text(d, "games.csv")).rows.find((x) => x.home === "Late One");
  assert.deepEqual([row.home_score, row.away_score], ["21", "14"]);
  const p = parseCsv(text(d, "pending-scores.csv")).rows;
  assert.equal(p.length, 1);
  assert.equal(p[0].home_score, "28");
  assert.equal(existsSync(path.join(d.main, "score-changes.csv")), false);
});

test("the same different score already proposed on main applies, and the change is logged once", () => {
  const base = games(game("2026-11-13", "Late One", "Other", "21", "14"), game("2026-11-14", "Third", "Fourth", "", ""));
  const main = games(game("2026-11-13", "Late One", "Other", "21", "14"), game("2026-11-14", "Third", "Fourth", "7", "0"));
  const run = games(game("2026-11-13", "Late One", "Other", "28", "14"), game("2026-11-14", "Third", "Fourth", "", ""));
  const key = "2026-11-13|late-one|other";
  const d = folders({
    "games.csv": { base, run, main },
    "pending-scores.csv": { base: pend(`games.csv,${key},28,14,2026-11-13T00:00:00Z`) },
  });
  go(d);
  assert.match(text(d, "games.csv"), /Late One,Other,false,28,14/);
  assert.equal(parseCsv(text(d, "pending-scores.csv")).rows.length, 0);
  assert.equal(text(d, "score-changes.csv").trim().split("\n").length, 2);
});

test("a blank from the run never replaces a score on main, and a main-only unscored game is kept", () => {
  const base = games(game("2026-11-13", "Late One", "Other", "", ""));
  const main = games(game("2026-11-13", "Late One", "Other", "21", "14"), game("2026-11-20", "Next", "Game", "", ""));
  const run = games(game("2026-11-13", "Late One", "Other", "", ""), game("2026-11-14", "New", "Row", "3", "0"));
  const d = folders({ "games.csv": { base, run, main } });
  go(d);
  assert.match(text(d, "games.csv"), /Late One,Other,false,21,14/);
  assert.match(text(d, "games.csv"), /Next,Game/);
});

test("playoffs.csv: a late final on main stays and the run's other changes are added", () => {
  const base = playoffs(bracket("2026-11-13", "Alpha", "Beta"), bracket("2026-11-13", "Gamma", "Delta"));
  const main = playoffs(bracket("2026-11-13", "Alpha", "Beta", "35", "7"), bracket("2026-11-13", "Gamma", "Delta"));
  const run = playoffs(bracket("2026-11-13", "Alpha", "Beta"), bracket("2026-11-13", "Gamma", "Delta", "14", "10"));
  const d = folders({ "playoffs.csv": { base, run, main } });
  go(d);
  assert.match(text(d, "playoffs.csv"), /Alpha,Beta,,35,7/);
  assert.match(text(d, "playoffs.csv"), /Gamma,Delta,,14,10/);
});

test("moved-games.csv: moves from both sides are kept, once each", () => {
  const head = `${MOVES_COLUMNS}\n`;
  const a = "2026-11-13,Alpha,Beta,2026-11-14,league bracket";
  const b = "2026-11-13,Gamma,Delta,2026-11-14,league bracket";
  const c = "2026-11-20,Eps,Zeta,2026-11-21,league bracket";
  const d = folders({ "moved-games.csv": { base: `${head}${a}\n`, run: `${head}${a}\n${b}\n`, main: `${head}${a}\n${c}\n` } });
  go(d);
  assert.deepEqual(text(d, "moved-games.csv").trim().split("\n").slice(1).sort(), [a, b, c].sort());
});

test("pending proposals: the run's new one is kept beside main's, and one the run settled is dropped", () => {
  const p1 = "games.csv,2026-11-06|a|b,3,0,2026-11-10T00:00:00Z";
  const p2 = "games.csv,2026-11-07|c|d,4,0,2026-11-11T00:00:00Z";
  const p3 = "games.csv,2026-11-08|e|f,5,0,2026-11-12T00:00:00Z";
  const g = (extra) => games(game("2026-11-06", "A", "B", "1", "0"), extra);
  const d = folders({
    "games.csv": { base: g(game("2026-11-09", "X", "Y", "", "")), run: g(game("2026-11-09", "X", "Y", "", "")), main: g(game("2026-11-10", "Hand", "Fill", "9", "9")) },
    "pending-scores.csv": { base: pend(p1), run: pend(p2), main: pend(p1, p3) },
  });
  go(d);
  const keys = parseCsv(text(d, "pending-scores.csv")).rows.map((x) => x.key).sort();
  assert.deepEqual(keys, ["2026-11-07|c|d", "2026-11-08|e|f"]);
});

test("score-changes.csv: a run's change on a file that went in whole is appended to main's log; the log never shrinks", () => {
  const l1 = "2026-11-10T00:00:00Z,games.csv,2026-11-01|a|b,1,0,2,0,u";
  const l2 = "2026-11-12T00:00:00Z,games.csv,2026-11-02|c|d,1,0,3,0,u";
  const l3 = "2026-11-13T00:00:00Z,playoffs.csv,2026-11-06|e|f,1,0,4,0,u";
  const log = (...ls) => [CHANGE_COLUMNS, ...ls].join("\n") + "\n";
  const same = games(game("2026-11-06", "A", "B", "1", "0"));
  const d = folders({
    "games.csv": { base: same, run: same, main: same },
    "playoffs.csv": { base: playoffs(bracket("2026-11-06", "E", "F", "1", "0")), run: playoffs(bracket("2026-11-06", "E", "F", "4", "0")), main: playoffs(bracket("2026-11-06", "E", "F", "1", "0")) },
    "score-changes.csv": { base: log(l1), run: log(l1, l2), main: log(l1, l3) },
  });
  go(d);
  assert.deepEqual(text(d, "score-changes.csv").trim().split("\n").slice(1), [l1, l3, l2]);
});

test("outside.csv and teams.csv: main's rows stay, the run's new rows are added", () => {
  const out = (...r) => ["game_date,team,opponent,opponent_url,team_is_home,team_score,opponent_score,source_url", ...r].join("\n") + "\n";
  const o1 = "2026-08-21,Alpha,Out One,u,true,5,0,s";
  const o2 = "2026-08-22,Gamma,Out Two,u,false,6,0,s";
  const o3 = "2026-08-23,Eps,Out Three,u,true,7,0,s";
  const t = (...r) => ["slug,maxpreps_url", ...r].join("\n") + "\n";
  const d = folders({
    "outside.csv": { base: out(o1), run: out(o1, o2), main: out(o1, o3) },
    "teams.csv": { base: t("a,u1"), run: t("a,u1", "b,u2"), main: t("a,u1", "c,u3") },
  });
  go(d);
  assert.deepEqual(text(d, "outside.csv").trim().split("\n").slice(1).sort(), [o1, o2, o3]);
  assert.deepEqual(text(d, "teams.csv").trim().split("\n").slice(1), ["a,u1", "b,u2", "c,u3"]);
});

test("schedule.csv: a game now scored on main is dropped, one the run dropped stays dropped, the run's new ones are added", () => {
  const sc = (...r) => ["game_date,home,away", ...r].join("\n") + "\n";
  const base = games(game("2026-11-13", "Late One", "Other", "", ""));
  const main = games(game("2026-11-13", "Late One", "Other", "21", "14"));
  const d = folders({
    "games.csv": { base, run: base, main },
    "schedule.csv": { base: sc("2026-11-13,Late One,Other", "2026-11-14,Old,Gone"), run: sc("2026-11-13,Late One,Other", "2026-11-20,New,Game"), main: sc("2026-11-13,Late One,Other", "2026-11-14,Old,Gone") },
  });
  go(d);
  assert.equal(text(d, "schedule.csv"), sc("2026-11-20,New,Game"));
});

test("a file the run did not change stays as main has it; a report the run rewrote is the run's copy", () => {
  const d = folders({
    "coverage.txt": { base: "a\n", run: "a\n", main: "hand edit\n" },
    "season.json": { base: "{}\n", run: '{"complete":true}\n', main: "{ }\n" },
  });
  go(d);
  assert.equal(text(d, "coverage.txt"), "hand edit\n");
  assert.equal(text(d, "season.json"), '{"complete":true}\n');
});

test("no base (a season's first run): every run row counts, and main's own rows still stay", () => {
  const main = games(game("2026-11-07", "Hand Fill", "Wren Hill", "20", "14"));
  const run = games(game("2026-11-13", "Dry Wash", "Mesa Verde", "50", "0"));
  const d = folders({ "games.csv": { run, main } });
  remerge({ run: d.run, main: d.main, now: "2026-11-14T12:00:00Z" });
  assert.match(text(d, "games.csv"), /Hand Fill/);
  assert.match(text(d, "games.csv"), /Dry Wash/);
});

test("a header that is not the store's fails loudly and writes nothing", () => {
  const base = games(game("2026-11-06", "A", "B", "1", "0"));
  const main = games(game("2026-11-06", "A", "B", "1", "0"), game("2026-11-07", "C", "D", "2", "0"));
  const d = folders({ "games.csv": { base, run: base.replace("division", "div"), main } });
  assert.throws(() => go(d), /header/);
  assert.equal(text(d, "games.csv"), main);
});
