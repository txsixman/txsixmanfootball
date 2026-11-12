// Loads the hosted database (Supabase) from the repo: applies new migrations, then every alignment and game file.
// Safe to re-run: migrations are applied once each, and the importers update rows in place.
//
//   PGHOST=… PGUSER=… PGPASSWORD="$(security find-generic-password -s project-80x40-supabase-db -w)" \
//     PGSSLROOTCERT=packages/db/supabase-ca.crt node packages/db/load.mjs
//
// The password comes from the macOS Keychain, never the repo. PGPORT defaults to 5432 and PGDATABASE to postgres.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFinals, seedFinals } from "./champions.mjs";
import { parseGames, seedGames } from "./games.mjs";
import { parseLineage, seedLineage } from "./lineage.mjs";
import { parseAlignments, seedAlignments, slugify } from "./seed.mjs";

const MIGRATIONS = new URL("./migrations/", import.meta.url);
const SEED = new URL("../../data/seed/", import.meta.url);
// Robot-read games (maxpreps-<season>/) with their source pages, and teams.csv, are in the private data repo, checked out
// at PRIVATE_DATA by the workflows that load the hosted database. data/seed holds only their facts, with no source column.
const RESULTS = process.env.PRIVATE_DATA ? pathToFileURL(`${process.env.PRIVATE_DATA.replace(/\/$/, "")}/`) : SEED;
/** A facts-only copy's stand-in source, for a test load (`publicResults`); a hosted load refuses those files. */
const PUBLIC_SOURCE = "https://example.org/robot-read-source-kept-private";

/** State finals by league, written by tools/history/. */
const FINALS = [{ file: "uil-champions/six-man.csv", league: "UIL" }];

/** Mergers and renames, by hand, one cited source a row (ADR 0003). After alignments, before finals. */
const LINEAGE = "lineage/programs.csv";

const ALIGNMENTS = [
  { file: "uil-2026-28/alignments.csv", seasons: [2026, 2027] },
  { file: "private-2026/alignments.csv", seasons: [2026] },
  { file: "tapps-2026-28/alignments.csv", seasons: [2026, 2027] },
];

/** Applies each migration not yet recorded in ops.schema_migrations (outside `public`, so the API never serves it). */
export async function migrate(db) {
  await db.exec(`create schema if not exists ops;
    create table if not exists ops.schema_migrations (file text primary key, applied_at timestamptz not null default now());
    revoke all on schema ops from public;`);
  const done = new Set((await db.query("select file from ops.schema_migrations")).rows.map((r) => r.file));
  const applied = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
      await tx.query("insert into ops.schema_migrations (file) values ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

/**
 * Alignments are only seeded from 2026, so a robot-read earlier season has no team-seasons for its games. Each school in
 * that season's teams.csv gets one, with league copied from its nearest later season and division, region and district
 * left empty (they are not known for the past season). Safe to re-run.
 */
async function pastTeamSeasons(db) {
  const added = [];
  for (const dir of readdirSync(RESULTS).filter((d) => /^maxpreps-\d{4}$/.test(d)).sort()) {
    const season = Number(dir.slice(-4));
    const file = new URL(`${dir}/teams.csv`, RESULTS);
    const games = new URL(`${dir}/games.csv`, RESULTS);
    if (season >= Math.min(...ALIGNMENTS.flatMap((a) => a.seasons)) || !(existsSync(file) || existsSync(games))) continue;
    // teams.csv (private) lists every team page read; a facts-only copy has none, so the teams in its games stand in.
    const slugs = existsSync(file)
      ? readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[0])
      : [...new Set(readFileSync(games, "utf8").trim().split("\n").slice(1).flatMap((l) => l.split(",").slice(3, 5).map(slugify)))];
    const { rows } = await db.query(
      `insert into team_season (program_id, season, league, format)
       select distinct on (p.id) p.id, $1::int, t.league, 6 from program p
         join team_season t on t.program_id = p.id and t.season > $1::int
        where p.slug = any($2) order by p.id, t.season
       on conflict (program_id, season) do nothing returning id`,
      [season, slugs],
    );
    added.push({ season, teamSeasons: rows.length });
  }
  return added;
}

/**
 * A program the alignment files no longer list, with no game, no state final and no lineage row, is a leftover of a
 * rename or a merge in the seed (Grayson Christian became one program under its TAIAO name, Nov 11, 2026). It is removed
 * with its team-seasons, their leagues, and any school that only it used; each removal writes the rows it took to
 * audit_log first (the owner, Nov 12, 2026). Programs kept only for history (finals, lineage) are never touched.
 */
export async function removeOrphanPrograms(db, listed, { reason }) {
  const { rows } = await db.query(
    `select p.id, p.slug from program p
      where p.slug <> all($1::text[])
        and not exists (select 1 from state_final f where p.id in (f.champion_program_id, f.runner_up_program_id))
        and not exists (select 1 from program_lineage l where p.id in (l.predecessor_id, l.successor_id))
        and not exists (select 1 from team_season t join game g on t.id in (g.home_ts, g.away_ts) where t.program_id = p.id)
      order by p.slug`,
    [listed],
  );
  for (const p of rows) {
    await db.transaction(async (tx) => {
      const before = (await tx.query(
        `select $2::text as slug,
           (select coalesce(jsonb_agg(jsonb_build_object('season', t.season, 'league', t.league, 'district', t.district,
              'leagues', (select coalesce(jsonb_agg(l.league order by l.league), '[]') from team_season_league l where l.team_season_id = t.id))
              order by t.season), '[]') from team_season t where t.program_id = $1) as team_seasons,
           (select coalesce(jsonb_agg(s.canonical_name order by s.canonical_name), '[]')
              from program_school ps join school s on s.id = ps.school_id where ps.program_id = $1) as schools`,
        [p.id, p.slug],
      )).rows[0];
      await tx.query("insert into audit_log (entity, entity_id, before, reason) values ('program', $1, $2, $3)", [
        p.id,
        JSON.stringify(before),
        `${reason}: no longer in any alignment file, no games`,
      ]);
      const schools = (await tx.query("delete from program_school where program_id = $1 returning school_id", [p.id])).rows.map((r) => r.school_id);
      await tx.query("delete from team_season where program_id = $1", [p.id]);
      await tx.query("delete from program where id = $1", [p.id]);
      const unused = `select id from school where id = any($1::uuid[]) and not exists (select 1 from program_school ps where ps.school_id = school.id)`;
      await tx.query(`delete from school_alias where school_id in (${unused})`, [schools]);
      await tx.query(`delete from school where id in (${unused})`, [schools]);
    });
  }
  return rows.map((p) => p.slug);
}

/** Robot-read games first, hand captures last, so a hand-captured score wins over a robot row for the same game. */
function gameFiles() {
  const files = [];
  for (const dir of readdirSync(RESULTS).filter((d) => /^maxpreps-\d{4}$/.test(d)).sort()) {
    const season = Number(dir.slice(-4));
    files.push({ file: `${dir}/games.csv`, season, base: RESULTS }, { file: `${dir}/playoffs.csv`, season, base: RESULTS, dropLeague: true });
  }
  for (const dir of readdirSync(SEED)) {
    for (const f of existsSync(new URL(`${dir}/`, SEED)) ? readdirSync(new URL(`${dir}/`, SEED)) : []) {
      const m = /^playoffs-(\d{4})\.csv$/.exec(f);
      if (m) files.push({ file: `${dir}/${f}`, season: Number(m[1]), base: SEED });
    }
  }
  return files.filter((f) => existsSync(new URL(f.file, f.base)));
}

/**
 * A facts-only robot file (data/seed, no PRIVATE_DATA) has no source_url or notes column. A test load (`publicResults`)
 * gives each row a stand-in source; any other load refuses, so the hosted database never gets a row without its source.
 */
function withSource(text, file, publicResults) {
  const [header, ...rows] = text.trim().split("\n");
  if (header.split(",").includes("source_url")) return text;
  if (!publicResults) throw new Error(`${file} has no source column: set PRIVATE_DATA to the private data repo to load the hosted database`);
  return [`${header},source_url,notes`, ...rows.map((r) => `${r},${PUBLIC_SOURCE},`)].join("\n");
}

/** robot playoffs.csv carries a leading league column the importer does not take. */
const withoutLeague = (text) =>
  text.trim().split("\n").map((line) => line.slice(line.indexOf(",") + 1)).join("\n");

export async function loadAll(db, { retrievedOn, reason, publicResults = false }) {
  const report = { migrations: await migrate(db), alignments: [], lineage: null, games: [], finals: [], pastSeasons: [], removed: [] };
  const listed = new Set();
  for (const a of ALIGNMENTS) {
    const rows = parseAlignments(readFileSync(new URL(a.file, SEED), "utf8"));
    for (const r of rows) listed.add(slugify(r.school));
    report.alignments.push({ file: a.file, ...(await seedAlignments(db, rows, { seasons: a.seasons, retrievedOn, reason })) });
  }
  if (existsSync(new URL(LINEAGE, SEED))) {
    report.lineage = await seedLineage(db, parseLineage(readFileSync(new URL(LINEAGE, SEED), "utf8")), { retrievedOn, reason });
  }
  report.pastSeasons = await pastTeamSeasons(db);
  for (const g of gameFiles()) {
    const text = withSource(readFileSync(new URL(g.file, g.base), "utf8"), g.file, publicResults);
    const rows = parseGames(g.dropLeague ? withoutLeague(text) : text);
    if (!rows.length) continue;
    const { inserted, updated, unchanged, flags } = await seedGames(db, rows, { season: g.season, retrievedOn, reason });
    report.games.push({ file: g.file, inserted, updated, unchanged, flags: flags.length });
  }
  for (const f of FINALS.filter((f) => existsSync(new URL(f.file, SEED)))) {
    const rows = parseFinals(readFileSync(new URL(f.file, SEED), "utf8"));
    const { inserted, updated, linked, unlinked } = await seedFinals(db, rows, { league: f.league, retrievedOn, reason });
    report.finals.push({ file: f.file, inserted, updated, linked, unlinked: unlinked.length });
  }
  // Last, so every game and final this load wrote counts as a reason to keep a program.
  report.removed = await removeOrphanPrograms(db, [...listed], { reason });
  return report;
}

/**
 * The schema test's rules, checked on the live database after every load: row-level security on every public table,
 * and no table rights for Supabase's API roles until a migration grants them beside a policy (migration 0005).
 */
export async function checkLive(db) {
  const problems = [];
  const noRls = await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`,
  );
  for (const r of noRls.rows) problems.push(`public.${r.relname} has no row-level security`);
  const grants = await db.query(
    `select grantee, table_schema, table_name, string_agg(privilege_type, ',' order by privilege_type) as rights
       from information_schema.role_table_grants
       where grantee in ('anon', 'authenticated') and table_schema in ('public', 'ops')
       group by 1, 2, 3 order by 1, 2, 3`,
  );
  for (const g of grants.rows) problems.push(`${g.grantee} holds ${g.rights} on ${g.table_schema}.${g.table_name}`);
  // Functions the API roles can run, directly or through PUBLIC: only the push sign-up pair (migration 0008). Trigger
  // and event trigger functions (Supabase's own rls_auto_enable) cannot be called, by the API or anyone, so are left out.
  const runnable = await db.query(
    `select r.rolname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join pg_roles r
       where n.nspname = 'public' and r.rolname in ('anon', 'authenticated')
         and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
         and p.proname not in ('push_follow', 'push_unfollow') and has_function_privilege(r.rolname, p.oid, 'execute')
       order by 2, 1`,
  );
  for (const f of runnable.rows) problems.push(`${f.rolname} can run public.${f.proname}()`);
  return problems;
}

/** node-postgres behind the same transaction/query/exec shape as PGlite, which the importers are written against. */
function adapt(client) {
  const db = {
    query: (sql, params) => client.query(sql, params),
    exec: (sql) => client.query(sql),
    transaction: async (fn) => {
      await client.query("begin");
      try {
        const result = await fn(db);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    },
  };
  return db;
}

async function main() {
  for (const name of ["PGHOST", "PGUSER", "PGPASSWORD"]) if (!process.env[name]) throw new Error(`${name} is not set`);
  const { default: pg } = await import("pg");
  // Verify the server certificate: against Supabase's CA when PGSSLROOTCERT is given, else the system's.
  const ssl = process.env.PGSSLROOTCERT ? { ca: readFileSync(process.env.PGSSLROOTCERT, "utf8") } : true;
  const client = new pg.Client({ database: process.env.PGDATABASE || "postgres", ssl });
  await client.connect();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const db = adapt(client);
    const report = await loadAll(db, { retrievedOn: today, reason: "packages/db/load.mjs" });
    report.problems = await checkLive(db);
    console.log(JSON.stringify(report, null, 2));
    if (report.problems.length) throw new Error(`live database checks failed:\n${report.problems.join("\n")}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
