// The fan backup's table list and its commit (fan-backup.mjs), the commit against a local bare repo standing in for data-private.
//   node --test .github/scripts/*.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { authEnv, AUTH_TABLES, checkTables, commitBackup, countsSql, dumpTables, FAN_TABLES, migrationSequences, migrationTables, NOT_BACKED_UP, pruneList } from "./fan-backup.mjs";

const MIGRATIONS = fileURLToPath(new URL("../../packages/db/migrations/", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./fan-backup.mjs", import.meta.url));

function tmp(sql = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "fan-backup-"));
  for (const [f, text] of Object.entries(sql)) writeFileSync(path.join(dir, f), text);
  return dir;
}

test("every table the real migrations make is classified, and every classified table exists", () => {
  const r = checkTables(migrationTables(MIGRATIONS));
  assert.deepEqual(r, { unclassified: [], missing: [], both: [] });
  assert.ok(FAN_TABLES.includes("profile") && FAN_TABLES.includes("post") && FAN_TABLES.includes("push_subscription"));
});

test("migrationTables reads create and drop, skips comments, strings in a line's middle and other schemas", () => {
  const dir = tmp({
    "0001.sql": "-- create table in_a_comment (x int);\n/* create table in_a_block (x int); */\ncreate table a (id int);\ncreate table if not exists public.b (id int);\ncreate table auth.c (id int);\nselect 'create table inline (x int)';\ncreate temp table t (id int);",
    "0002.sql": "drop table a;\ncreate table \"d\" (id int);",
  });
  assert.deepEqual([...migrationTables(dir)].sort(), ["b", "d"]);
});

test("a new table nobody classified, a classified table that is gone, and a table in both lists all fail loudly", () => {
  assert.deepEqual(checkTables(new Set(["profile", "brand_new"]), ["profile"], []), { unclassified: ["brand_new"], missing: [], both: [] });
  assert.deepEqual(checkTables(new Set(["profile"]), ["profile", "gone"], []).missing, ["gone"]);
  assert.deepEqual(checkTables(new Set(["profile"]), ["profile"], ["profile"]).both, ["profile"]);
  const bad = spawnSync("node", ["--input-type=module", "-e", `import { checkTables } from ${JSON.stringify(SCRIPT)}; process.exit(checkTables(new Set(["x"]), [], []).unclassified.length ? 1 : 0)`]);
  assert.equal(bad.status, 1);
});

test("the CLI lists the tables when everything lines up", () => {
  const r = spawnSync("node", [SCRIPT, "tables"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.deepEqual(lines.slice(0, 2), AUTH_TABLES);
  assert.equal(lines.length, AUTH_TABLES.length + FAN_TABLES.length + 2);
  assert.ok(lines.includes("public.profile"));
  assert.ok(lines.includes("public.audit_log_id_seq") && lines.includes("public.post_edit_id_seq"), "a restore must set the serial counters");
});

test("serial columns give their sequences, read from the migrations", () => {
  const dir = tmp({ "0001.sql": "create table a (\n  id bigserial primary key,\n  n serial,\n  x int\n);\ncreate table b (id uuid primary key);" });
  assert.deepEqual(migrationSequences(dir), { a: ["a_id_seq", "a_n_seq"] });
  const real = migrationSequences(MIGRATIONS);
  assert.deepEqual(real.audit_log, ["audit_log_id_seq"]);
  assert.deepEqual(real.post_edit, ["post_edit_id_seq"]);
});

test("no table is both fan-owned and left out, and the counts statement names each dumped table once", () => {
  assert.equal(FAN_TABLES.filter((t) => t in NOT_BACKED_UP).length, 0);
  const sql = countsSql();
  for (const t of dumpTables()) assert.equal(sql.split(`'${t}'`).length - 1, 1, t);
  assert.throws(() => countsSql(["public.x; drop table y"]));
});

test("pruning keeps the newest 8 backups and never touches another file", () => {
  const days = Array.from({ length: 11 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}.sql.age`);
  const shuffled = [...days.slice(5), "README.md", "2026-11-03.sql", "notes.sql.age", ...days.slice(0, 5)];
  assert.deepEqual(pruneList(shuffled), days.slice(0, 3));
  assert.deepEqual(pruneList(days.slice(0, 8)), []);
  assert.deepEqual(pruneList([]), []);
  assert.deepEqual(pruneList(days, 2), days.slice(0, 9));
});

test("the token reaches git as a header in the next free config slot, and not at all without one", () => {
  assert.deepEqual(authEnv("", {}), {});
  const env = authEnv("tok", { GIT_CONFIG_COUNT: "2" });
  assert.equal(env.GIT_CONFIG_COUNT, "3");
  assert.equal(env.GIT_CONFIG_KEY_2, "http.https://github.com/.extraheader");
  assert.equal(env.GIT_CONFIG_VALUE_2, `AUTHORIZATION: basic ${Buffer.from("x-access-token:tok").toString("base64")}`);
});

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A bare "data-private" with one commit holding existing backups, and a clone of it. */
function setup(existing = []) {
  const root = mkdtempSync(path.join(tmpdir(), "fan-backup-git-"));
  const bare = path.join(root, "private.git");
  const seed = path.join(root, "seed");
  mkdirSync(seed);
  git(root, "init", "-q", "--bare", bare);
  git(seed, "init", "-q");
  mkdirSync(path.join(seed, "backups/fan"), { recursive: true });
  writeFileSync(path.join(seed, "keep.txt"), "other data\n");
  for (const f of existing) writeFileSync(path.join(seed, "backups/fan", f), "old");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "start");
  git(seed, "push", "-q", bare, "HEAD:main");
  const work = path.join(root, "work");
  git(root, "clone", "-q", bare, work);
  const dump = path.join(root, "dump.sql.age");
  writeFileSync(dump, "age-encryption.org/v1\nciphertext");
  return { root, bare, work, dump };
}

test("a write commits the new backup as the project's address, keeps the newest 8, and pushes", () => {
  const days = Array.from({ length: 8 }, (_, i) => `2026-11-0${i + 1}.sql.age`);
  const { root, bare, work, dump } = setup(days);
  const lines = [];
  const r = commitBackup({ privateDir: work, file: dump, date: "2026-11-21", write: true, token: "", log: (l) => lines.push(l) });
  assert.deepEqual(r, { name: "2026-11-21.sql.age", removed: ["2026-11-01.sql.age"], kept: 8, pushed: true });
  const check = path.join(root, "check");
  git(root, "clone", "-q", bare, check);
  assert.deepEqual(readdirSync(path.join(check, "backups/fan")).sort(), [...days.slice(1), "2026-11-21.sql.age"]);
  assert.ok(existsSync(path.join(check, "keep.txt")));
  assert.equal(git(check, "log", "-1", "--format=%an <%ae>|%cn <%ce>|%s"), "TX Six-Man Football <contact@txsixmanfootball.com>|TX Six-Man Football <contact@txsixmanfootball.com>|Fan database backup, 2026-11-21");
  assert.ok(lines.join("\n").includes("8 kept"));
});

test("a dry run changes nothing, in the checkout or the remote", () => {
  const { bare, work, dump } = setup(["2026-11-01.sql.age"]);
  const before = git(work, "rev-parse", "HEAD");
  const r = commitBackup({ privateDir: work, file: dump, date: "2026-11-21", write: false, token: "", log: () => {} });
  assert.equal(r.pushed, false);
  assert.equal(git(work, "status", "--porcelain"), "");
  assert.equal(git(work, "rev-parse", "HEAD"), before);
  assert.equal(git(bare, "rev-parse", "main"), before);
});

test("when main moved since the checkout, the backup is laid on the newest main and still lands", () => {
  const { root, bare, work, dump } = setup(["2026-11-01.sql.age"]);
  const other = path.join(root, "other");
  git(root, "clone", "-q", bare, other);
  writeFileSync(path.join(other, "later.txt"), "x");
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "later");
  git(other, "push", "-q", "origin", "HEAD:main");
  commitBackup({ privateDir: work, file: dump, date: "2026-11-21", write: true, token: "", log: () => {} });
  assert.equal(git(bare, "show", "main:later.txt"), "x");
  assert.equal(git(bare, "show", "main:backups/fan/2026-11-21.sql.age").startsWith("age-encryption.org"), true);
});

test("a second run on the same day replaces that day's file instead of adding one", () => {
  const { bare, work, dump } = setup();
  commitBackup({ privateDir: work, file: dump, date: "2026-11-21", write: true, token: "", log: () => {} });
  writeFileSync(dump, "age-encryption.org/v1\nnewer");
  const r = commitBackup({ privateDir: work, file: dump, date: "2026-11-21", write: true, token: "", log: () => {} });
  assert.equal(r.kept, 1);
  assert.equal(git(bare, "show", "main:backups/fan/2026-11-21.sql.age").endsWith("newer"), true);
});
