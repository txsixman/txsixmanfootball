import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTaiao, mergeInto, PAGE, parseBracket, parseTaiao } from "./taiao.mjs";

// Invented teams, in the table shape taiao.org rendered on Nov 10, 2026 (ADR 0005).
const regions = ["North", "South"];
const tables = ["1", "2", "3"].flatMap((d) =>
  regions.map((r) => ({ heading: `Division ${d} ${r}`, teams: Array.from({ length: 6 }, (_, i) => ` Team ${d}${r[0]}${i} `) })),
);

test("reads division, region and team from each table, and nothing else", () => {
  const rows = parseTaiao(tables);
  assert.equal(rows.length, 36);
  assert.deepEqual(rows[0], { division: "1", region: "North", school: "Team 1N0" });
  assert.throws(() => parseTaiao([{ heading: "Middle School", teams: [] }]), /unexpected table heading/);
});

test("fails loudly on a changed page, a new season, a duplicate or a comma", () => {
  const rows = parseTaiao(tables);
  assert.doesNotThrow(() => checkTaiao(rows, "2026 TAIAO Football Divisions & Playoffs"));
  assert.throws(() => checkTaiao(rows, "2027 TAIAO Football Divisions & Playoffs"), /writes 2026 only/);
  assert.throws(() => checkTaiao(rows.slice(0, 10), "2026 TAIAO"), /10 teams/);
  assert.throws(() => checkTaiao(rows.filter((r) => r.division !== "3"), "2026 TAIAO"), /no Division 3 North/);
  assert.throws(() => checkTaiao([...rows, rows[0]], "2026 TAIAO"), /listed twice: Team 1N0/);
  assert.throws(() => checkTaiao([...rows, { division: "1", region: "North", school: "A, B" }], "2026 TAIAO"), /not a usable name/);
});

test("replaces only the TAIAO rows and keeps other leagues' rows", () => {
  const before = [
    "league,division,region,district,school,source_url",
    `TAIAO,1,North,0,Old Team,${PAGE}`,
    "TCAF,Six-Man,,2,Mesa Ridge,https://example.test/tcaf",
  ].join("\n");
  const after = mergeInto(before, [{ division: "2", region: "South", school: "New Team" }]).trim().split("\n");
  assert.deepEqual(after.slice(1), [`TAIAO,2,South,0,New Team,${PAGE}`, "TCAF,Six-Man,,2,Mesa Ridge,https://example.test/tcaf"]);
});

// A bracket tab's text in the shape taiao.org showed on Nov 14, 2026 (ADR 0046); invented teams and places.
const BRACKET = `Teams & Weekly Rankings
Division 2 Bracket
Division 2 Playoffs
ROUND 1
NR1
NORTH
1. Lark Owls
 (H)
70
8. Wren Academy
6
Thu, Nov 5 · 6:00 PM
Lark Field, 100 Main St
SR1
SOUTH
1. Finch Falcons
 (H)
BYE
Bye · advances to Quarterfinals
NR3
NORTH
3. Robin Prep
 (H)
2
—. Jay Home School
0
Sat, Nov 7 · 5:00 PM
Forfeit
NQ1
1. Lark Owls
 (H)
68
4. Heron Homeschool
0
Fri, Nov 13 · 7:00 PM
Pacer Field 12
NQ2
3. Robin Prep
2. Crane Christian
 (H)
Sat, Nov 14 · 5:00 PM
SF2
1. Finch Falcons
 (H)
Winner NQ2
Date / Time TBD
FINAL
Winner SF1
Winner SF2
Jan 2 · TBD`;

test("a bracket tab gives each game's teams, home side, scores, date and forfeit word, and nothing else", () => {
  const games = parseBracket(BRACKET, 2026);
  assert.deepEqual(games.map((g) => g.code), ["NR1", "SR1", "NR3", "NQ1", "NQ2", "SF2", "FINAL"]);
  assert.deepEqual(games[0], { code: "NR1", date: "2026-11-05", forfeit: false, teams: [{ name: "Lark Owls", home: true, score: 70 }, { name: "Wren Academy", home: false, score: 6 }] });
  assert.equal(games[1].teams.length, 1, "a bye has one team");
  assert.equal(games[2].forfeit, true);
  assert.equal(games[2].teams[1].name, "Jay Home School", "an unseeded team");
  assert.deepEqual(games[3].teams.map((t) => t.score), [68, 0]);
  assert.equal(games[3].date, "2026-11-13");
  assert.equal(games[3].teams[1].score, 0, "the site's digits after the date are not a score");
  assert.deepEqual(games[4].teams.map((t) => [t.name, t.home, t.score]), [["Robin Prep", false, null], ["Crane Christian", true, null]]);
  assert.equal(games[4].date, "2026-11-14");
  assert.equal(games[5].teams.length, 1, "a Winner side is not a team");
  assert.equal(games[5].date, null);
  assert.equal(games[6].teams.length, 0);
  assert.deepEqual(parseBracket("no heading here\nNQ1\n1. Lark Owls"), [], "nothing before the Playoffs heading");
});
