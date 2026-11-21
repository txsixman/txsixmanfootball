import assert from "node:assert/strict";
import { test } from "node:test";
import { catchUpTick, centralWeekday, CLOCK_WORKFLOW, MINUTE, decide, decideMorning, github, inWindow, isDetailsDay, isMorningTitle, isStuck, morningTick, nextTick, READ_WORKFLOW, runClock, seasonDone, seasonOf } from "./gameday-clock.mjs";

const at = (iso) => Date.parse(iso);
const run = (id, event, createdIso, status = "completed") => ({ id, event, status, created_at: createdIso });

test("the window is 16:30 to 06:10 UTC, in November and December only", () => {
  for (const t of ["2026-11-13T16:30:00Z", "2026-11-14T17:03:00Z", "2026-11-13T18:00:00Z", "2026-11-13T23:59:00Z", "2026-11-14T00:03:00Z", "2026-11-14T06:10:59Z", "2026-12-31T23:53:00Z", "2026-12-01T05:00:00Z", "2026-11-01T00:03:00Z"]) {
    assert.ok(inWindow(at(t)), t);
  }
  for (const t of ["2026-11-13T16:29:00Z", "2026-11-13T15:03:00Z", "2026-11-13T14:59:00Z", "2026-11-14T06:11:00Z", "2026-11-14T12:00:00Z", "2026-10-31T23:00:00Z", "2027-01-01T00:03:00Z", "2026-08-28T23:00:00Z"]) {
    assert.ok(!inWindow(at(t)), t);
  }
});

test("an 11 AM Central kickoff (17:00 UTC) gets a read before it, and the window leaves the morning ticks and the 15:03 catch-up alone", () => {
  // The first read is the 16:33 tick, 27 minutes before kickoff.
  assert.ok(inWindow(at("2026-11-21T16:33:00Z")));
  assert.equal(decide(at("2026-11-21T16:33:00Z"), []).dispatch, true);
  // The window never covers a morning tick or the catch-up, so no tick is decided twice.
  for (let m = 13 * 60; m < 16 * 60 + 30; m += 1) {
    const t = at("2026-11-21T00:00:00Z") + m * 60_000;
    assert.ok(!inWindow(t), String(m));
  }
  assert.ok(morningTick(at("2026-11-21T13:03:00Z")) && !inWindow(at("2026-11-21T13:03:00Z")));
  assert.ok(catchUpTick(at("2026-11-21T15:03:00Z")) && !inWindow(at("2026-11-21T15:03:00Z")));
});

test("the clock checks at each whole minute, always after now", () => {
  assert.equal(new Date(nextTick(at("2026-11-13T18:00:00Z"))).toISOString(), "2026-11-13T18:01:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T18:03:00Z"))).toISOString(), "2026-11-13T18:04:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T18:02:59.900Z"))).toISOString(), "2026-11-13T18:03:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T18:58:30Z"))).toISOString(), "2026-11-13T18:59:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T23:59:30Z"))).toISOString(), "2026-11-14T00:00:00.000Z");
  assert.equal(new Date(nextTick(at("2026-12-31T23:59:01Z"))).toISOString(), "2027-01-01T00:00:00.000Z");
});

test("the season is this year's from July, last year's before", () => {
  assert.equal(seasonOf(at("2026-11-13T18:00:00Z")), 2026);
  assert.equal(seasonOf(at("2027-01-02T00:00:00Z")), 2026);
  assert.equal(seasonOf(at("2026-07-01T00:00:00Z")), 2026);
});

test("a tick starts the read only when nothing else covers it", () => {
  const now = at("2026-11-13T20:03:00Z");
  assert.deepEqual(decide(now, []).dispatch, true);
  // The read the clock started 10 minutes ago is done: start this one.
  assert.equal(decide(now, [run(1, "workflow_dispatch", "2026-11-13T19:53:01Z")]).dispatch, true);
  // A 12-minute read that finished a minute ago still lets the next one start at once (no waiting for a later tick).
  assert.equal(decide(at("2026-11-13T20:13:00Z"), [run(1, "workflow_dispatch", "2026-11-13T20:01:00Z")]).dispatch, true);
  // A read still queued or under way, whatever started it.
  for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
    const v = decide(now, [run(2, "workflow_dispatch", "2026-11-13T19:30:00Z", status)]);
    assert.equal(v.dispatch, false, status);
    assert.match(v.line, new RegExp(status));
  }
  // GitHub's own schedule fired within 12 minutes: it has the tick.
  assert.equal(decide(now, [run(3, "schedule", "2026-11-13T19:52:00Z")]).dispatch, false);
  assert.equal(decide(now, [run(3, "schedule", "2026-11-13T19:50:00Z")]).dispatch, true);
  // Any read (the Mac's loop, a run by hand) started within 9.5 minutes has the tick: reads start 10 minutes apart.
  const mac = decide(now, [run(4, "workflow_dispatch", "2026-11-13T20:03:05Z")]);
  assert.equal(mac.dispatch, false);
  assert.match(mac.line, /min ago/);
  assert.equal(decide(now, [run(4, "workflow_dispatch", "2026-11-13T19:54:00Z")]).dispatch, false, "9 minutes ago");
  assert.equal(decide(now, [run(4, "workflow_dispatch", "2026-11-13T19:53:30Z")]).dispatch, true, "9.5 minutes ago");
  // Outside the hours, nothing, whatever the runs say, but the daytime catch-up tick.
  assert.equal(decide(at("2026-11-13T12:03:00Z"), []).dispatch, false);
  assert.equal(decide(at("2026-11-13T15:13:00Z"), []).dispatch, false);
});

test("the daytime catch-up (ADR 0030): one tick at 15:03 UTC in November and December starts a read, unless one covers it", () => {
  assert.ok(catchUpTick(at("2026-11-14T15:03:00Z")));
  for (const t of ["2026-11-14T14:53:00Z", "2026-11-14T15:13:00Z", "2026-10-31T15:03:00Z", "2027-01-02T15:03:00Z"]) assert.ok(!catchUpTick(at(t)), t);
  const v = decide(at("2026-11-14T15:03:00Z"), []);
  assert.equal(v.dispatch, true);
  assert.match(v.line, /catch-up/);
  assert.equal(decide(at("2026-11-14T15:03:00Z"), [run(5, "workflow_dispatch", "2026-11-14T14:40:00Z", "in_progress")]).dispatch, false);
  // The evening catch-up is any tick in the window: results-watch's due count includes the earlier nights.
  assert.equal(decide(at("2026-11-14T20:03:00Z"), []).dispatch, true);
});

const CSV = "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period";
test("the season is done only when every bracket has a scored final and no game is left", () => {
  assert.equal(seasonDone(CSV), false, "no rows yet");
  assert.equal(seasonDone(""), false);
  const r1 = "UIL,1,bi-district,2026-11-13,A,B,,40,0,mercy,";
  const finalA = "UIL,1,final,2026-12-17,A,C,y,50,44,,";
  const finalOpen = "UIL,1,final,2026-12-17,A,C,y,,,,";
  const t1 = "TAIAO,1,round-1,2026-11-06,D,E,,64,14,unknown,";
  assert.equal(seasonDone([CSV, r1].join("\n")), false, "no final yet");
  assert.equal(seasonDone([CSV, r1, finalOpen].join("\n")), false, "final not played");
  assert.equal(seasonDone([CSV, r1, finalA].join("\n") + "\n"), true);
  assert.equal(seasonDone([CSV, r1, finalA, t1].join("\n")), false, "TAIAO 1 still short of its final");
  assert.equal(seasonDone([CSV, r1, finalA, t1, "TAIAO,1,final,2026-11-21,D,F,y,30,28,,"].join("\n")), true);
});

/** A fake clock: sleep moves time; the API records what it was asked. */
function fake({ startIso, runs = () => [], dispatchFails = () => false, cancelFails = false }) {
  let now = at(startIso);
  const calls = [];
  const lines = [];
  return {
    calls,
    lines,
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    api: {
      runs: async () => runs(now, calls),
      dispatch: async (workflow, inputs) => {
        if (dispatchFails(workflow, now, inputs)) throw new Error("HTTP 403 Resource not accessible by integration");
        calls.push({ workflow, inputs, at: new Date(now).toISOString() });
      },
      cancelQueued: async () => {
        if (cancelFails) throw new Error("HTTP 500");
        calls.push({ cancel: true, at: new Date(now).toISOString() });
        return 1;
      },
    },
    log: (l) => lines.push(l),
  };
}
const NEXT = (minutes, retry = "false", atIso) => ({ workflow: CLOCK_WORKFLOW, inputs: { minutes, retry }, at: atIso });

test("a run queues the next clock run first, then checks every minute and starts a read every 10 minutes in the hours", async () => {
  const f = fake({ startIso: "2026-11-13T16:10:10Z" });
  const r = await runClock({ minutes: 60, playoffsText: null, ...f });
  // The next run is queued before the first tick, so it starts however this one ends.
  assert.deepEqual(f.calls[0], NEXT("60", "false", "2026-11-13T16:10:10.000Z"));
  const reads = f.calls.filter((c) => c.workflow === READ_WORKFLOW);
  assert.deepEqual(reads.map((c) => c.at), ["2026-11-13T16:30:00.000Z", "2026-11-13T16:40:00.000Z", "2026-11-13T16:50:00.000Z", "2026-11-13T17:00:00.000Z", "2026-11-13T17:10:00.000Z"]);
  assert.ok(reads.every((c) => c.inputs.tonight === "true"));
  assert.equal(f.calls.filter((c) => c.workflow === CLOCK_WORKFLOW).length, 1);
  assert.deepEqual(r, { failed: false, handedOn: true, ticks: 60 });
  // The checks before 16:30 log once, as outside the hours; the checks between reads log once a read, not once a minute.
  assert.ok(f.lines.length < 15, `${f.lines.length} lines`);
  assert.equal(f.lines.filter((l) => /outside/.test(l)).length, 1);
});

test("a tick the Mac's loop already covered is skipped and logged", async () => {
  const f = fake({ startIso: "2026-11-13T20:00:00Z", runs: (now) => [run(9, "workflow_dispatch", new Date(now - 20_000).toISOString())] });
  await runClock({ minutes: 20, playoffsText: null, ...f });
  assert.equal(f.calls.filter((c) => c.workflow === READ_WORKFLOW).length, 0);
  assert.equal(f.lines.filter((l) => /skipped: a read was started 0 min ago/.test(l)).length, 1, "logged once, not every minute");
});

test("a dry run decides every tick but starts nothing, not even the next clock run", async () => {
  const f = fake({ startIso: "2026-11-13T20:00:00Z" });
  const r = await runClock({ minutes: 25, dryRun: true, playoffsText: null, ...f });
  assert.deepEqual(f.calls, []);
  assert.equal(f.lines.filter((l) => /would have started/.test(l)).length, 3);
  assert.deepEqual(r, { failed: false, handedOn: false, ticks: 25 });
});

test("a failed read fails the run at once and makes the queued run a retry; a failed retry cancels the queued run", async () => {
  const f = fake({ startIso: "2026-11-13T20:00:00Z", dispatchFails: (w) => w === READ_WORKFLOW });
  const r = await runClock({ minutes: 330, playoffsText: null, ...f });
  assert.deepEqual(r, { failed: true, handedOn: true, ticks: 1 });
  // Queued first as a normal run; then a retry, which replaces it (one waiting run per concurrency group).
  assert.deepEqual(f.calls, [NEXT("330", "false", "2026-11-13T20:00:00.000Z"), NEXT("330", "true", "2026-11-13T20:01:00.000Z")]);
  assert.ok(f.lines.some((l) => /FAILED to start the game-day read: HTTP 403/.test(l)));

  const g = fake({ startIso: "2026-11-13T20:00:00Z", dispatchFails: (w) => w === READ_WORKFLOW });
  const again = await runClock({ minutes: 330, retry: true, playoffsText: null, ...g });
  assert.deepEqual(again, { failed: true, handedOn: false, ticks: 1 });
  assert.deepEqual(g.calls, [NEXT("330", "false", "2026-11-13T20:00:00.000Z"), { cancel: true, at: "2026-11-13T20:01:00.000Z" }]);
  assert.ok(g.lines.some((l) => /the chain stops/.test(l)));

  // If cancelling fails too, the queued run still starts: the chain goes on (and the failure is posted).
  const h = fake({ startIso: "2026-11-13T20:00:00Z", dispatchFails: (w) => w === READ_WORKFLOW, cancelFails: true });
  assert.deepEqual(await runClock({ minutes: 330, retry: true, playoffsText: null, ...h }), { failed: true, handedOn: true, ticks: 1 });
});

test("a failure to list runs fails the run; a failure to queue the next run fails it before any tick", async () => {
  const f = fake({ startIso: "2026-11-13T20:00:00Z", runs: () => { throw new Error("HTTP 500"); } });
  assert.equal((await runClock({ minutes: 30, playoffsText: null, ...f })).failed, true);
  const g = fake({ startIso: "2026-11-13T20:00:00Z", dispatchFails: (w) => w === CLOCK_WORKFLOW });
  assert.deepEqual(await runClock({ minutes: 15, playoffsText: null, ...g }), { failed: true, handedOn: false, ticks: 0 });
  assert.ok(g.lines.some((l) => /FAILED to queue the next clock run/.test(l)));
});

test("the clock stops for good outside November and December, and when the season is played out", async () => {
  const oct = fake({ startIso: "2026-10-30T20:00:00Z" });
  assert.deepEqual(await runClock({ minutes: 330, playoffsText: null, ...oct }), { failed: false, handedOn: false, ticks: 0 });
  assert.deepEqual(oct.calls, []);

  // The last run of December reads until 06:10 UTC on Jan 1; the run it queued starts in January and stops at once.
  const nye = fake({ startIso: "2026-12-31T22:00:00Z" });
  await runClock({ minutes: 330, playoffsText: null, ...nye });
  assert.ok(nye.calls.filter((c) => c.workflow === READ_WORKFLOW).every((c) => c.at < "2027-01-01T06:11:00Z"));
  const jan = fake({ startIso: "2027-01-01T03:31:00Z" });
  assert.deepEqual(await runClock({ minutes: 330, playoffsText: null, ...jan }), { failed: false, handedOn: false, ticks: 0 });
  assert.deepEqual(jan.calls, []);

  const done = fake({ startIso: "2026-12-20T20:00:00Z" });
  const csv = [CSV, "UIL,1,final,2026-12-17,A,C,y,50,44,,"].join("\n");
  assert.deepEqual(await runClock({ minutes: 330, playoffsText: csv, ...done }), { failed: false, handedOn: false, ticks: 0 });
  assert.deepEqual(done.calls, []);
});

test("the API client sends the token, dispatches on main, times out every call, and cancels only waiting clock runs", async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    if (url.includes(`${CLOCK_WORKFLOW}/runs`)) {
      return { ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 1, status: "in_progress" }, { id: 2, status: "pending" }, { id: 3, status: "completed" }, { id: 4, status: "queued" }, { id: 5, status: "pending" }] }) };
    }
    if (url.endsWith("/runs?per_page=30")) return { ok: true, status: 200, json: async () => ({ workflow_runs: [run(1, "schedule", "2026-11-13T18:00:00Z")] }) };
    if (url.endsWith("/cancel")) return { status: url.includes("/runs/4/") ? 409 : 202 };
    return url.includes(READ_WORKFLOW) ? { status: 204, text: async () => "" } : { status: 422, text: async () => "Unexpected inputs provided" };
  };
  const api = github({ token: "t0k", repo: "o/r", selfId: "5", fetchImpl });
  assert.equal((await api.runs()).length, 1);
  await api.dispatch(READ_WORKFLOW, { tonight: "true" });
  await assert.rejects(api.dispatch(CLOCK_WORKFLOW, { minutes: "1" }), /HTTP 422 Unexpected inputs/);
  assert.equal(seen[0].url, "https://api.github.com/repos/o/r/actions/workflows/results-watch.yml/runs?per_page=30");
  assert.equal(seen[0].init.headers.authorization, "Bearer t0k");
  assert.deepEqual(JSON.parse(seen[1].init.body), { ref: "main", inputs: { tonight: "true" } });
  assert.equal(seen[1].init.method, "POST");
  // Waiting runs 2 and 4 are cancelled (409: already finished, fine); not the running one, not this run (5).
  assert.equal(await api.cancelQueued(), 2);
  assert.deepEqual(seen.filter((s) => s.url.endsWith("/cancel")).map((s) => s.url.split("/runs/")[1]), ["2/cancel", "4/cancel"]);
  assert.ok(seen.every((s) => s.init.signal instanceof AbortSignal));
});

test("a read waiting over 60 minutes, or running over 90, is stuck: the clock starts a new one and posts it once a tick", async () => {
  const now = at("2026-11-13T21:03:00Z");
  assert.ok(isStuck(run(1, "workflow_dispatch", "2026-11-13T20:02:00Z", "queued"), now));
  assert.ok(!isStuck(run(1, "workflow_dispatch", "2026-11-13T20:04:00Z", "pending"), now));
  assert.ok(!isStuck(run(1, "workflow_dispatch", "2026-11-13T20:02:00Z", "in_progress"), now));
  assert.ok(isStuck(run(1, "workflow_dispatch", "2026-11-13T19:32:00Z", "in_progress"), now));
  const v = decide(now, [run(1, "workflow_dispatch", "2026-11-13T19:00:00Z", "queued")]);
  assert.deepEqual([v.dispatch, v.stuck], [true, true]);
  assert.match(v.line, /queued for 123 min \(run 1\): counted as stuck/);
  // A newer read that is not stuck still covers the tick.
  assert.equal(decide(now, [run(2, "workflow_dispatch", "2026-11-13T21:00:00Z", "pending"), run(1, "workflow_dispatch", "2026-11-13T19:00:00Z", "queued")]).dispatch, false);

  const posted = [];
  const f = fake({ startIso: "2026-11-13T21:00:00Z", runs: () => [run(1, "workflow_dispatch", "2026-11-13T19:00:00Z", "queued")] });
  await runClock({ minutes: 15, playoffsText: null, ...f, notify: async (reason) => posted.push(reason) });
  assert.deepEqual(posted, ["read-stuck", "read-stuck"]);
  assert.equal(f.calls.filter((c) => c.workflow === READ_WORKFLOW).length, 2);
  // A failed post is logged, and the clock goes on.
  const g = fake({ startIso: "2026-11-13T21:00:00Z", runs: () => [run(1, "workflow_dispatch", "2026-11-13T19:00:00Z", "queued")] });
  const r = await runClock({ minutes: 5, playoffsText: null, ...g, notify: async () => { throw new Error("HTTP 500"); } });
  assert.equal(r.failed, false);
  assert.ok(g.lines.some((l) => /could not post the stuck read/.test(l)));
  // A dry run posts nothing.
  const d = fake({ startIso: "2026-11-13T21:00:00Z", runs: () => [run(1, "workflow_dispatch", "2026-11-13T19:00:00Z", "queued")] });
  const none = [];
  await runClock({ minutes: 5, dryRun: true, playoffsText: null, ...d, notify: async (x) => none.push(x) });
  assert.deepEqual(none, []);
});

// ---- the daily morning read ----
// 2026-11-16 is a Monday; 11-20 a Friday, 11-21 a Saturday, 11-22 a Sunday, 11-26 a Thursday (Thanksgiving).
const titled = (id, createdIso, title, status = "completed", event = "workflow_dispatch") => ({ ...run(id, event, createdIso, status), display_title: title });

test("a morning tick is 13:00 to 14:59 UTC (7 to 9 AM Central) in November and December", () => {
  for (const t of ["2026-11-16T13:03:00Z", "2026-11-16T13:53:00Z", "2026-11-16T14:53:00Z", "2026-12-30T14:03:00Z"]) assert.ok(morningTick(at(t)), t);
  for (const t of ["2026-11-16T12:53:00Z", "2026-11-16T15:03:00Z", "2026-11-16T20:03:00Z", "2026-10-30T13:03:00Z", "2027-01-04T13:03:00Z"]) assert.ok(!morningTick(at(t)), t);
});

test("Monday to Thursday (Central) the morning read is the details read; Friday to Sunday it is the plain morning read", () => {
  const days = { "2026-11-16": 1, "2026-11-17": 2, "2026-11-18": 3, "2026-11-19": 4, "2026-11-20": 5, "2026-11-21": 6, "2026-11-22": 0, "2026-11-26": 4 };
  for (const [day, weekday] of Object.entries(days)) {
    assert.equal(centralWeekday(at(`${day}T13:03:00Z`)), weekday, day);
    assert.equal(centralWeekday(at(`${day}T14:53:00Z`)), weekday, day);
    assert.equal(isDetailsDay(at(`${day}T13:03:00Z`)), weekday >= 1 && weekday <= 4, day);
  }
});

test("a run titled a details read or a morning read is told apart from a game-day read", () => {
  assert.ok(isMorningTitle({ display_title: "Results watch: details read" }));
  assert.ok(isMorningTitle({ display_title: "Results watch: morning read" }));
  assert.ok(!isMorningTitle({ display_title: "Results watch: game-day read" }));
  assert.ok(!isMorningTitle({}));
});

test("a morning tick starts a details read Monday to Thursday and a plain morning read Friday to Sunday, once a day", () => {
  const mon = decideMorning(at("2026-11-16T13:03:00Z"), []);
  assert.deepEqual([mon.dispatch, mon.inputs], [true, { details: "true" }]);
  assert.match(mon.line, /details read/);
  for (const day of ["2026-11-20", "2026-11-21", "2026-11-22"]) {
    const v = decideMorning(at(`${day}T13:03:00Z`), []);
    assert.deepEqual([v.dispatch, v.inputs], [true, {}], day);
    assert.match(v.line, /morning read/);
  }
  const now = at("2026-11-17T13:23:00Z");
  // GitHub's own morning schedule (11:23 UTC) already started one today: the clock stands down, quietly.
  const cron = decideMorning(now, [run(1, "schedule", "2026-11-17T11:23:40Z")]);
  assert.deepEqual([cron.dispatch, cron.quiet], [false, true]);
  // A read the clock started at 13:03, whose title says so, covers every later tick, finished or not.
  for (const status of ["completed", "in_progress", "queued"]) {
    assert.equal(decideMorning(now, [titled(2, "2026-11-17T13:03:00Z", "Results watch: details read", status)]).dispatch, false, status);
  }
  assert.equal(decideMorning(now, [titled(2, "2026-11-17T13:03:00Z", "Results watch: morning read")]).dispatch, false);
  // Not these: yesterday's morning read, last night's game-day schedule runs (before 10:00 UTC), a game-day read today.
  assert.equal(decideMorning(now, [titled(3, "2026-11-16T13:03:00Z", "Results watch: details read"), run(4, "schedule", "2026-11-17T05:50:00Z"), titled(5, "2026-11-17T05:53:00Z", "Results watch: game-day read")]).dispatch, true);
  assert.equal(decideMorning(now, [titled(6, "2026-11-17T12:00:00Z", "Results watch: game-day read")]).dispatch, true);
});

test("a morning tick waits for a read that is active, and starts its read when every active read is stuck", () => {
  const now = at("2026-11-17T13:23:00Z");
  const busy = decideMorning(now, [titled(7, "2026-11-17T12:30:00Z", "Results watch: game-day read", "in_progress")]);
  assert.equal(busy.dispatch, false);
  assert.match(busy.line, /in_progress/);
  const stuck = decideMorning(now, [titled(8, "2026-11-17T09:00:00Z", "Results watch: game-day read", "queued")]);
  assert.deepEqual([stuck.dispatch, stuck.stuck, stuck.inputs], [true, true, { details: "true" }]);
  assert.match(stuck.line, /counted as stuck; started a new playoff-week details read/);
});

/** Results watch's runs as the API lists them after the clock's own dispatches: a run per dispatch, titled as run-name does. */
const listed = (now, calls) =>
  calls.filter((c) => c.workflow === READ_WORKFLOW).map((c, i) => titled(100 + i, c.at, c.inputs.details ? "Results watch: details read" : c.inputs.tonight ? "Results watch: game-day read" : "Results watch: morning read"));

test("the clock starts one details read on a Monday morning, stands down for the rest of it, and the 15:00 catch-up starts one read, not ten", async () => {
  const f = fake({ startIso: "2026-11-16T12:50:00Z", runs: listed });
  await runClock({ minutes: 150, playoffsText: null, ...f });
  const reads = f.calls.filter((c) => c.workflow === READ_WORKFLOW);
  assert.deepEqual(reads.map((c) => [c.at, c.inputs]), [["2026-11-16T13:00:00.000Z", { details: "true" }], ["2026-11-16T15:00:00.000Z", { tonight: "true" }]]);
  assert.equal(f.lines.filter((l) => /started the playoff-week details read/.test(l)).length, 1);
  assert.equal(f.lines.filter((l) => /already started/.test(l)).length, 1, "the later morning ticks are not logged one by one");
});

test("the clock starts a plain morning read on a Saturday when the morning schedule did not fire, and none when it did", async () => {
  const f = fake({ startIso: "2026-11-21T12:50:00Z", runs: listed });
  await runClock({ minutes: 100, playoffsText: null, ...f });
  assert.deepEqual(f.calls.filter((c) => c.workflow === READ_WORKFLOW).map((c) => [c.at, c.inputs]), [["2026-11-21T13:00:00.000Z", {}]]);

  const cron = fake({ startIso: "2026-11-21T12:50:00Z", runs: (now, calls) => [run(1, "schedule", "2026-11-21T11:25:00Z"), ...listed(now, calls)] });
  await runClock({ minutes: 100, playoffsText: null, ...cron });
  assert.deepEqual(cron.calls.filter((c) => c.workflow === READ_WORKFLOW), []);
});

test("a morning dry run says what it would start and starts nothing; outside November and December there is no morning read", async () => {
  const f = fake({ startIso: "2026-11-17T12:50:00Z" });
  await runClock({ minutes: 20, dryRun: true, playoffsText: null, ...f });
  assert.deepEqual(f.calls, []);
  assert.ok(f.lines.some((l) => /would have started the playoff-week details read \(dry run\)/.test(l)));
  assert.equal(decideMorning(at("2026-11-17T13:03:00Z"), []).dispatch, true);
  const oct = fake({ startIso: "2026-10-30T13:00:00Z" });
  assert.deepEqual(await runClock({ minutes: 30, playoffsText: null, ...oct }), { failed: false, handedOn: false, ticks: 0 });
});

test("a failed morning dispatch fails the run like a failed game-day read, naming it", async () => {
  const f = fake({ startIso: "2026-11-17T12:50:00Z", dispatchFails: (w) => w === READ_WORKFLOW });
  const r = await runClock({ minutes: 30, playoffsText: null, ...f });
  assert.equal(r.failed, true);
  assert.ok(f.lines.some((l) => /FAILED to start the playoff-week details read: HTTP 403/.test(l)));
});

/** Results watch's runs as the API lists them when each read takes `minutes` to finish: a run per dispatch, active until then. */
const withReadLength = (minutes) => (now, calls) =>
  calls
    .filter((c) => c.workflow === READ_WORKFLOW)
    .map((c, i) => {
      const created = Date.parse(c.at) + 2_000; // a run's start falls seconds after the dispatch
      return { id: 200 + i, event: "workflow_dispatch", created_at: new Date(created).toISOString(), status: now < created + minutes * MINUTE ? "in_progress" : "completed", display_title: "Results watch: game-day read" };
    })
    .reverse();

test("reads start every 10 minutes when a read takes less, and as soon as the last one ends when it takes longer (Nov 20 and 21 gave 20)", async () => {
  const gaps = async (readMinutes) => {
    const f = fake({ startIso: "2026-11-21T20:00:30Z", runs: withReadLength(readMinutes) });
    await runClock({ minutes: 125, playoffsText: null, ...f });
    const times = f.calls.filter((c) => c.workflow === READ_WORKFLOW).map((c) => Date.parse(c.at));
    return times.slice(1).map((t, i) => (t - times[i]) / MINUTE);
  };
  // A 7-minute read: every 10 minutes.
  assert.deepEqual(await gaps(7), Array(12).fill(10));
  // A 12-minute read: the next one starts when it ends (12 minutes after the dispatch, checked at the minute), never 20.
  const long = await gaps(12);
  assert.ok(long.every((g) => g >= 12 && g <= 13), long.join(","));
  // The 2-hour run has about 10 reads of 12 minutes, where the rounded-up 20-minute rhythm gave 6.
  assert.ok(long.length >= 9, String(long.length));
});

test("a read the clock just started is counted before the run list shows it, so a slow listing never doubles a start", async () => {
  const f = fake({ startIso: "2026-11-21T20:00:30Z", runs: () => [] });
  await runClock({ minutes: 9, playoffsText: null, ...f });
  assert.equal(f.calls.filter((c) => c.workflow === READ_WORKFLOW).length, 1);
  assert.ok(f.lines.some((l) => /this clock started a read \d+ min ago/.test(l)));
});

test("a stuck read is replaced and posted once every 10 minutes, not every minute", async () => {
  const posted = [];
  const f = fake({ startIso: "2026-11-13T21:00:00Z", runs: (now, calls) => [...withReadLength(1)(now, calls), run(1, "workflow_dispatch", "2026-11-13T19:00:00Z", "queued")].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) });
  await runClock({ minutes: 25, playoffsText: null, ...f, notify: async (reason) => posted.push(reason) });
  assert.equal(f.calls.filter((c) => c.workflow === READ_WORKFLOW).length, 3);
  assert.deepEqual(posted, ["read-stuck", "read-stuck", "read-stuck"]);
});
