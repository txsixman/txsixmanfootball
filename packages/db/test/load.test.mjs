import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { loadAll, loadSeasonGames } from "../load.mjs";
import { seedAlignments } from "../seed.mjs";

// The whole repo load the hosted database gets, run on a throwaway database: every team in every game file must exist.
test("every migration, alignment and game file loads, and a second run changes nothing new", async () => {
  const db = new PGlite();
  // publicResults: without PRIVATE_DATA (pull requests) the facts-only robot files load with a stand-in source.
  const opts = { retrievedOn: "2026-11-10", reason: "test", publicResults: !process.env.PRIVATE_DATA };
  const first = await loadAll(db, opts);
  assert.ok(first.migrations.length >= 4);
  const games = (await db.query("select count(*)::int as n from game")).rows[0].n;
  assert.ok(games > 1000, `only ${games} games loaded`);
  const typed = (await db.query("select count(*)::int as n from game where game_type = 'playoff'")).rows[0].n;
  assert.ok(typed > 0 && typed < games);

  const [finals] = first.finals;
  assert.ok(finals.inserted >= 70, `only ${finals.inserted} UIL six-man finals`);
  assert.ok(finals.linked > finals.unlinked, "most finalists should match a current program");
  const titles = (await db.query(
    "select count(*)::int as n from state_final f join program p on p.id = f.champion_program_id where p.slug = 'jayton'",
  )).rows[0].n;
  assert.ok(titles >= 1, "a known champion links to its program");

  assert.equal(first.lineage.inserted, 3);
  const now = await db.query(
    `select f.season, p.slug as was, s.slug as now from state_final f
       join program_lineage l on l.predecessor_id = f.runner_up_program_id
       join program p on p.id = l.predecessor_id join program s on s.id = l.successor_id
       join source_document d on d.id = l.source_document_id order by 1`,
  );
  assert.deepEqual(now.rows.map((r) => `${r.season} ${r.was} ${r.now}`), ["1983 mozelle valera-panther-creek", "1987 wellman wellman-union"]);

  const obrien = await db.query(
    `select f.season, p.slug as was, s.slug as now from state_final f
       join program_lineage l on l.predecessor_id = f.champion_program_id
       join program p on p.id = l.predecessor_id join program s on s.id = l.successor_id where p.slug = 'obrien'`,
  );
  assert.deepEqual(obrien.rows.map((r) => `${r.season} ${r.was} ${r.now}`), ["1972 obrien knox-city"], "the 1972 champion reaches Knox City");

  const second = await loadAll(db, opts);
  assert.equal(second.lineage.inserted, 0);
  assert.equal(second.lineage.programsAdded, 0);
  assert.equal(second.finals[0].inserted, 0);
  assert.deepEqual(second.migrations, []);
  assert.equal(second.games.reduce((n, g) => n + g.inserted, 0), 0);
  assert.equal(second.games.reduce((n, g) => n + g.updated, 0), 0, "a rerun on the same files changes no game");
  assert.equal((await db.query("select count(*)::int as n from game")).rows[0].n, games);
  assert.deepEqual(first.removed, [], "a full load leaves no program behind to remove");
  assert.deepEqual(second.removed, []);

  // A program the seed no longer lists, with no games (the old grayson-christian), goes on the next load, with an
  // audit_log row holding what it was; programs kept for finals or lineage stay though no alignment lists them.
  await seedAlignments(db, [{ league: "TCAF", division: "TCAF", region: "", district: "2", school: "Gone Christian", source_url: "https://example.org/gone" }], {
    seasons: [2026],
    ...opts,
  });
  const programs = (await db.query("select count(*)::int as n from program")).rows[0].n;
  const third = await loadAll(db, opts);
  assert.deepEqual(third.removed, ["gone-christian"]);
  assert.equal((await db.query("select count(*)::int as n from program")).rows[0].n, programs - 1);
  for (const sql of [
    "select 1 from program where slug = 'gone-christian'",
    "select 1 from school where canonical_name = 'Gone Christian'",
    "select 1 from school_alias where name = 'Gone Christian'",
  ]) {
    assert.equal((await db.query(sql)).rows.length, 0, sql);
  }
  const [audit] = (await db.query("select before, reason from audit_log where entity = 'program'")).rows;
  assert.equal(audit.before.slug, "gone-christian");
  assert.deepEqual(audit.before.schools, ["Gone Christian"]);
  assert.deepEqual(audit.before.team_seasons.map((t) => `${t.season} ${t.league} ${t.leagues.join("+")}`), ["2026 TCAF TCAF"]);
  assert.match(audit.reason, /no longer in any alignment file/);
  for (const slug of ["obrien", "mozelle"]) {
    assert.equal((await db.query("select 1 from program where slug = $1", [slug])).rows.length, 1, `${slug} stays for its final or lineage`);
  }
  assert.deepEqual((await loadAll(db, opts)).removed, [], "nothing more to remove");
});

test("one season's games (Results watch, ADR 0031): after the full load it changes nothing, and it never deletes a game", async () => {
  const db = new PGlite();
  const opts = { retrievedOn: "2026-11-10", reason: "test", publicResults: !process.env.PRIVATE_DATA };
  await loadAll(db, opts);
  const count = async () => (await db.query("select count(*)::int as n from game where season = 2026")).rows[0].n;
  const before = await count();
  const report = await loadSeasonGames(db, 2026, opts);
  assert.ok(report.length >= 2, "the season's games.csv and playoffs.csv");
  for (const r of report) {
    assert.equal(r.inserted, 0, r.file);
    assert.equal(r.updated, 0, r.file);
    assert.ok(r.unchanged > 0, r.file);
  }
  // A game the files no longer hold stays in the database: a load only inserts and updates.
  await db.query("insert into game (season, game_date, home_ts, away_ts, status, game_type) select season, '2026-08-01', home_ts, away_ts, 'scheduled', 'nondistrict' from game where season = 2026 limit 1");
  const withExtra = await count();
  await loadSeasonGames(db, 2026, opts);
  assert.equal(await count(), withExtra);
  assert.ok(withExtra >= before);
});
