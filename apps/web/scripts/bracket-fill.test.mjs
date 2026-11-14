// Next-round games from the bracket, and the checks that winners go on (ADR 0047; lib/bracket-fill.ts). The UIL games are
// the live Division I and II playoff rows as of Nov 14, 2026 (fixtures/uil-2026-playoffs-nov14.csv), with each team's
// region from the 2026-28 alignments (fixtures/uil-2026-regions.json).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bracketProblems, bracketSlots, builtGames, fill, ROUND_ORDER, sideText, uilSlotRows } from "../lib/bracket-fill.ts";
import { parseCsv, UIL_BRACKET_COLUMNS, UilBracketRow } from "../lib/data-schemas.ts";
import { checkBrackets, uilStructureProblems } from "./check-data.mjs";

const fixture = (name) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
// UIL's own 2026 bracket, as the site reads it (data/seed/uil-2026-28/bracket-2026.csv).
const STRUCTURE_FILE = new URL("../../../data/seed/uil-2026-28/bracket-2026.csv", import.meta.url);
const STRUCTURE = parseCsv("bracket-2026.csv", readFileSync(STRUCTURE_FILE, "utf8"), UIL_BRACKET_COLUMNS, UilBracketRow).map(({ row }) => row);
const [header, ...lines] = fixture("uil-2026-playoffs-nov14.csv").trim().split("\n");
const ROWS = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [header.split(",")[i], v])));
const REGIONS = JSON.parse(fixture("uil-2026-regions.json"));
const toGame = (r) => ({
  round: r.round, date: r.game_date, home: r.home, away: r.away, confirmed: r.home_score !== "",
  ...(r.home_score !== "" ? { homeScore: Number(r.home_score), awayScore: Number(r.away_score) } : {}),
});
const live = (division) => ROWS.filter((r) => r.division === division).map(toGame);
const game = (round, date, home, away, score) => ({ round, date, home, away, confirmed: !!score, ...(score ? { homeScore: score[0], awayScore: score[1] } : {}) });
/** One UIL division's slots (no slot file: what the data closes), its built rows in words, and its problems. */
const uil = (division, games) => {
  const slots = bracketSlots([], games, { league: "UIL", division, regionOf: (t) => REGIONS[division][t] });
  return {
    slots,
    built: builtGames(fill(slots, games, ROUND_ORDER)).map((b) => `${b.round}: ${b.sides.map(sideText).join(" vs ")}`),
    problems: bracketProblems(`UIL ${division}`, slots, games, ROUND_ORDER),
  };
};
// Region 2 of Division I: Water Valley v Borden County is listed for Nov 20; the other area game would be Menard v Rankin.
const otherArea = (score) => game("area", "2026-11-20", "Rankin", "Menard", score);

test("without UIL's bracket, the data alone closes nothing from one area game, and every listed game checks out", () => {
  for (const division of ["I", "II"]) {
    const { slots, built, problems } = uil(division, live(division));
    assert.deepEqual(slots, [], `UIL ${division}: no region has two area games yet, and no semifinal is listed`);
    assert.deepEqual(built, []);
    assert.deepEqual(problems, []);
  }
});

/** One UIL division with UIL's bracket: its built rows in words (slot first) and its problems. */
const withBracket = (division, games) => {
  const slots = bracketSlots(uilSlotRows(STRUCTURE), games, { league: "UIL", division });
  return {
    built: builtGames(fill(slots, games, ROUND_ORDER)).map((b) => `${b.slot} ${b.sides.map(sideText).join(" vs ")}`),
    problems: bracketProblems(`UIL ${division}`, slots, games, ROUND_ORDER),
  };
};

test("UIL's bracket and the live finals give every area game before it is listed, and the one listed fits", () => {
  const one = withBracket("I", live("I"));
  assert.deepEqual(one.problems, []);
  assert.deepEqual(one.built, [
    "G17 Nazareth vs Hermleigh", "G18 Jayton vs Whiteface", "G20 Menard vs Rankin", "G21 Newcastle vs Milford",
    "G22 Bluff Dale vs Gordon", "G23 Gilmer Union Hill vs Oglesby", "G24 Medina vs Aquilla",
  ]); // G19, Borden County v Water Valley, is listed
  const two = withBracket("II", live("II"));
  assert.deepEqual(two.problems, []);
  assert.deepEqual(two.built, [
    "G17 Turkey Valley vs Meadow", "G18 Wellman-Union vs Matador Motley County", "G19 Rocksprings vs Blackwell",
    "G20 Richland Springs vs Grandfalls-Royalty", "G21 Knox City vs Strawn", "G22 Zephyr vs Harrold",
    "G23 Ladonia Fannindel vs winner of Benavides–Apple Springs", "G24 Runge vs Mount Calm",
  ]); // G14, Apple Springs v Benavides, is still to play
});

test("with UIL's bracket, a listed game the bracket never pairs is caught, and the regional waits on both area games", () => {
  // Nazareth's area opponent is Hermleigh (G17), never Jayton (G18's).
  const wrong = withBracket("I", [...live("I"), game("area", "2026-11-20", "Nazareth", "Jayton")]);
  // Also: Hermleigh (G17) and Whiteface (G18) won, and the listing takes their places.
  assert.deepEqual(wrong.problems.map((p) => p.key).sort(), ["bracket UIL I G17 placed", "bracket UIL I G18 placed", "bracket UIL I unplaced area Jayton v Nazareth"]);
  const wv = live("I").map((g) => (g.round === "area" ? { ...g, homeScore: 60, awayScore: 30, confirmed: true } : g));
  assert.ok(withBracket("I", [...wv, otherArea([28, 44])]).built.includes("G26 Water Valley vs Menard"));
});

test("UIL's bracket file agrees with the alignments: teams, regions and district seeds, and every feed an earlier slot", () => {
  const alignments = Object.entries(REGIONS).flatMap(([division, m]) => Object.entries(m).map(([school, region]) => ({ league: "UIL", division, region, school })));
  const districts = new Map(STRUCTURE.flatMap((r) => [[`${r.division}|${r.a}`, r.a_seed.slice(1)], [`${r.division}|${r.b}`, r.b_seed.slice(1)]]));
  const aligned = alignments.map((a) => ({ ...a, district: districts.get(`${a.division}|${a.school}`) }));
  assert.deepEqual(uilStructureProblems(STRUCTURE, aligned), []);
  assert.equal(STRUCTURE.length, 62);
  const moved = aligned.map((a) => (a.school === "Jayton" ? { ...a, region: "2" } : a));
  assert.deepEqual(uilStructureProblems(STRUCTURE, moved).map((p) => p.key), ["uil bracket I G3 Jayton seed"]);
  const looped = STRUCTURE.map((r) => (r.slot === "G17" && r.division === "I" ? { ...r, a: "winner:G25" } : r));
  assert.deepEqual(uilStructureProblems(looped, aligned).map((p) => p.key), ["uil bracket I G17 feed"]);
  const stranger = STRUCTURE.map((r) => (r.slot === "G1" && r.division === "II" ? { ...r, a: "Nowhere Tech" } : r));
  assert.deepEqual(uilStructureProblems(stranger, aligned).map((p) => p.key), ["uil bracket II G1 Nowhere Tech"]);
});

test("a region's two area games feed its regional game: nothing shows until one is final, then the winner goes on", () => {
  const unplayed = uil("I", [...live("I"), otherArea()]);
  assert.equal(unplayed.slots.find((s) => s.slot === "closed:regional-2")?.round, "regional");
  assert.deepEqual(unplayed.built, [], "two unplayed games: no team is known yet");

  const wv = live("I").map((g) => (g.round === "area" ? { ...g, homeScore: 60, awayScore: 30, confirmed: true } : g));
  assert.deepEqual(uil("I", [...wv, otherArea()]).built, ["regional: Water Valley vs winner of Menard–Rankin"]);
  assert.deepEqual(uil("I", [...wv, otherArea([28, 44])]).built, ["regional: Water Valley vs Menard"]);
  // A listed regional game replaces the built row.
  const listed = uil("I", [...wv, otherArea([28, 44]), game("regional", "2026-11-27", "Water Valley", "Menard")]);
  assert.deepEqual(listed.built, []);
  assert.deepEqual(listed.problems, []);
});

test("a disputed or unplayed final names no winner, so it builds nothing past it", () => {
  const disputed = live("I").map((g) => (g.round === "area" ? { ...g, homeScore: 60, awayScore: 30, confirmed: false } : g));
  assert.deepEqual(uil("I", [...disputed, otherArea([28, 44])]).built, ["regional: Menard vs winner of Borden County–Water Valley"]);
  const tied = live("I").map((g) => (g.round === "area" ? { ...g, homeScore: 30, awayScore: 30, confirmed: true } : g));
  assert.deepEqual(uil("I", [...tied, otherArea()]).built, []);
});

test("a team that lost never appears later", () => {
  // Robert Lee lost to Water Valley on Nov 12 (live row): listing it in an area game is caught.
  const { problems } = uil("I", [...live("I"), game("area", "2026-11-20", "Robert Lee", "Rankin")]);
  assert.deepEqual(problems.map((p) => p.key), ["bracket UIL I lost Robert Lee area"]);
  assert.match(problems[0].text, /Robert Lee lost bi-district 2026-11-12 Water Valley v Robert Lee but is listed in area 2026-11-20 Rankin v Robert Lee/);
});

test("a later-round game must hold the winners of its feeders, and every winner must be placed", () => {
  const wv = live("I").map((g) => (g.round === "area" ? { ...g, homeScore: 60, awayScore: 30, confirmed: true } : g));
  // Water Valley won its area game, but the regional lists Borden County (who lost) against Menard.
  const { problems } = uil("I", [...wv, otherArea([28, 44]), game("regional", "2026-11-27", "Borden County", "Menard")]);
  const keys = problems.map((p) => p.key).sort();
  assert.deepEqual(keys, ["bracket UIL I closed:regional-2", "bracket UIL I closed:regional-2 placed", "bracket UIL I lost Borden County regional"]);
  assert.match(problems.find((p) => p.key === "bracket UIL I closed:regional-2").text, /should have Water Valley, the winner of the game that feeds it/);
  assert.match(problems.find((p) => p.key.endsWith("placed")).text, /Water Valley won its game but regional 2026-11-27 Menard v Borden County is listed in its place/);
});

test("two semifinals feed the final: UIL's is the state game, anyone else's the final", () => {
  const semis = [game("semifinal", "2026-12-05", "Jayton", "Water Valley", [50, 40]), game("semifinal", "2026-12-05", "Milford", "Medina")];
  const u = uil("I", [...live("I"), ...semis]);
  assert.deepEqual(u.built, ["state: Jayton vs winner of Medina–Milford"]);
  const tapps = bracketSlots([], semis, { league: "TAPPS", division: "I" });
  assert.equal(tapps.find((s) => s.slot === "closed:final").round, "final");
  // A private league never gets UIL regions (ADR 0012).
  const areas = [game("area", "d", "Menard", "Rankin"), game("area", "d", "Water Valley", "Borden County")];
  assert.deepEqual(bracketSlots([], areas, { league: "TAPPS", division: "I", regionOf: (t) => REGIONS.I[t] }), []);
});

test("a league's own bracket: byes pass the team on, and the file's slots are used as written", () => {
  const rows = [
    { league: "TAIAO", division: "1", round: "round-1", slot: "NR1", a: "Team A", b: "bye" },
    { league: "TAIAO", division: "1", round: "round-1", slot: "NR2", a: "Team B", b: "Team C" },
    { league: "TAIAO", division: "1", round: "quarterfinal", slot: "NQ1", a: "winner:NR1", b: "winner:NR2" },
  ];
  const slots = bracketSlots(rows, [], { league: "TAIAO", division: "1", rename: (t) => (t === "Team C" ? "Team C Renamed" : t) });
  const r1 = [game("round-1", "2026-11-06", "Team B", "Team C Renamed")];
  assert.deepEqual(builtGames(fill(slots, r1, ROUND_ORDER)).map((b) => b.sides.map(sideText).join(" vs ")), ["Team A vs winner of Team C Renamed–Team B"]);
  const won = [game("round-1", "2026-11-06", "Team B", "Team C Renamed", [10, 20])];
  assert.deepEqual(builtGames(fill(slots, won, ROUND_ORDER)).map((b) => b.sides.map(sideText).join(" vs ")), ["Team A vs Team C Renamed"]);
  // Another league's or division's rows are not this bracket's.
  assert.deepEqual(bracketSlots(rows, [], { league: "TAIAO", division: "2" }), []);
});

test("check-data runs the checks on every bracket of the season, with disputed finals naming no winner", () => {
  const playoffs = [...ROWS, { league: "UIL", division: "I", round: "area", game_date: "2026-11-20", home: "Robert Lee", away: "Rankin", home_score: "", away_score: "" }];
  const alignments = Object.entries(REGIONS).flatMap(([division, m]) => Object.entries(m).map(([school, region]) => ({ league: "UIL", division, region, school })));
  const read = () => [];
  assert.deepEqual(checkBrackets(2026, ROWS, alignments, read, []), []);
  assert.deepEqual(checkBrackets(2026, playoffs, alignments, read, []).map((p) => p.key), ["bracket UIL I lost Robert Lee area"]);
  // The same loss read as disputed names no winner, so Robert Lee is not a loser.
  const disputed = (file) => (/disputed/.test(file) ? [{ game_date: "2026-11-12", home: "Robert Lee", away: "Water Valley" }] : []);
  assert.deepEqual(checkBrackets(2026, playoffs, alignments, disputed, []), []);
  // With UIL's bracket, Robert Lee v Rankin is also a pairing the bracket never makes.
  const withFile = (file, ...rest) => (file === "uil.csv" ? STRUCTURE : read(file, ...rest));
  const districts = new Map(STRUCTURE.flatMap((r) => [[`${r.division}|${r.a}`, r.a_seed.slice(1)], [`${r.division}|${r.b}`, r.b_seed.slice(1)]]));
  const aligned = alignments.map((a) => ({ ...a, district: districts.get(`${a.division}|${a.school}`) }));
  assert.deepEqual(checkBrackets(2026, ROWS, aligned, withFile, ["uil.csv"]), []);
  assert.deepEqual(checkBrackets(2026, playoffs, aligned, withFile, ["uil.csv"]).map((p) => p.key).sort(), ["bracket UIL I G20 placed", "bracket UIL I lost Robert Lee area", "bracket UIL I unplaced area Rankin v Robert Lee"]);
});
