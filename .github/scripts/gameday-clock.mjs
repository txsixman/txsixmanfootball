// The game-day clock (ADR 0024): starts Results watch's game-day read (`tonight`) every 10 minutes of a playoff game
// night, from GitHub itself, because GitHub's `schedule` events have never fired in this repo. One run of
// gameday-clock.yml loops for up to about 5.5 hours, within the 6-hour job limit. It queues the next run first (ADR
// 0027): the next run waits under `concurrency: gameday-clock` and starts however this one ends (done, failed, timed
// out, cancelled, its runner lost), so the chain never stops quietly. Through GitHub's API with the workflow's own
// token (actions: write); every call times out after 30 seconds.
// A dispatch made with that token starts a run: workflow_dispatch is GitHub's stated exception to the rule that the
// token's events start no workflows.
//
//   node .github/scripts/gameday-clock.mjs [--minutes 330] [--dry-run] [--retry]
//
// --minutes  how long this run keeps the clock (1 to 340)
// --dry-run  decides and logs every tick, but starts nothing: no read, no next clock run
// --retry    this run was started after a failed run; if this one fails too, it cancels the queued next run, and the
//            chain stops (the failure is posted to the robot-alert issue, ADR 0027)
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name), GITHUB_RUN_ID, GITHUB_STEP_SUMMARY (optional), PLAYOFFS (default: the season's
// data/seed/maxpreps-<season>/playoffs.csv).

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { alert, github as alertApi } from "./ops-alert.mjs";

export const READ_WORKFLOW = "results-watch.yml";
export const CLOCK_WORKFLOW = "gameday-clock.yml";
export const MINUTE = 60_000;
/** A tick is every 10 minutes at :03, :13, ... :53, as the Mac's loop did, so the two never double up for long. */
export const TICK_OFFSET = 3;
/** A `schedule` read this recent means GitHub's own timer is working: the clock stands down for that tick. */
export const SCHEDULE_QUIET = 12;
/** Any other read this recent (the Mac's loop, a run by hand) already covers this tick. */
export const RECENT_QUIET = 8;
/** A read still waiting to start after this long is stuck (ADR 0028): it no longer covers a tick. */
export const STUCK_WAITING = 60;
/** A read still running after this long is stuck too. Its jobs' limits add up to about 70 minutes. */
export const STUCK_RUNNING = 90;

/** Is this active read stuck? Waiting (queued, pending, requested, waiting) over 60 minutes, or running over 90. */
export const isStuck = (r, now) => (now - Date.parse(r.created_at)) / MINUTE > (r.status === "in_progress" ? STUCK_RUNNING : STUCK_WAITING);

/** November and December, by the UTC month, as Results watch's game-day cron lines count them. */
export const seasonMonth = (now) => [10, 11].includes(new Date(now).getUTCMonth());

/** Inside a game night's read hours: 18:00 to 06:10 UTC (noon to past midnight Central), in November and December. */
export function inWindow(now) {
  if (!seasonMonth(now)) return false;
  const d = new Date(now);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 18 * 60 || minutes <= 6 * 60 + 10;
}

/** The next tick strictly after `now`: the next time whose minute ends in 3, at :00 seconds. */
export function nextTick(now) {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  const m = d.getUTCMinutes();
  d.setUTCMinutes(m - (m % 10) + TICK_OFFSET);
  while (d.getTime() <= now) d.setUTCMinutes(d.getUTCMinutes() + 10);
  return d.getTime();
}

/** The season under way: from July on it is this year's, before July last year's (as Results watch counts it). */
export const seasonOf = (now) => {
  const d = new Date(now);
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
};

/**
 * Is the season's bracket played out? Every row has a score, and every league and division in the file has a scored
 * `final`. A division still short of its final (its later rounds not yet in the file) keeps the clock going.
 */
export function seasonDone(playoffsText) {
  const [header, ...lines] = playoffsText.trimEnd().split("\n");
  const cols = header.split(",");
  const rows = lines.filter(Boolean).map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(",")[i] ?? ""])));
  if (!rows.length || !cols.includes("round") || !cols.includes("home_score")) return false;
  if (rows.some((r) => r.home_score === "")) return false;
  const brackets = new Set(rows.map((r) => `${r.league}|${r.division}`));
  const finals = new Set(rows.filter((r) => r.round === "final").map((r) => `${r.league}|${r.division}`));
  return [...brackets].every((b) => finals.has(b));
}

/**
 * One tick's decision from Results watch's newest runs (GitHub's `workflow_runs`: status, event, created_at).
 * @returns {{ dispatch: boolean, line: string }}
 */
export function decide(now, runs) {
  if (!inWindow(now)) return { dispatch: false, line: "outside the game-night hours (18:00 to 06:10 UTC, Nov and Dec): nothing to start" };
  const ago = (r) => (now - Date.parse(r.created_at)) / MINUTE;
  const actives = runs.filter((r) => r.status !== "completed");
  const active = actives.find((r) => !isStuck(r, now));
  if (active) return { dispatch: false, line: `skipped: a read is ${active.status} (run ${active.id}, ${active.event})` };
  // Every active read is stuck: start a new one (it waits behind the stuck one, or replaces it if it is the one
  // waiting) and say so, so the owner is told (ADR 0028).
  const stuck = actives[0];
  if (stuck) return { dispatch: true, stuck: true, line: `a read has been ${stuck.status} for ${Math.floor(ago(stuck))} min (run ${stuck.id}): counted as stuck; started a new read` };
  const scheduled = runs.find((r) => r.event === "schedule" && ago(r) < SCHEDULE_QUIET);
  if (scheduled) return { dispatch: false, line: `skipped: GitHub's schedule started a read ${Math.floor(ago(scheduled))} min ago (run ${scheduled.id})` };
  const recent = runs.find((r) => ago(r) < RECENT_QUIET);
  if (recent) return { dispatch: false, line: `skipped: a read was started ${Math.floor(ago(recent))} min ago (run ${recent.id}, ${recent.event})` };
  return { dispatch: true, line: "started the game-day read" };
}

/** GitHub's REST API with the workflow's token. A dispatch answers 204; anything else is a failure. */
/** A hung call must not hang the clock until its job times out: every call gives up after this long. */
export const CALL_TIMEOUT_MS = 30_000;

export function github({ token, repo, selfId, fetchImpl = fetch }) {
  const base = `https://api.github.com/repos/${repo}/actions`;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const call = (url, init = {}) => fetchImpl(url, { headers, ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  const listRuns = async (workflow) => {
    const res = await call(`${base}/workflows/${workflow}/runs?per_page=30`);
    if (!res.ok) throw new Error(`listing ${workflow} runs: HTTP ${res.status}`);
    return (await res.json()).workflow_runs ?? [];
  };
  return {
    runs: () => listRuns(READ_WORKFLOW),
    async dispatch(workflow, inputs) {
      const res = await call(`${base}/workflows/${workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs }) });
      if (res.status !== 204) throw new Error(`starting ${workflow}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    /** Cancel every clock run still waiting to start (not this one): the chain stops when this run ends. */
    async cancelQueued() {
      const waiting = (await listRuns(CLOCK_WORKFLOW)).filter((r) => r.status !== "completed" && r.status !== "in_progress" && String(r.id) !== String(selfId));
      for (const r of waiting) {
        const res = await call(`${base}/runs/${r.id}/cancel`, { method: "POST" });
        if (res.status !== 202 && res.status !== 409) throw new Error(`cancelling clock run ${r.id}: HTTP ${res.status}`);
      }
      return waiting.length;
    },
  };
}

/**
 * The clock's loop. Everything outside (time, sleep, GitHub, the log) is passed in, so the tests run it on a fake clock.
 * @returns {Promise<{ failed: boolean, handedOn: boolean, ticks: number }>}
 */
export async function runClock({ minutes, dryRun = false, retry = false, playoffsText, clock, sleep, api, log, notify = async () => {} }) {
  const start = clock();
  const deadline = start + minutes * MINUTE;
  if (!seasonMonth(start)) {
    log(`Not November or December (UTC): the clock stops here and starts no next run.`);
    return { failed: false, handedOn: false, ticks: 0 };
  }
  if (playoffsText != null && seasonDone(playoffsText)) {
    log(`Every bracket of the ${seasonOf(start)} season has a scored final and no game is left: the clock stops here.`);
    return { failed: false, handedOn: false, ticks: 0 };
  }
  if (playoffsText == null) log(`No playoffs.csv for the ${seasonOf(start)} season yet: the clock runs by the date alone.`);
  // The next run first: it waits (concurrency: gameday-clock) and starts however this one ends.
  if (dryRun) log(`Dry run: no next clock run queued.`);
  else {
    try {
      await api.dispatch(CLOCK_WORKFLOW, { minutes: String(minutes), retry: "false" });
      log(`Queued the next clock run; it starts when this one ends, however it ends.`);
    } catch (e) {
      log(`FAILED to queue the next clock run: ${e.message}. The clock stops when this run ends; start it again by hand.`);
      return { failed: true, handedOn: false, ticks: 0 };
    }
  }
  let failed = false;
  let ticks = 0;
  let wasOutside = false;
  for (;;) {
    const tick = nextTick(clock());
    if (tick > deadline) break;
    await sleep(tick - clock());
    const now = clock();
    ticks++;
    const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ");
    let verdict;
    try {
      verdict = inWindow(now) ? decide(now, await api.runs()) : decide(now, []);
    } catch (e) {
      failed = true;
      log(`${stamp} UTC: FAILED to read Results watch's runs: ${e.message}`);
      break;
    }
    if (verdict.dispatch && !dryRun) {
      try {
        await api.dispatch(READ_WORKFLOW, { tonight: "true" });
      } catch (e) {
        failed = true;
        log(`${stamp} UTC: FAILED to start the game-day read: ${e.message}`);
        break;
      }
    }
    if (verdict.stuck && !dryRun) {
      try {
        await notify("read-stuck");
      } catch (e) {
        log(`${stamp} UTC: could not post the stuck read to the robot-alert issue: ${e.message}`);
      }
    }
    // Outside the hours, only the first quiet tick is logged, not one line every 10 minutes all day.
    const outside = !inWindow(now);
    if (!(outside && wasOutside)) log(`${stamp} UTC: ${dryRun && verdict.dispatch ? "would have started the game-day read (dry run)" : verdict.line}`);
    wasOutside = outside;
  }
  if (dryRun || !failed) return { failed, handedOn: !dryRun, ticks };
  // A failure: the queued run becomes a retry (a newer queued run replaces the older one), and a retry that fails
  // too stops the chain rather than fail every 10 minutes all night.
  try {
    if (retry) {
      const n = await api.cancelQueued();
      log(`This run followed a failed one and failed too: cancelled ${n} queued clock run(s); the chain stops. Start it again by hand once it is fixed.`);
      return { failed, handedOn: false, ticks };
    }
    await api.dispatch(CLOCK_WORKFLOW, { minutes: String(minutes), retry: "true" });
    log(`Queued the next clock run as a retry: if it fails too, the chain stops.`);
    return { failed, handedOn: true, ticks };
  } catch (e) {
    log(`FAILED after a failure: ${e.message}. The clock run queued at the start still starts.`);
    return { failed, handedOn: true, ticks };
  }
}

function args(argv) {
  const at = argv.indexOf("--minutes");
  const minutes = at < 0 ? 330 : Number(argv[at + 1]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 340) throw new Error(`--minutes must be a whole number from 1 to 340, not: ${argv[at + 1]}`);
  return { minutes, dryRun: argv.includes("--dry-run"), retry: argv.includes("--retry") };
}

async function main() {
  const { minutes, dryRun, retry } = args(process.argv);
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: selfId, GITHUB_WORKFLOW: workflow = "Game-day clock", GITHUB_SERVER_URL: server = "https://github.com", GITHUB_STEP_SUMMARY: summary } = process.env;
  if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");
  const file = process.env.PLAYOFFS || `data/seed/maxpreps-${seasonOf(Date.now())}/playoffs.csv`;
  const log = (line) => {
    console.log(line);
    if (summary) appendFileSync(summary, `- ${line}\n`);
  };
  log(`Game-day clock: ${minutes} min${dryRun ? ", dry run" : ""}${retry ? ", after a failed run" : ""}.`);
  const result = await runClock({
    minutes,
    dryRun,
    retry,
    playoffsText: existsSync(file) ? readFileSync(file, "utf8") : null,
    clock: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms))),
    api: github({ token, repo, selfId }),
    notify: (reason) => alert({ api: alertApi({ token, repo }), workflow, runUrl: `${server}/${repo}/actions/runs/${selfId}`, runId: selfId, reason, log }),
    log,
  });
  log(`${result.ticks} ticks; ${result.failed ? "FAILED" : "ok"}; ${result.handedOn ? "the next clock run is queued" : "no next clock run"}.`);
  // A failure fails the job; the workflow's notify job posts it to the robot-alert issue (ADR 0027).
  if (result.failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
