// Robot alerts (ADR 0027): a failed robot run comments on one open issue labelled `ops-alert`, or opens it, so GitHub
// emails the owner (who watches the repo). A run that the game-day clock started is the github-actions bot's, and GitHub
// emails no one about a bot's run, so without this a failure would go unseen. The issue is public: it says only which
// workflow, job and step failed (or a fixed reason the caller names) and links the run; never a score, a school or a
// detail of a source.
//
//   node .github/scripts/ops-alert.mjs                    a run that failed: names its failed jobs and steps (notify jobs)
//   node .github/scripts/ops-alert.mjs --reason <key>     a named problem (REASONS below), from a step that did not fail,
//                                                         posted at most once every REASON_QUIET_HOURS
//
// The same problem (workflow, job and step, or reason) is commented at most once every QUIET_HOURS, so a failure that
// repeats every 10 minutes all night sends one email, not sixty. Env: GITHUB_TOKEN (issues: write, actions: read),
// GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_WORKFLOW, GITHUB_SERVER_URL, GITHUB_STEP_SUMMARY (optional).

import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LABEL = "ops-alert";
export const TITLE = "Robot alert: a scheduled job needs a look";
export const QUIET_HOURS = 3;
const BOT = "github-actions[bot]";
/** The fixed texts a step may raise without failing (ADR 0028). Only these words reach the public issue. */
export const REASONS = {
  "read-stuck": "A Results watch read has waited or run far longer than any read takes; the game-day clock started a new one. Look at the older run.",
  "second-source-refused": "The second score source refused a read (HTTP 403 or 429), so its reads stopped for this run. If it keeps happening, switch SECOND_LIVE and SECOND_FINALS off.",
  "second-source-no-agreement": "The finals cross-check found no agreeing final among 10 or more games of past game nights: its matching or the source's answers may have changed. See the private report.",
  "second-source-no-season": "The second score source has no season id for the season under way, so its reads do nothing until one is added.",
  "missing-finals": "A bracket game of a past game night still has no score after the morning read and the late-final fill. The run summary names it.",
};
/** A named problem is a condition, not one run's failure: it is posted at most once every REASON_QUIET_HOURS. */
export const REASON_QUIET_HOURS = 12;

/** The failed (or cancelled, as a timeout is) jobs of a run and, in each, the steps that failed. Our own names only. */
export function failures(jobs) {
  return jobs
    .filter((j) => j.conclusion === "failure" || j.conclusion === "cancelled" || j.conclusion === "timed_out")
    .map((j) => ({
      job: j.name,
      conclusion: j.conclusion,
      steps: (j.steps ?? []).filter((s) => s.conclusion === "failure" || s.conclusion === "cancelled").map((s) => s.name),
    }));
}

/** What makes two alerts the same problem: the workflow and each failed job and step, or the reason. */
export const keyOf = ({ workflow, failed, reason }) =>
  reason ? `${workflow}|reason:${reason}` : `${workflow}|${failed.map((f) => `${f.job}:${f.steps.join("+")}`).join(",")}`;

/** Names stay plain on a public page: letters, digits, spaces and a few marks, at most 120 characters. */
const plain = (s) => String(s ?? "").replace(/[^A-Za-z0-9 ,.:()/'_-]/g, "").slice(0, 120);

/** The comment (or the new issue's body). The key rides in an HTML comment, so the next alert can find it. */
export function bodyOf({ workflow, runUrl, failed, reason, key }) {
  const lines = [`**${plain(workflow)}** needs a look: ${runUrl}`, ""];
  if (reason) lines.push(`- ${REASONS[reason]}`);
  for (const f of failed ?? []) lines.push(`- Job \`${plain(f.job)}\` ${f.conclusion === "failure" ? "failed" : "was cancelled (a timeout counts)"}${f.steps.length ? `, at ${f.steps.map((s) => `\`${plain(s)}\``).join(", ")}` : ""}.`);
  lines.push("", `This issue collects robot alerts (ADRs 0027 and 0028); the same problem is posted at most once every ${reason ? REASON_QUIET_HOURS : QUIET_HOURS} hours. Close it once things are fixed; the next alert opens a new one.`);
  lines.push(`<!-- ops-alert key=${encodeURIComponent(key)} -->`);
  return lines.join("\n");
}

const keyIn = (text) => {
  const m = /<!-- ops-alert key=(\S+) -->/.exec(String(text ?? ""));
  return m ? decodeURIComponent(m[1]) : null;
};

/** Was the same problem posted on this issue (its body or a comment by the bot) within QUIET_HOURS? */
export function recentlyPosted({ issue, comments }, key, now, hours = QUIET_HOURS) {
  const posts = [{ body: issue.body, created_at: issue.created_at, user: issue.user }, ...comments];
  return posts.some((p) => p.user?.login === BOT && keyIn(p.body) === key && now - Date.parse(p.created_at) < hours * 3_600_000);
}

/** GitHub's REST API with the workflow's token; every call times out after 30 seconds. */
export function github({ token, repo, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${repo}`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  return {
    jobs: async (runId) => (await call("GET", `/actions/runs/${runId}/jobs?per_page=100`)).jobs ?? [],
    // The open alert issue: the bot's, with our title (the label alone may be missing if it could not be made).
    openIssue: async () => (await call("GET", `/issues?state=open&creator=${encodeURIComponent(BOT)}&per_page=100`)).find((i) => i.title === TITLE && !i.pull_request) ?? null,
    comments: (n) => call("GET", `/issues/${n}/comments?per_page=100`),
    comment: (n, body) => call("POST", `/issues/${n}/comments`, { body }),
    open: (body) => call("POST", "/issues", { title: TITLE, body, labels: [LABEL] }),
    ensureLabel: async () => {
      try {
        await call("POST", "/labels", { name: LABEL, color: "b60205", description: "A robot run failed (ADR 0027)" });
      } catch (e) {
        if (!/HTTP 422/.test(e.message)) throw e; // 422: it exists already
      }
    },
  };
}

/** One alert: comment on the open issue, or open one, unless the same problem was posted in the last QUIET_HOURS. */
export async function alert({ api, workflow, runUrl, runId, reason, now = Date.now(), log = console.log }) {
  if (reason && !REASONS[reason]) throw new Error(`unknown reason: ${reason}`);
  const failed = reason ? [] : failures(await api.jobs(runId));
  if (!reason && !failed.length) {
    log("Robot alert: no failed job found in this run, nothing posted.");
    return "nothing";
  }
  const key = keyOf({ workflow, failed, reason });
  const body = bodyOf({ workflow, runUrl, failed, reason, key });
  const issue = await api.openIssue();
  if (issue) {
    const hours = reason ? REASON_QUIET_HOURS : QUIET_HOURS;
    if (recentlyPosted({ issue, comments: await api.comments(issue.number) }, key, now, hours)) {
      log(`Robot alert: the same problem was posted on issue #${issue.number} within ${hours} hours, not again.`);
      return "quiet";
    }
    await api.comment(issue.number, body);
    log(`Robot alert: commented on issue #${issue.number}.`);
    return "commented";
  }
  await api.ensureLabel();
  const made = await api.open(body);
  log(`Robot alert: opened issue #${made.number}.`);
  return "opened";
}

async function main() {
  const at = process.argv.indexOf("--reason");
  const reason = at < 0 ? null : process.argv[at + 1];
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId, GITHUB_WORKFLOW: workflow, GITHUB_SERVER_URL: server = "https://github.com", GITHUB_STEP_SUMMARY: summary } = process.env;
  if (!token || !repo || !runId || !workflow) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_WORKFLOW must be set");
  const log = (line) => {
    console.log(line);
    if (summary) appendFileSync(summary, `${line}\n`);
  };
  await alert({ api: github({ token, repo }), workflow, runUrl: `${server}/${repo}/actions/runs/${runId}`, runId, reason, log });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
