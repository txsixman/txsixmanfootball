import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTaiao, mergeInto, PAGE, parseTaiao } from "./taiao.mjs";

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
