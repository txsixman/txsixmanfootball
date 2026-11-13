import assert from "node:assert/strict";
import { test } from "node:test";
import { alert, bodyOf, failures, github, keyOf, LABEL, QUIET_HOURS, recentlyPosted, REASONS, TITLE } from "./ops-alert.mjs";

const JOBS = [
  { name: "due", conclusion: "success", steps: [{ name: "Bracket games of tonight without a score", conclusion: "success" }] },
  { name: "maxpreps", conclusion: "failure", steps: [{ name: "Read MaxPreps schedule pages", conclusion: "success" }, { name: "Commit, the private repo first, then this one", conclusion: "failure" }, { name: "Post Run", conclusion: "skipped" }] },
  { name: "clock", conclusion: "cancelled", steps: [{ name: "Game-day clock", conclusion: "cancelled" }] },
  { name: "alerts", conclusion: "skipped", steps: [] },
  { name: "notify", conclusion: null, steps: [] },
];

test("a run's failures are its failed or cancelled jobs and the steps that failed in them", () => {
  assert.deepEqual(failures(JOBS), [
    { job: "maxpreps", conclusion: "failure", steps: ["Commit, the private repo first, then this one"] },
    { job: "clock", conclusion: "cancelled", steps: ["Game-day clock"] },
  ]);
  assert.deepEqual(failures([{ name: "x", conclusion: "success", steps: [] }]), []);
});

test("the body names the workflow, jobs, steps and run link only, and carries its key", () => {
  const failed = failures(JOBS);
  const key = keyOf({ workflow: "Results watch", failed });
  assert.equal(key, "Results watch|maxpreps:Commit, the private repo first, then this one,clock:Game-day clock");
  const body = bodyOf({ workflow: "Results watch", runUrl: "https://github.com/o/r/actions/runs/1", failed, key });
  assert.match(body, /^\*\*Results watch\*\* needs a look: https:\/\/github\.com\/o\/r\/actions\/runs\/1/);
  assert.match(body, /Job `maxpreps` failed, at `Commit, the private repo first, then this one`\./);
  assert.match(body, /Job `clock` was cancelled \(a timeout counts\), at `Game-day clock`\./);
  assert.match(body, /<!-- ops-alert key=Results%20watch%7Cmaxpreps/);
  // Anything odd in a name is dropped, so nothing but plain words reaches the public issue.
  const odd = bodyOf({ workflow: "W<script>", runUrl: "u", failed: [{ job: "j`@x", conclusion: "failure", steps: ["s<b>"] }], key: "k" });
  assert.ok(!/<script>|<b>|@x|j`/.test(odd.split("<!--")[0]), odd);
});

const NOW = Date.parse("2026-11-14T03:00:00Z");
const bot = { login: "github-actions[bot]" };
const post = (key, hoursAgo, user = bot) => ({ user, created_at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), body: `x\n<!-- ops-alert key=${encodeURIComponent(key)} -->` });

test(`the same problem is posted at most once every ${QUIET_HOURS} hours, and only the bot's posts count`, () => {
  const issue = { ...post("A", 10), number: 7 };
  assert.equal(recentlyPosted({ issue, comments: [post("A", 1)] }, "A", NOW), true);
  assert.equal(recentlyPosted({ issue, comments: [post("A", QUIET_HOURS + 0.1)] }, "A", NOW), false);
  assert.equal(recentlyPosted({ issue, comments: [post("B", 1)] }, "A", NOW), false);
  assert.equal(recentlyPosted({ issue, comments: [post("A", 1, { login: "someone" })] }, "A", NOW), false);
  assert.equal(recentlyPosted({ issue: { ...post("A", 1), number: 7 }, comments: [] }, "A", NOW), true);
});

/** A fake API: an optional open issue with comments; every write recorded. */
function fakeApi({ issue = null, comments = [], jobs = JOBS } = {}) {
  const writes = [];
  return {
    writes,
    jobs: async () => jobs,
    openIssue: async () => issue,
    comments: async () => comments,
    comment: async (n, body) => writes.push({ comment: n, body }),
    open: async (body) => (writes.push({ open: body }), { number: 9 }),
    ensureLabel: async () => writes.push({ label: true }),
  };
}
const run = (api, more = {}) => alert({ api, workflow: "Results watch", runUrl: "https://github.com/o/r/actions/runs/1", runId: "1", now: NOW, log: () => {}, ...more });

test("no open issue: one is opened, labelled; an open one gets a comment; a repeat within the quiet hours gets nothing", async () => {
  const a = fakeApi();
  assert.equal(await run(a), "opened");
  assert.deepEqual(a.writes.map((w) => Object.keys(w)[0]), ["label", "open"]);

  const b = fakeApi({ issue: { ...post("other", 20), number: 7 } });
  assert.equal(await run(b), "commented");
  assert.equal(b.writes[0].comment, 7);

  const key = keyOf({ workflow: "Results watch", failed: failures(JOBS) });
  const c = fakeApi({ issue: { ...post("other", 20), number: 7 }, comments: [post(key, 0.5)] });
  assert.equal(await run(c), "quiet");
  assert.deepEqual(c.writes, []);
});

test("a run with no failed job posts nothing; an unknown reason is refused", async () => {
  const a = fakeApi({ jobs: [{ name: "due", conclusion: "success", steps: [] }] });
  assert.equal(await run(a), "nothing");
  assert.deepEqual(a.writes, []);
  await assert.rejects(run(fakeApi(), { reason: "made-up" }), /unknown reason/);
  assert.ok(REASONS && typeof REASONS === "object");
});

test("the API client finds the bot's open alert issue by title, labels new ones, times out, and treats a 422 label as there", async () => {
  const seen = [];
  const answers = {
    "GET /issues": [{ number: 3, title: "Something else" }, { number: 4, title: TITLE, pull_request: {} }, { number: 5, title: TITLE }],
    "POST /labels": { status: 422 },
    "POST /issues": { number: 6 },
  };
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname.replace("/repos/o/r", "");
    seen.push({ method: init.method, path, url, init });
    const a = answers[`${init.method} ${path}`];
    if (a?.status) return { ok: false, status: a.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => a ?? [] };
  };
  const api = github({ token: "t", repo: "o/r", fetchImpl });
  assert.equal((await api.openIssue()).number, 5);
  assert.match(seen[0].url, /state=open&creator=github-actions%5Bbot%5D/);
  await api.ensureLabel();
  assert.equal((await api.open("b")).number, 6);
  assert.deepEqual(JSON.parse(seen.at(-1).init.body), { title: TITLE, body: "b", labels: [LABEL] });
  assert.ok(seen.every((s) => s.init.signal instanceof AbortSignal && s.init.headers.authorization === "Bearer t"));
});

test("a named problem posts its fixed text, at most once every REASON_QUIET_HOURS, and nothing else", async () => {
  const { REASON_QUIET_HOURS } = await import("./ops-alert.mjs");
  for (const [k, text] of Object.entries(REASONS)) {
    assert.match(k, /^[a-z-]+$/);
    // Fixed words: no score, no school, no address of a source.
    assert.ok(!/\d+-\d+|https?:|\.com/.test(text), text);
  }
  const a = fakeApi();
  assert.equal(await run(a, { reason: "second-source-refused" }), "opened");
  assert.match(a.writes[1].open, /refused a read/);
  assert.doesNotMatch(a.writes[1].open, /Job `/);
  const key = keyOf({ workflow: "Results watch", reason: "second-source-refused" });
  const recent = fakeApi({ issue: { ...post("other", 20), number: 7 }, comments: [post(key, REASON_QUIET_HOURS - 1)] });
  assert.equal(await run(recent, { reason: "second-source-refused" }), "quiet");
  const old = fakeApi({ issue: { ...post("other", 20), number: 7 }, comments: [post(key, REASON_QUIET_HOURS + 1)] });
  assert.equal(await run(old, { reason: "second-source-refused" }), "commented");
});
