import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parseGames, seedGames } from "../games.mjs";
import { parseAlignments, seedAlignments, slugify } from "../seed.mjs";

const dir = new URL("../migrations/", import.meta.url);
const csv = readFileSync(new URL("../../../data/seed/uil-2026-28/alignments.csv", import.meta.url), "utf8");
const rows = parseAlignments(csv);
const opts = { seasons: [2026, 2027], retrievedOn: "2026-11-10", reason: "test" };
let db;

const count = async (sql) => (await db.query(`select count(*)::int as n ${sql}`)).rows[0].n;

before(async () => {
  db = new PGlite();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
});

test("the CSV matches UIL's current alignment counts", () => {
  assert.equal(rows.filter((r) => r.division === "I").length, 79);
  assert.equal(rows.filter((r) => r.division === "II").length, 78); // the June 15 revision
});

test("each division has 16 districts of at least three schools", () => {
  for (const division of ["I", "II"]) {
    const sizes = {};
    for (const r of rows.filter((x) => x.division === division)) sizes[r.district] = (sizes[r.district] ?? 0) + 1;
    assert.equal(Object.keys(sizes).length, 16);
    assert.ok(Object.values(sizes).every((n) => n >= 3));
  }
});

test("names become stable slugs", () => {
  assert.equal(slugify("O'Donnell"), "odonnell");
  assert.equal(slugify("Lueders-Avoca"), "lueders-avoca");
  assert.equal(slugify("Mertzon Irion County"), "mertzon-irion-county");
});

test("the import creates a program and two team-seasons per school, with a source", async () => {
  const result = await seedAlignments(db, rows, opts);
  assert.deepEqual(result, { rows: 157, programsAdded: 157 });
  assert.equal(await count("from program"), 157);
  assert.equal(await count("from team_season"), 314);
  assert.equal(await count("from team_season where source_document_id is null"), 0);
  assert.equal(await count("from source_document"), 2);
});

test("running the import again adds nothing and is audited", async () => {
  const result = await seedAlignments(db, rows, opts);
  assert.deepEqual(result, { rows: 157, programsAdded: 0 });
  assert.equal(await count("from program"), 157);
  assert.equal(await count("from team_season"), 314);
  assert.equal(await count("from audit_log where entity = 'alignment_import'"), 2);
});

test("a malformed row is refused", () => {
  assert.throws(() => parseAlignments("league,division,region,district,school,source_url\nUIL,I,1"), /bad row 2/);
});

test("private leagues load beside UIL, and regions and missing districts are stored", async () => {
  const text = readFileSync(new URL("../../../data/seed/private-2026/alignments.csv", import.meta.url), "utf8");
  const result = await seedAlignments(db, parseAlignments(text), { ...opts, seasons: [2026] });
  // 56 rows, 55 programs: Sherman Grayson Christian School is on TAIAO's list and TCAF's (ADR 0012).
  assert.deepEqual(result, { rows: 56, programsAdded: 55 });
  assert.equal(await count("from team_season where league = 'TAIAO' and district is null and region in ('North', 'South')"), 46);
  assert.equal(await count("from team_season_league where league = 'TCAF' and region is null"), 9);
  // Community Christian (Mineral Wells) is in TCAF by its own site with no district known; CenTex Chargers name no league.
  assert.equal(await count("from team_season where league = 'TCAF' and district = 'District not listed'"), 1);
  assert.equal(await count("from team_season where league = 'Independent' and district = 'Independent'"), 1);
  assert.equal(await count("from team_season where league = 'UIL' and division = 'I' and district = '5' and region <> '2'"), 0);
  assert.equal(await count("from team_season where league = 'UIL' and division = 'II' and district = '16' and region = '4'") > 0, true);
});

test("a school two leagues list is one program and one team-season, in both leagues, and stays so on a rerun", async () => {
  const grayson = `from team_season ts join program p on p.id = ts.program_id where p.slug = 'sherman-grayson-christian-school' and ts.season = 2026`;
  const leagues = async () =>
    (await db.query(`select l.league, l.district, l.region from team_season_league l join team_season ts on ts.id = l.team_season_id
      join program p on p.id = ts.program_id where p.slug = 'sherman-grayson-christian-school' order by l.league`)).rows;
  for (let run = 0; run < 2; run++) {
    if (run) await seedAlignments(db, parseAlignments(readFileSync(new URL("../../../data/seed/private-2026/alignments.csv", import.meta.url), "utf8")), { ...opts, seasons: [2026] });
    assert.equal(await count(grayson), 1);
    assert.equal((await db.query(`select ts.league ${grayson}`)).rows[0].league, "TAIAO"); // listed first in the file
    assert.deepEqual(await leagues(), [
      { league: "TAIAO", district: null, region: "North" },
      { league: "TCAF", district: "2", region: null },
    ]);
  }
  // Every sourced team-season is in its own league too.
  assert.equal(await count("from team_season ts where source_document_id is not null and not exists (select 1 from team_season_league l where l.team_season_id = ts.id and l.league = ts.league)"), 0);
});

test("one league listing a school twice is refused", async () => {
  const row = { league: "TCAF", division: "Six-Man", region: "", district: "1", school: "Cedar Gap", source_url: "https://example.test/x" };
  await assert.rejects(seedAlignments(db, [row, { ...row, district: "2" }], opts), /duplicate slugs: cedar-gap\|TCAF/);
});

test("TAPPS loads for both seasons of its alignment, beside every other league", async () => {
  const text = readFileSync(new URL("../../../data/seed/tapps-2026-28/alignments.csv", import.meta.url), "utf8");
  const tapps = parseAlignments(text);
  const result = await seedAlignments(db, tapps, opts);
  assert.deepEqual(result, { rows: tapps.length, programsAdded: tapps.length });
  assert.ok(tapps.length >= 40);
  assert.equal(await count("from team_season where league = 'TAPPS'"), tapps.length * 2);
  assert.ok((await count("from team_season where league = 'TAPPS' and district in ('Independent', 'Non-Aligned')")) > 0);
});

test("every hand-captured 2026 playoff game names teams that exist", async () => {
  const text = readFileSync(new URL("../../../data/seed/uil-2026-28/playoffs-2026.csv", import.meta.url), "utf8");
  const games = parseGames(text);
  const result = await seedGames(db, games, { season: 2026, retrievedOn: "2026-11-10", reason: "test" });
  assert.equal(result.inserted + result.updated + result.unchanged, games.length);
  assert.deepEqual(result.flags, [], "a captured score trips a six-man check; confirm it against the source");
});

test("a school already in another league that season is refused", async () => {
  const row = { league: "OTHER", division: "1", region: "", district: "1", school: "Boys Ranch", source_url: "https://example.test/x" };
  await assert.rejects(seedAlignments(db, [row], opts), /already UIL/);
});
