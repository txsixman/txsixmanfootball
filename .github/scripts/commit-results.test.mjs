// Results watch's commit (commit-results.sh) against local bare repos standing in for both remotes. `node` (publish,
// data checks) and `uv` (rerate) are stubs first on PATH: publish copies the private games.csv into data/seed, the
// rerate writes a ratings file from it, and the data checks pass or write an integrity report as a test says.
//   node --test .github/scripts/*.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const SCRIPT = path.join(import.meta.dirname, "commit-results.sh");
const YEAR = "2026";
const DIR = `maxpreps-${YEAR}`;
const HEADER = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period";

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const write = (file, text) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const exe = (file, text) => {
  write(file, text);
  chmodSync(file, 0o755);
};

/** Two bare remotes with one commit each (the same games in both), this repo cloned to work/ and the private one to work/private. */
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "commit-results-"));
  const log = path.join(root, "pushes.log");
  const games = `${HEADER}\nI,season,2026-09-04,Jayton,Guthrie,false,52,6,unknown,\n`;
  for (const [name, files] of [
    ["private", { [`${DIR}/games.csv`]: games, [`${DIR}/coverage.txt`]: "12 of 12 schedules read\nline 2\nline 3\nline 4\n" }],
    ["public", { [`data/seed/${DIR}/games.csv`]: games, [`data/ratings/${YEAR}.json`]: "2\n" }],
  ]) {
    const bare = path.join(root, `${name}.git`);
    git(root, "init", "-q", "--bare", bare);
    exe(path.join(bare, "hooks/post-receive"), `#!/bin/sh\necho ${name} >> "${log}"\n`);
    const seed = path.join(root, `seed-${name}`);
    git(root, "init", "-q", seed);
    for (const [f, t] of Object.entries(files)) write(path.join(seed, f), t);
    git(seed, "add", ".");
    git(seed, "commit", "-q", "-m", "start");
    git(seed, "push", "-q", bare, "HEAD:main");
  }
  writeFileSync(log, "");
  const work = path.join(root, "work");
  git(root, "clone", "-q", path.join(root, "public.git"), work);
  git(work, "clone", "-q", path.join(root, "private.git"), "private");
  mkdirSync(path.join(work, "apps/web/node_modules"), { recursive: true }); // so the script installs nothing
  write(path.join(work, ".gitignore"), "private/\napps/web/node_modules/\n");
  git(work, "add", ".gitignore");
  git(work, "commit", "-q", "-m", "ignore");
  git(work, "push", "-q", "origin", "HEAD:main");
  writeFileSync(log, "");

  const bin = path.join(root, "bin");
  exe(path.join(bin, "node"), `#!/usr/bin/env bash
case "$1" in
  tools/league-watch/publish.mjs) mkdir -p "$3" && cp "$2/games.csv" "$3/games.csv" ;;
  tools/league-watch/davecampbells.mjs) [ "$2" = --merge-details ] && [ "$4" = --out ] && cp "$3" "$5" ;;
  apps/web/scripts/check-data.mjs)
    if [ -n "\${STUB_INTEGRITY:-}" ]; then echo "$STUB_INTEGRITY" >> "$INTEGRITY_REPORT"; fi
    exit "\${STUB_CHECK_EXIT:-0}" ;;
  *) echo "unexpected node $*" >&2; exit 99 ;;
esac
`);
  // The rerate; with STUB_MOVES=n it also lands someone else's commit on main n times, just before the push.
  const other = path.join(root, "other");
  git(root, "clone", "-q", path.join(root, "public.git"), other);
  exe(path.join(bin, "uv"), `#!/usr/bin/env bash
year="\${*: -1}"
mkdir -p data/ratings && wc -l < "data/seed/maxpreps-$year/games.csv" | tr -d ' ' > "data/ratings/$year.json"
moves="${root}/moves"
if [ -s "$moves" ] && [ "$(cat "$moves")" -gt 0 ]; then
  echo $(( $(cat "$moves") - 1 )) > "$moves"
  git -C "${other}" pull -q origin main
  date +%s%N >> "${other}/other.txt"
  git -C "${other}" add other.txt
  git -C "${other}" -c user.name=o -c user.email=o@example.invalid commit -q -m "someone else"
  git -C "${other}" push -q origin HEAD:main
fi
`);
  return { root, work, bin, log, other };
}

function run(t, env = {}) {
  const temp = path.join(t.root, "runner");
  mkdirSync(temp, { recursive: true });
  const files = { GITHUB_STEP_SUMMARY: path.join(temp, "summary.md"), GITHUB_OUTPUT: path.join(temp, "output"), INTEGRITY_REPORT: path.join(temp, "integrity.txt") };
  for (const f of Object.values(files)) writeFileSync(f, "");
  const r = spawnSync("bash", [SCRIPT, YEAR], {
    cwd: t.work,
    encoding: "utf8",
    env: { ...process.env, PATH: `${t.bin}:${process.env.PATH}`, RUNNER_TEMP: temp, WRITE: "true", INTEGRITY: "report", ...files, ...env },
  });
  const read = (f) => readFileSync(f, "utf8");
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, summary: read(files.GITHUB_STEP_SUMMARY), output: read(files.GITHUB_OUTPUT), integrity: read(files.INTEGRITY_REPORT) };
}
const remoteLog = (t, name) => git(t.root, "--git-dir", path.join(t.root, `${name}.git`), "log", "--format=%s", "main").split("\n");
const remoteFile = (t, name, file) => git(t.root, "--git-dir", path.join(t.root, `${name}.git`), "show", `main:${file}`);
/** The reader found a new final: its capture in the private checkout, as the read step leaves it. */
const newCapture = (t) => writeFileSync(path.join(t.work, "private", DIR, "games.csv"), `${HEADER}\nI,season,2026-09-04,Jayton,Guthrie,false,52,6,unknown,\nI,season,2026-09-11,Kress,Spur,false,30,40,unknown,\n`);

test("nothing new: no commit anywhere, and the summary says so", () => {
  const t = setup();
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.summary, /Private repo: no new captures\.\nNo new results\./);
  assert.equal(r.output, "");
  assert.equal(readFileSync(t.log, "utf8"), "");
  assert.deepEqual(remoteLog(t, "public"), ["ignore", "start"]);
});

test("new captures: the private repo is pushed first, then the published and rerated facts, and the sha is the output", () => {
  const t = setup();
  newCapture(t);
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(t.log, "utf8"), "private\npublic\n");
  assert.match(remoteLog(t, "private")[0], /^Results and ratings from MaxPreps, \d{4}-\d{2}-\d{2}$/);
  assert.match(remoteFile(t, "public", `data/seed/${DIR}/games.csv`), /Kress,Spur/);
  assert.equal(remoteFile(t, "public", `data/ratings/${YEAR}.json`), "3");
  assert.equal(r.output, `sha=${git(t.root, "--git-dir", path.join(t.root, "public.git"), "rev-parse", "main")}\n`);
  assert.match(r.summary, /12 of 12 schedules read\nline 2\nline 3\n$/);
  assert.equal(r.integrity, "");
});

test("main moved under the push: it tries again and lands on the newest main, keeping the other commit", () => {
  const t = setup();
  newCapture(t);
  writeFileSync(path.join(t.root, "moves"), "2");
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /main moved; try 1 again\nmain moved; try 2 again/);
  const log = remoteLog(t, "public");
  assert.match(log[0], /^Results and ratings from MaxPreps/);
  assert.deepEqual(log.slice(1, 3), ["someone else", "someone else"]);
  assert.match(remoteFile(t, "public", `data/seed/${DIR}/games.csv`), /Kress,Spur/);
});

test("the public push fails three times: exit 1, nothing on public main, the private commit kept", () => {
  const t = setup();
  newCapture(t);
  exe(path.join(t.root, "public.git/hooks/pre-receive"), "#!/bin/sh\necho refused >&2\nexit 1\n");
  const r = run(t);
  assert.equal(r.status, 1);
  assert.equal((r.stdout.match(/main moved; try \d again/g) ?? []).length, 3);
  assert.deepEqual(remoteLog(t, "public"), ["ignore", "start"]);
  assert.match(remoteLog(t, "private")[0], /^Results and ratings from MaxPreps/);
  assert.equal(r.output, "");
});

test("the private token reaches only fetch and push on private/, by environment, and is never stored or printed", () => {
  const t = setup();
  newCapture(t);
  const seen = path.join(t.root, "git-config-seen.log");
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  exe(path.join(t.bin, "git"), `#!/usr/bin/env bash
if env | grep -q '^GIT_CONFIG_KEY_[0-9]*=http.https://github.com/.extraheader$'; then h=header; else h=plain; fi
echo "$* :: $h" >> "${seen}"
exec "${realGit}" "$@"
`);
  const token = "tok-for-test-only-123";
  // As on a runner (GITHUB_ACTIONS=true), so anything the script prints only there is checked here too.
  const r = run(t, { DATA_PRIVATE_TOKEN: token, GITHUB_ACTIONS: "true" });
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(seen, "utf8").split("\n");
  const withHeader = lines.filter((l) => l.endsWith(":: header")).map((l) => l.split(" ").slice(0, 3).join(" "));
  assert.deepEqual(withHeader, ["-C private fetch", "-C private push"]);
  const everything = r.stdout + r.stderr + readFileSync(path.join(t.work, "private/.git/config"), "utf8");
  assert.ok(!everything.includes(token) && !everything.includes(Buffer.from(`x-access-token:${token}`).toString("base64")));
});

test("WRITE not true: nothing is pushed anywhere, and the summary lists what would have been", () => {
  const t = setup();
  newCapture(t);
  const r = run(t, { WRITE: "false" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(t.log, "utf8"), "");
  assert.match(r.summary, /Private repo: new captures, not pushed.*\nNew results, not pushed.*\n.*data\/seed\/maxpreps-2026\/games\.csv/s);
  assert.equal(r.output, "");
});

test("an integrity report is written and the push still goes ahead", () => {
  const t = setup();
  newCapture(t);
  const r = run(t, { STUB_INTEGRITY: "kress has 2 games on 2026-09-11" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.integrity, "kress has 2 games on 2026-09-11\n");
  assert.equal(readFileSync(t.log, "utf8"), "private\npublic\n");
  assert.match(r.output, /^sha=[0-9a-f]{40}\n$/);
});

test("a failed Zod check blocks the public push (the private captures are already kept)", () => {
  const t = setup();
  newCapture(t);
  const r = run(t, { STUB_CHECK_EXIT: "1" });
  assert.equal(r.status, 1);
  assert.equal(readFileSync(t.log, "utf8"), "private\n");
  assert.deepEqual(remoteLog(t, "public"), ["ignore", "start"]);
});

test("the finals cross-check's report goes in the private commit, alone or with new captures, and never to this repo", () => {
  const report = (t, line) => write(path.join(t.work, "private", `davecampbells-${YEAR}`, "finals-check.csv"), `game_date,home,away,verdict\n${line}\n`);
  // A report with no new captures: a private commit only; nothing public.
  const t = setup();
  report(t, "2026-11-12,lark,wren,agree");
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(t.log, "utf8"), "private\n");
  assert.match(remoteFile(t, "private", `davecampbells-${YEAR}/finals-check.csv`), /lark,wren,agree/);
  assert.match(r.summary, /No new results\./);
  assert.deepEqual(remoteLog(t, "public"), ["ignore", "start"]);
  // The same report again: nothing to commit.
  const again = run(t);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.summary, /Private repo: no new captures\./);
  // A changed report with new captures: one private commit with both, then the public facts without the report.
  report(t, "2026-11-12,lark,wren,disagree");
  newCapture(t);
  writeFileSync(t.log, "");
  const both = run(t);
  assert.equal(both.status, 0, both.stderr);
  assert.equal(readFileSync(t.log, "utf8"), "private\npublic\n");
  assert.match(remoteFile(t, "private", `davecampbells-${YEAR}/finals-check.csv`), /disagree/);
  assert.match(remoteFile(t, "private", `${DIR}/games.csv`), /Kress,Spur/);
  assert.equal(git(t.root, "--git-dir", path.join(t.root, "public.git"), "ls-tree", "-r", "--name-only", "main").includes("davecampbells"), false);
});

test("the finals report goes by name: a file someone else keeps in davecampbells-<season>/ is never put back to an older copy", () => {
  const t = setup();
  const kept = `davecampbells-${YEAR}/history-summary.txt`;
  write(path.join(t.work, "private", `davecampbells-${YEAR}`, "finals-check.csv"), "game_date,home,away,verdict\n2026-11-12,lark,wren,agree\n");
  // Another clone lands a file in the same folder after this run's read started.
  const elsewhere = path.join(t.root, "elsewhere");
  git(t.root, "clone", "-q", path.join(t.root, "private.git"), elsewhere);
  write(path.join(elsewhere, kept), "counts only\n");
  git(elsewhere, "add", ".");
  git(elsewhere, "commit", "-q", "-m", "someone else's file");
  git(elsewhere, "push", "-q", "origin", "HEAD:main");
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(remoteFile(t, "private", kept), "counts only");
  assert.match(remoteFile(t, "private", `davecampbells-${YEAR}/finals-check.csv`), /lark,wren,agree/);
  assert.deepEqual(remoteLog(t, "private").slice(0, 2), [remoteLog(t, "private")[0], "someone else's file"]);
});

test("only games.csv and playoffs.csv are staged: a stray capture in the public folder is never pushed", () => {
  const t = setup();
  newCapture(t);
  // A capture written outside the private repo (PRIVATE_DATA lost): untracked, in the folder the commit stages from.
  write(path.join(t.work, "data/seed", DIR, "teams.csv"), "slug,source\nlark,https://example.invalid/lark\n");
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(t.log, "utf8"), "private\npublic\n");
  const pushed = git(t.root, "--git-dir", path.join(t.root, "public.git"), "ls-tree", "-r", "--name-only", "main", `data/seed/${DIR}`);
  assert.deepEqual(pushed.split("\n"), [`data/seed/${DIR}/games.csv`]);
});

test("game details read earlier in the run are merged into the newest main's file and committed with the results", () => {
  const t = setup();
  const details = path.join(t.root, "details.csv");
  writeFileSync(details, "date,home,away,kickoff_utc,site_name,site_city\n2026-11-13,Kress,Spur,2026-11-14T01:00:00Z,Bird Field,Lark\n");
  const r = run(t, { DETAILS: details });
  assert.equal(r.status, 0, r.stderr);
  assert.match(remoteFile(t, "public", `data/seed/game-details/${YEAR}.csv`), /Kress,Spur,2026-11-14T01:00:00Z,Bird Field,Lark/);
  assert.equal(readFileSync(t.log, "utf8"), "public\n", "nothing new for the private repo");
});

test("no game details read: no details file is written", () => {
  const t = setup();
  newCapture(t);
  const r = run(t, { DETAILS: path.join(t.root, "absent.csv") });
  assert.equal(r.status, 0, r.stderr);
  assert.throws(() => remoteFile(t, "public", `data/seed/game-details/${YEAR}.csv`));
});
