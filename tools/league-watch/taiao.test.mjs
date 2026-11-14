import assert from "node:assert/strict";
import { test } from "node:test";
import { BRACKET_HEADER, bracketRows, checkTaiao, mergeBrackets, mergeInto, PAGE, parseBracket, parseBracketSlots, parseTaiao } from "./taiao.mjs";

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

// ---- Bracket tabs (ADR 0047): invented teams, in the text shape the Division N Bracket tab rendered on Nov 14, 2026. ----
/** One division's tab text: round 1 with a bye and scores, quarterfinals with one placed team, then "Winner" slots. */
function tab(d) {
  const t = (code, n) => `${n}. Team ${d}${code}${n}`;
  const lines = [`Division ${d} Playoffs`, "ROUND 1", "16 teams · Nov 6-8"];
  for (const code of ["NR1", "NR2", "NR3", "NR4", "SR1", "SR2", "SR3", "SR4"]) {
    lines.push(code, code[0] === "N" ? "NORTH" : "SOUTH", t(code, 1), " (H)");
    if (code === "NR1") lines.push("BYE", "Bye · advances to Quarterfinals");
    else lines.push("32", t(code, 8), "22", "Fri, Nov 6 · 7:30 PM", "1620 Main St, Somewhere, TX 79504");
  }
  lines.push("QUARTERFINALS", "8 teams · Nov 13-15");
  // NQ1: both teams placed by the page (the round-1 winners); the others still say "Winner".
  lines.push("NQ1", "NORTH", t("NR1", 1), " (H)", "40", t("NR2", 1), "20", "Sat, Nov 14 · 2:00 PM");
  lines.push("NQ2", "NORTH", "Winner NR3", "Winner NR4", "SQ1", "SOUTH", "Winner SR1", "Winner SR2", "SQ2", "SOUTH", "Winner SR3", "Winner SR4");
  lines.push("SEMIFINALS", "SF1", "Winner NQ1", "Winner SQ2", "SF2", "Winner SQ1", "Winner NQ2", "FINAL", "Winner SF1", "Winner SF2", "Watch livestream");
  return lines.join("\n");
}

test("a bracket tab gives each slot and what fills its two sides: a team, a bye, or the slot that feeds it", () => {
  const rows = bracketRows("1", parseBracketSlots(tab("1"), "1"));
  assert.equal(rows.length, 15);
  assert.deepEqual(rows[0], { league: "TAIAO", division: "1", round: "round-1", slot: "NR1", a: "Team 1NR11", b: "bye" });
  assert.deepEqual(rows[1], { league: "TAIAO", division: "1", round: "round-1", slot: "NR2", a: "Team 1NR21", b: "Team 1NR28" });
  // A team the page has placed is written as the slot it came from, so the file keeps the structure, not a result.
  assert.deepEqual(rows.find((r) => r.slot === "NQ1"), { league: "TAIAO", division: "1", round: "quarterfinal", slot: "NQ1", a: "winner:NR1", b: "winner:NR2" });
  assert.deepEqual(rows.find((r) => r.slot === "SF1"), { league: "TAIAO", division: "1", round: "semifinal", slot: "SF1", a: "winner:NQ1", b: "winner:SQ2" });
  assert.deepEqual(rows.at(-1), { league: "TAIAO", division: "1", round: "final", slot: "FINAL", a: "winner:SF1", b: "winner:SF2" });
});

test("a tab of another shape fails loudly instead of writing a bad bracket", () => {
  assert.throws(() => parseBracketSlots("Division 2 Playoffs", "1"), /no "Division 1 Playoffs"/);
  const short = tab("1").replace(/\nSR4\n[\s\S]*?QUARTERFINALS/, "\nQUARTERFINALS");
  assert.throws(() => bracketRows("1", parseBracketSlots(short, "1")), /8 round-1 slots expected, 7 read/);
  const orphan = tab("1").replace("NQ1\nNORTH\n1. Team 1NR11", "NQ1\nNORTH\n1. Team Nowhere");
  assert.throws(() => bracketRows("1", parseBracketSlots(orphan, "1")), /NQ1: Team Nowhere is in no round-1 slot/);
  const comma = tab("1").replace("1. Team 1NR21", "1. Team, Inc");
  assert.throws(() => bracketRows("1", parseBracketSlots(comma, "1")), /not a usable name/);
});

test("the bracket file keeps every other league's rows and replaces TAIAO's", () => {
  const rows = bracketRows("1", parseBracketSlots(tab("1"), "1"));
  const before = `${BRACKET_HEADER}\nTAIAO,1,final,FINAL,winner:SF1,winner:SF2\nTAPPS,I,final,F,winner:S1,winner:S2\n`;
  const out = mergeBrackets(before, rows).trim().split("\n");
  assert.equal(out[0], BRACKET_HEADER);
  assert.equal(out.length, 1 + 15 + 1);
  assert.equal(out.at(-1), "TAPPS,I,final,F,winner:S1,winner:S2");
  assert.equal(mergeBrackets("", rows).trim().split("\n").length, 16);
  assert.throws(() => mergeBrackets("a,b\n", rows), /unexpected header/);
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
