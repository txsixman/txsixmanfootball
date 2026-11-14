// The pull-request commit address check (commit-emails.sh): which author and committer addresses pass, and that an
// empty range fails rather than passing on nothing.   node --test .github/scripts/*.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const script = join(import.meta.dirname, "commit-emails.sh");
const repo = mkdtempSync(join(tmpdir(), "commit-emails-"));
after(() => rmSync(repo, { recursive: true, force: true }));

const git = (args, env = {}) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", ...env } }).trim();
const commit = (author, committer = author) =>
  git(["commit", "-q", "--allow-empty", "-m", "c"], {
    GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_NAME: "c", GIT_COMMITTER_EMAIL: committer,
  });
const check = (range) => spawnSync("bash", [script, range], { cwd: repo, encoding: "utf8" });

git(["init", "-q", "-b", "main"]);
const OWN = "contact@txsixmanfootball.com";
const BOT = "41898282+github-actions[bot]@users.noreply.github.com";
commit(OWN);
const base = git(["rev-parse", "HEAD"]);

test("the project's address and the bots pass", () => {
  commit(OWN);
  commit(BOT);
  commit("49699333+dependabot[bot]@users.noreply.github.com", "noreply@github.com");
  const r = check(`${base}..HEAD`);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /3 commit\(s\) checked: every address is allowed/);
});

test("a personal address as author or as committer fails, naming the commit", () => {
  const top = git(["rev-parse", "HEAD"]);
  commit(OWN, "someone@example.com");
  const r1 = check(`${top}..HEAD`);
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /the committer address is not allowed/);
  const mid = git(["rev-parse", "HEAD"]);
  commit("someone@example.com", OWN);
  const r2 = check(`${mid}..HEAD`);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /the author address is not allowed/);
  assert.doesNotMatch(r1.stdout + r2.stdout, /someone@example\.com/, "the address is never printed (CI logs are public)");
  assert.equal(check(`${base}..HEAD`).status, 1, "one bad commit fails the whole range");
});

test("a look-alike of the project's address fails", () => {
  const top = git(["rev-parse", "HEAD"]);
  commit("contact@txsixmanfootball.com.evil.example");
  assert.equal(check(`${top}..HEAD`).status, 1);
});

test("an empty range fails rather than passing on nothing", () => {
  const r = check("HEAD..HEAD");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /checked nothing/);
});
