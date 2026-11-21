// Helpers for the weekly fan-database backup (fan-backup.yml, ADR 0110). The workflow dumps and encrypts in a shell pipe; this
// file holds the parts that are plain logic and so are tested (fan-backup.test.mjs):
//
//   node .github/scripts/fan-backup.mjs tables                     the tables a restore needs, one per line (schema.table), after
//                                                                  checking the list against packages/db/migrations: fails when a
//                                                                  migration makes a table this file has not classified, or this file
//                                                                  names a table no migration makes
//   node .github/scripts/fan-backup.mjs counts-sql                 one SQL statement: "table|rows" for each of those tables
//   node .github/scripts/fan-backup.mjs commit <private-dir> <file> [--write]
//                                                                  puts the encrypted dump at backups/fan/<UTC date>.sql.age in the
//                                                                  data-private checkout, keeps the newest 8, commits and pushes
//                                                                  (without --write: says what it would do and changes nothing)
//
// Nothing here reads the database or a key, and nothing prints a row: names and counts only. Env for `commit`: DATA_PRIVATE_TOKEN
// (read and write on the private repo; handed to git for that one command as a header, never written to the checkout).

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const KEEP = 8;
export const BACKUP_DIR = "backups/fan";
/** The commit's author and committer: the project's own address, like every commit in this history. */
export const IDENTITY = { name: "TX Six-Man Football", email: "contact@txsixmanfootball.com" };

/** Fan-owned tables in `public`: what a fan or an admin wrote, and what the senders recorded about them. */
export const FAN_TABLES = [
  "profile", // display name, birth year, muted and banned
  "follow", // the programs a signed-in fan follows
  "push_subscription", // browser push addresses and keys, with the account they belong to (migration 0023)
  "push_sent", // push alerts already sent, so a restore does not send them twice
  "email_optin", // who opted into which email
  "email_sent", // each email sent, so a restore does not send them twice
  "email_unsubscribe_token",
  "email_game_event", // the game events the email sender has seen (its dedupe)
  "post", // comments, forum posts and thread openers
  "post_edit",
  "post_flag", // reports
  "forum_thread",
  "fan_score_report",
  "score_submission", // raw score evidence; never deleted
  "admin_user", // who may use the admin console
  "audit_log", // append-only: moderation and admin actions
];

/** Supabase Auth's own tables a restore needs: the account behind each profile. */
export const AUTH_TABLES = ["auth.users", "auth.identities"];

/** Every other table the migrations make, and why it is not in the backup. A new table must be classified here or in FAN_TABLES. */
export const NOT_BACKED_UP = {
  school: "rebuilt from the repo's alignment files by packages/db/load.mjs",
  school_alias: "rebuilt by load.mjs",
  program: "rebuilt by load.mjs",
  program_school: "rebuilt by load.mjs",
  program_lineage: "rebuilt by load.mjs",
  coach: "rebuilt by load.mjs (no fan data)",
  venue: "rebuilt by load.mjs",
  team_season: "rebuilt by load.mjs",
  team_season_league: "rebuilt by load.mjs",
  game: "rebuilt by load.mjs from the game files",
  source_document: "rebuilt by load.mjs",
  state_final: "rebuilt by load.mjs",
  live_score: "replaced every game-day read, never older than 6 hours",
  read_status: "one row, replaced every read",
  bracket_pairing: "rebuilt from the bracket files by load.mjs",
  forum_board: "five fixed boards, seeded by migration 0015",
  moderation_term: "the open word list, seeded by migration 0013 (a change is a migration)",
  site_switch: "seeded closed by the migrations; a restored project opens posts and alerts on purpose, never by a restore",
};

/** Names of the tables the migrations create in `public`, minus any dropped (comments stripped; only a statement at the start of a line counts). */
export function migrationTables(dir) {
  const created = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?"?([a-z_][a-z0-9_]*)"?/gim)) {
      if (!m[1] || m[1] === "public") created.add(m[2].toLowerCase());
    }
    for (const m of sql.matchAll(/^\s*drop\s+table\s+(?:if\s+exists\s+)?(?:(\w+)\.)?"?([a-z_][a-z0-9_]*)"?/gim)) {
      if (!m[1] || m[1] === "public") created.delete(m[2].toLowerCase());
    }
  }
  return created;
}

/** The sequences behind serial columns, by table (`<table>_<column>_seq`): a restore needs them set past the restored ids. */
export function migrationSequences(dir) {
  const bySeq = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
    for (const m of sql.matchAll(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\n\);/gim)) {
      for (const c of m[2].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+(?:big|small)?serial\b/gim)) (bySeq[m[1].toLowerCase()] ??= []).push(`${m[1].toLowerCase()}_${c[1].toLowerCase()}_seq`);
    }
  }
  return bySeq;
}

/** What does not line up: tables the migrations make that nobody classified, and classified names no migration makes. */
export function checkTables(created, fan = FAN_TABLES, other = Object.keys(NOT_BACKED_UP)) {
  const known = new Set([...fan, ...other]);
  const both = fan.filter((t) => other.includes(t));
  return {
    unclassified: [...created].filter((t) => !known.has(t)).sort(),
    missing: [...known].filter((t) => !created.has(t)).sort(),
    both: both.sort(),
  };
}

/** The qualified names a dump takes, auth first, then the fan tables and the sequences behind their serial columns. */
export const dumpTables = (fan = FAN_TABLES, sequences = []) => [...AUTH_TABLES, ...fan.map((t) => `public.${t}`), ...sequences.map((q) => `public.${q}`)];

/** One statement: "table|rows" per table. Names are ours and checked, so they are safe to put in SQL. */
export function countsSql(tables = dumpTables()) { // pass tables only, never sequences
  for (const t of tables) if (!/^[a-z_]+\.[a-z_]+$/.test(t)) throw new Error(`not a table name: ${t}`);
  return tables.map((t) => `select '${t}' as t, count(*) as n from ${t}`).join(" union all ") + " order by t";
}

/** The backups to delete: of the files named <date>.sql.age, all but the newest `keep`. Other files are never touched. */
export function pruneList(files, keep = KEEP) {
  const mine = files.filter((f) => /^\d{4}-\d{2}-\d{2}\.sql\.age$/.test(f)).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}

const run = (cwd, args, env = {}) => {
  const r = spawnSync("git", ["-c", `user.name=${IDENTITY.name}`, "-c", `user.email=${IDENTITY.email}`, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed (${(r.stderr || "").trim().split("\n")[0].replace(/AUTHORIZATION.*/i, "")})`);
  return r.stdout.trim();
};

/** The token as a header for one command's git calls (the checkout keeps no credentials); empty when there is none (tests). */
export function authEnv(token, base = process.env) {
  if (!token) return {};
  const n = Number(base.GIT_CONFIG_COUNT || 0);
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  return { GIT_CONFIG_COUNT: String(n + 1), [`GIT_CONFIG_KEY_${n}`]: "http.https://github.com/.extraheader", [`GIT_CONFIG_VALUE_${n}`]: header };
}

/** Lay the encrypted dump on the private repo's newest main, prune to the newest `keep`, commit, push. Three tries if main moved. */
export function commitBackup({ privateDir, file, date = new Date().toISOString().slice(0, 10), write = false, keep = KEEP, token = process.env.DATA_PRIVATE_TOKEN, log = console.log }) {
  const name = `${date}.sql.age`;
  const dir = path.join(privateDir, BACKUP_DIR);
  const net = authEnv(token);
  for (let attempt = 1; attempt <= 3; attempt++) {
    run(privateDir, ["fetch", "-q", "origin", "main"], net);
    run(privateDir, ["reset", "-q", "--hard", "origin/main"]);
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, path.join(dir, name));
    const drop = pruneList(readdirSync(dir), keep);
    for (const f of drop) rmSync(path.join(dir, f));
    const kept = readdirSync(dir).filter((f) => /\.sql\.age$/.test(f)).length;
    if (!write) {
      log(`Dry run: would commit ${BACKUP_DIR}/${name} and remove ${drop.length} older (${kept} kept). Nothing pushed.`);
      run(privateDir, ["reset", "-q", "--hard", "origin/main"]);
      run(privateDir, ["clean", "-q", "-fd", "--", BACKUP_DIR]);
      return { name, removed: drop, kept, pushed: false };
    }
    run(privateDir, ["add", "-A", "--", BACKUP_DIR]);
    run(privateDir, ["commit", "-q", "-m", `Fan database backup, ${date}`]);
    try {
      run(privateDir, ["push", "-q", "origin", "HEAD:main"], net);
      log(`Committed ${BACKUP_DIR}/${name}; removed ${drop.length} older; ${kept} kept.`);
      return { name, removed: drop, kept, pushed: true };
    } catch (e) {
      log(`data-private main moved; try ${attempt} again`);
      if (attempt === 3) throw e;
    }
  }
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "tables" || cmd === "counts-sql") {
    const dir = fileURLToPath(new URL("../../packages/db/migrations/", import.meta.url));
    const r = checkTables(migrationTables(dir));
    if (r.unclassified.length || r.missing.length || r.both.length) {
      if (r.unclassified.length) console.error(`::error::the migrations make table(s) the backup has not classified (add each to FAN_TABLES or NOT_BACKED_UP in .github/scripts/fan-backup.mjs): ${r.unclassified.join(", ")}`);
      if (r.missing.length) console.error(`::error::the backup expects table(s) no migration makes: ${r.missing.join(", ")}`);
      if (r.both.length) console.error(`::error::table(s) both backed up and not: ${r.both.join(", ")}`);
      process.exit(1);
    }
    const seqs = migrationSequences(dir);
    console.log(cmd === "tables" ? dumpTables(FAN_TABLES, FAN_TABLES.flatMap((t) => seqs[t] ?? [])).join("\n") : countsSql());
  } else if (cmd === "commit") {
    const [privateDir, file] = rest.filter((a) => !a.startsWith("--"));
    if (!privateDir || !file) throw new Error("usage: fan-backup.mjs commit <private-dir> <file> [--write]");
    commitBackup({ privateDir, file, write: rest.includes("--write") });
  } else {
    throw new Error("usage: fan-backup.mjs tables | counts-sql | commit <private-dir> <file> [--write]");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
