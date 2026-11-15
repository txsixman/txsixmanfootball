import assert from "node:assert/strict";
import { test } from "node:test";
import { gameEvents } from "./events.mjs";

const RESULT = "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period";
const GAMES = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period";
const T = Date.parse("2026-11-13T01:00:00Z");

const repo = (files) => ({
  read: (p) => files[p] ?? "",
  list: (d) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1).split("/")[0]))],
});
const base = {
  "data/seed/maxpreps-2026/games.csv": [GAMES, "I,season,2026-09-04,Alpha,Beta,,21,14,unknown,", "I,season,2026-09-11,Gamma,Delta,,0,0,unknown,", "I,season,2026-09-18,Eps,Zeta,,2,0,unknown,", "I,season,2026-09-25,Eta,Theta,,35,0,unknown,"].join("\n"),
  "data/seed/disputed/2026.csv": "game_date,home,away\n2026-09-25,Eta,Theta",
};

test("a final is a played game with a confirmed score: not 0-0, not a forfeit, not disputed", () => {
  const { events } = gameEvents({ season: 2026, now: T, files: repo(base) });
  assert.deepEqual(events.map((e) => [e.alert, e.event_key, e.home_score, e.away_score]), [["final", "2026-09-04|alpha|beta", 21, 14]]);
});

test("a kickoff is due from the listed time for three hours, only while the game has no final, and is never about a disputed game", () => {
  const details = (utc) => ({ ...base, "data/seed/game-details/2026.csv": `date,home,away,kickoff_utc,site_name,site_city\n2026-11-12,Iota,Kappa,${utc},,\n2026-09-04,Alpha,Beta,2026-09-04T23:00:00Z,,` });
  const at = (utc, now) => gameEvents({ season: 2026, now: Date.parse(now), files: repo(details(utc)) }).events.filter((e) => e.alert === "kickoff");
  assert.deepEqual(at("2026-11-13T00:30:00Z", "2026-11-13T00:29:59Z"), []); // not yet
  const [k] = at("2026-11-13T00:30:00Z", "2026-11-13T00:30:00Z");
  assert.deepEqual([k.event_key, k.kickoff_at, k.home_name], ["2026-11-12|iota|kappa", "2026-11-13T00:30:00.000Z", "Iota"]);
  assert.equal(at("2026-11-13T00:30:00Z", "2026-11-13T03:29:59Z").length, 1);
  assert.deepEqual(at("2026-11-13T00:30:00Z", "2026-11-13T03:30:00Z"), []); // over
});

test("the next-round game appears once the bracket gives it both teams, and not before, and not once it is played", () => {
  const bracket = "league,division,round,slot,a,b\nTAIAO,1,round-1,R1,Alpha,Beta\nTAIAO,1,round-1,R2,Gamma,Delta\nTAIAO,1,quarterfinal,Q1,winner:R1,winner:R2";
  const playoffs = (...rows) => [RESULT, ...rows].join("\n");
  const files = (rows) => ({ ...base, "data/seed/brackets/2026.csv": bracket, "data/seed/maxpreps-2026/playoffs.csv": playoffs(...rows) });
  const next = (rows) => gameEvents({ season: 2026, now: T, files: repo(files(rows)) }).events.filter((e) => e.alert === "next_game");
  const r1 = "TAIAO,1,round-1,2026-11-06,Alpha,Beta,,30,0,unknown,";
  const r2 = "TAIAO,1,round-1,2026-11-06,Gamma,Delta,,,,,";
  assert.deepEqual(next([r1, r2]), []); // one feeding game is not played
  const done = next([r1, "TAIAO,1,round-1,2026-11-06,Gamma,Delta,,12,13,unknown,"]);
  assert.deepEqual(done.map((e) => [e.event_key, e.round, e.home_name, e.away_name]), [["2026|quarterfinal|alpha|delta", "quarterfinal", "Alpha", "Delta"]]);
  // Once that game has its own final the "next game" is no longer news.
  assert.deepEqual(next([r1, "TAIAO,1,round-1,2026-11-06,Gamma,Delta,,12,13,unknown,", "TAIAO,1,quarterfinal,2026-11-13,Alpha,Delta,,7,3,unknown,"]), []);
  // A first-round game that two seeds meet in is not a "next" game.
  assert.deepEqual(next([]), []);
});

test("a name the database would refuse is skipped and counted, not sent on", () => {
  const files = { "data/seed/maxpreps-2026/games.csv": [GAMES, "I,season,2026-09-04,<b>Alpha,Beta,,21,14,unknown,", "I,season,2026-09-05,Gamma,Delta,,21,14,unknown,"].join("\n") };
  const { events, skipped } = gameEvents({ season: 2026, now: T, files: repo(files) });
  assert.deepEqual([events.length, skipped], [1, 1]);
});
