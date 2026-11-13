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

// Functions a signed-in user (never anon) may call, each as schema.name(argument types) so an overload with other
// arguments is not allowed by its name. Each acts only on auth.uid()'s own rows, or refuses unless auth.uid() is the
// admin; a migration that adds one adds its signature here, and the schema tests check it is not open to anon.
const SIGNED_IN_FUNCTIONS = [
  "public.is_admin()", "public.record_admin_audit(text, uuid, jsonb, jsonb, text)", "public.create_profile(text, integer, boolean)",
  "public.my_profile()", "public.delete_my_account()",
  // Fan follows (migration 0012): each acts on auth.uid()'s own rows.
  "public.follow_program(text)", "public.unfollow_program(text)", "public.my_follows()",
  // Posts (migrations 0013 to 0015, ADR 0018): each acts on auth.uid() and refuses a banned or muted account; the admin_*
  // ones refuse anyone who is not is_admin(). The owner's overrides write audit_log as the function's owner, so they need no
  // table right either.
  "public.add_comment(text, text)", "public.edit_post(uuid, text, text)", "public.flag_post(uuid)",
  "public.admin_unhide_post(uuid, text)", "public.admin_unmute(uuid, text)", "public.admin_set_ban(uuid, boolean, text)",
  "public.admin_moderation_overview()", "public.submit_score_report(text, integer, integer)",
  "public.create_thread(text, text, text)", "public.reply_to_thread(uuid, text)",
];

// Public reads, open to anon and authenticated alike: they return display names, text and counts, never a user id,
// birth year or email (migrations 0013 to 0015, ADR 0018). The push sign-up pair (0008) is open to both as well.
const ANON_FUNCTIONS = [
  "public.list_comments(text, integer, integer)", "public.fan_score_status(text)", "public.forum_boards()",
  "public.forum_threads(text, integer, integer)", "public.forum_thread_info(uuid)", "public.forum_posts(uuid, integer, integer)",
  "public.push_follow(text, text, text, text[])", "public.push_unfollow(text)", "public.live_scores()",
];

/** Schemas the project owns and the API could reach. */
const OWNED_SCHEMAS = ["public", "ops"];

/**
 * Erase sign-ups nobody finished (ADR 0018): a Supabase Auth user older than `days` with no fan profile, not in
 * admin_user, and created AFTER the first fan profile existed. Anyone can make an Auth user straight through Supabase's
 * public API, so the site cannot mark who started fan sign-up; this rule needs no mark. Before any fan has finished sign-up
 * (no profile at all) nothing is erased, so an account made before launch (the admin's, before its id is in admin_user)
 * is never touched. The user's copies in auth.flow_state and auth.audit_log_entries (no foreign key to auth.users; the log
 * holds the email and IP) go first, where those tables exist, in one transaction. Returns only a count: no address or id is
 * read out or logged. Does nothing where Supabase's auth schema is missing (the tests' plain Postgres without it).
 */
export async function purgeUnfinishedSignups(db, { days = 7 } = {}) {
  const { rows } = await db.query(
    "select to_regclass('auth.users') is not null as users, to_regclass('auth.flow_state') is not null as flow, to_regclass('auth.audit_log_entries') is not null as audit",
  );
  if (!rows[0].users) return 0;
  return db.transaction(async (tx) => {
    const victims = await tx.query(
      `select u.id::text as id from auth.users u
        where u.created_at < now() - make_interval(days => $1::int)
          and u.created_at > (select min(created_at) from profile)
          and not exists (select 1 from profile p where p.user_id = u.id)
          and not exists (select 1 from admin_user a where a.user_id = u.id)`,
      [days],
    );
    const ids = victims.rows.map((r) => r.id);
    if (!ids.length) return 0;
    if (rows[0].flow) await tx.query("delete from auth.flow_state where user_id = any($1::uuid[])", [ids]);
    if (rows[0].audit) {
      await tx.query("delete from auth.audit_log_entries where payload->>'actor_id' = any($1::text[]) or payload->'traits'->>'user_id' = any($1::text[])", [ids]);
    }
    await tx.query("delete from auth.users where id = any($1::uuid[])", [ids]);
    return ids.length;
  });
}

/**
 * The schema test's rules, checked on the live database after every load: row-level security on every public table,
 * and Supabase's API roles (anon, authenticated) holding NO rights on any table, view or sequence (migration 0005), by any
 * route: a direct grant, a column grant, or a grant to PUBLIC, which has_*_privilege counts as the role's own. The only
 * thing they may do is call a function: ANON_FUNCTIONS (the push sign-up pair, 0008, and the public reads) for both, SIGNED_IN_FUNCTIONS for signed-in users
 * (is_admin and record_admin_audit from 0010, the fan profile functions from 0011, the follow functions from 0012). No policy is expected anywhere: with
 * no table rights a policy would only be an unreviewed way in.
 */
export async function checkLive(db) {
  const problems = [];
  const noRls = await db.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`,
  );
  for (const r of noRls.rows) problems.push(`public.${r.relname} has no row-level security`);
  // Effective table rights (direct, inherited from PUBLIC, or column-level) on every table, view, materialized view,
  // foreign table and partitioned table.
  const tables = await db.query(
    `select r.rolname as grantee, n.nspname as schema, c.relname as name,
            string_agg(p.priv, ',' order by p.priv) filter (where has_table_privilege(r.rolname, c.oid, p.priv)) as rights,
            string_agg(p.priv, ',' order by p.priv) filter (
              where p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                and has_any_column_privilege(r.rolname, c.oid, p.priv) and not has_table_privilege(r.rolname, c.oid, p.priv)) as column_rights
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join pg_roles r
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
       where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f') and r.rolname in ('anon', 'authenticated')
       group by 1, 2, 3 order by 1, 2, 3`,
    [OWNED_SCHEMAS],
  );
  for (const t of tables.rows) {
    if (t.rights) problems.push(`${t.grantee} holds ${t.rights} on ${t.schema}.${t.name}`);
    if (t.column_rights) problems.push(`${t.grantee} holds column ${t.column_rights} on ${t.schema}.${t.name}`);
  }
  // Sequences: no USAGE, SELECT or UPDATE. (An INSERT through a function runs as the function's owner.)
  const sequences = await db.query(
    `select r.rolname, n.nspname, c.relname, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
       cross join pg_roles r cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(priv)
       where n.nspname = any($1) and c.relkind = 'S' and r.rolname in ('anon', 'authenticated')
         and has_sequence_privilege(r.rolname, c.oid, p.priv)
       order by 3, 1, 4`,
    [OWNED_SCHEMAS],
  );
  for (const q of sequences.rows) problems.push(`${q.rolname} holds ${q.priv} on sequence ${q.nspname}.${q.relname}`);
  // Functions the API roles can run, directly or through PUBLIC. Trigger and event trigger functions (Supabase's own
  // rls_auto_enable) cannot be called, by the API or anyone, so are left out.
  const runnable = await db.query(
    `select r.rolname, sig.name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       cross join pg_roles r
       cross join lateral (select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as name) sig
       where n.nspname = any($2) and r.rolname in ('anon', 'authenticated')
         and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
         and not (sig.name = any($1) and r.rolname = 'authenticated')
         and not sig.name = any($3)
         and has_function_privilege(r.rolname, p.oid, 'execute')
       order by 2, 1`,
    [SIGNED_IN_FUNCTIONS, OWNED_SCHEMAS, ANON_FUNCTIONS],
  );
  for (const f of runnable.rows) problems.push(`${f.rolname} can run ${f.name}`);
  // A security-definer function that does not pin its search_path can be made to run a look-alike from another schema.
  const unpinned = await db.query(
    `select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1) and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
      order by 1`,
    [OWNED_SCHEMAS],
  );
  for (const f of unpinned.rows) problems.push(`${f.name} is security definer with no search_path`);
  // Policies: none expected anywhere.
  const policies = await db.query(`select tablename, policyname from pg_policies where schemaname = any($1) order by 1, 2`, [OWNED_SCHEMAS]);
  for (const p of policies.rows) problems.push(`unexpected policy ${p.policyname} on public.${p.tablename}`);
  return problems;
}

/** node-postgres behind the same transaction/query/exec shape as PGlite, which the importers are written against. */
export function adapt(client) {
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
    // After the security check, and on its own: a failure here is reported (the error code only) but never fails the load.
    try {
      report.unfinishedSignupsRemoved = await purgeUnfinishedSignups(db);
    } catch (error) {
      report.purgeError = String(error?.code ?? "unknown");
    }
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
