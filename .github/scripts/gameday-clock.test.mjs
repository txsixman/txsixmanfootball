import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOCK_WORKFLOW, decide, github, inWindow, nextTick, READ_WORKFLOW, runClock, seasonDone, seasonOf } from "./gameday-clock.mjs";

const at = (iso) => Date.parse(iso);
const run = (id, event, createdIso, status = "completed") => ({ id, event, status, created_at: createdIso });

test("the window is 18:00 to 06:10 UTC, in November and December only", () => {
  for (const t of ["2026-11-13T18:00:00Z", "2026-11-13T23:59:00Z", "2026-11-14T00:03:00Z", "2026-11-14T06:10:59Z", "2026-12-31T23:53:00Z", "2026-12-01T05:00:00Z", "2026-11-01T00:03:00Z"]) {
    assert.ok(inWindow(at(t)), t);
  }
  for (const t of ["2026-11-13T17:59:00Z", "2026-11-14T06:11:00Z", "2026-11-14T12:00:00Z", "2026-10-31T23:00:00Z", "2027-01-01T00:03:00Z", "2026-08-28T23:00:00Z"]) {
    assert.ok(!inWindow(at(t)), t);
  }
});

test("ticks fall at :03, :13 ... :53, always after now", () => {
  assert.equal(new Date(nextTick(at("2026-11-13T18:00:00Z"))).toISOString(), "2026-11-13T18:03:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T18:03:00Z"))).toISOString(), "2026-11-13T18:13:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T18:02:59.900Z"))).toISOString(), "2026-11-13T18:03:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T18:58:30Z"))).toISOString(), "2026-11-13T19:03:00.000Z");
  assert.equal(new Date(nextTick(at("2026-11-13T23:55:00Z"))).toISOString(), "2026-11-14T00:03:00.000Z");
  assert.equal(new Date(nextTick(at("2026-12-31T23:54:00Z"))).toISOString(), "2027-01-01T00:03:00.000Z");
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
  // A read still queued or under way, whatever started it.
  for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
    const v = decide(now, [run(2, "workflow_dispatch", "2026-11-13T19:30:00Z", status)]);
    assert.equal(v.dispatch, false, status);
    assert.match(v.line, new RegExp(status));
  }
  // GitHub's own schedule fired within 12 minutes: it has the tick.
  assert.equal(decide(now, [run(3, "schedule", "2026-11-13T19:52:00Z")]).dispatch, false);
  assert.equal(decide(now, [run(3, "schedule", "2026-11-13T19:50:00Z")]).dispatch, true);
  // The Mac's loop (or a run by hand) started one within 8 minutes.
  const mac = decide(now, [run(4, "workflow_dispatch", "2026-11-13T20:03:05Z")]);
  assert.equal(mac.dispatch, false);
  assert.match(mac.line, /min ago/);
  assert.equal(decide(now, [run(4, "workflow_dispatch", "2026-11-13T19:54:00Z")]).dispatch, true);
  // Outside the hours, nothing, whatever the runs say.
  assert.equal(decide(at("2026-11-13T15:03:00Z"), []).dispatch, false);
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

test("a run queues the next clock run first, then starts a read every 10 minutes in the hours", async () => {
  const f = fake({ startIso: "2026-11-13T17:40:10Z" });
  const r = await runClock({ minutes: 60, playoffsText: null, ...f });
  // The next run is queued before the first tick, so it starts however this one ends.
  assert.deepEqual(f.calls[0], NEXT("60", "false", "2026-11-13T17:40:10.000Z"));
  const reads = f.calls.filter((c) => c.workflow === READ_WORKFLOW);
  assert.deepEqual(reads.map((c) => c.at), ["2026-11-13T18:03:00.000Z", "2026-11-13T18:13:00.000Z", "2026-11-13T18:23:00.000Z", "2026-11-13T18:33:00.000Z"]);
  assert.ok(reads.every((c) => c.inputs.tonight === "true"));
  assert.equal(f.calls.filter((c) => c.workflow === CLOCK_WORKFLOW).length, 1);
  assert.deepEqual(r, { failed: false, handedOn: true, ticks: 6 });
  // The two ticks before 18:00 log once, as outside the hours.
  assert.equal(f.lines.filter((l) => /outside/.test(l)).length, 1);
});

test("a tick the Mac's loop already covered is skipped and logged", async () => {
  const f = fake({ startIso: "2026-11-13T20:00:00Z", runs: (now) => [run(9, "workflow_dispatch", new Date(now - 20_000).toISOString())] });
  await runClock({ minutes: 20, playoffsText: null, ...f });
  assert.equal(f.calls.filter((c) => c.workflow === READ_WORKFLOW).length, 0);
  assert.equal(f.lines.filter((l) => /skipped: a read was started 0 min ago/.test(l)).length, 2);
});

test("a dry run decides every tick but starts nothing, not even the next clock run", async () => {
  const f = fake({ startIso: "2026-11-13T20:00:00Z" });
  const r = await runClock({ minutes: 25, dryRun: true, playoffsText: null, ...f });
  assert.deepEqual(f.calls, []);
  assert.equal(f.lines.filter((l) => /would have started/.test(l)).length, 3);
  assert.deepEqual(r, { failed: false, handedOn: false, ticks: 3 });
});

test("a failed read fails the run at once and makes the queued run a retry; a failed retry cancels the queued run", async () => {
  const f = fake({ startIso: "2026-11-13T20:00:00Z", dispatchFails: (w) => w === READ_WORKFLOW });
  const r = await runClock({ minutes: 330, playoffsText: null, ...f });
  assert.deepEqual(r, { failed: true, handedOn: true, ticks: 1 });
  // Queued first as a normal run; then a retry, which replaces it (one waiting run per concurrency group).
  assert.deepEqual(f.calls, [NEXT("330", "false", "2026-11-13T20:00:00.000Z"), NEXT("330", "true", "2026-11-13T20:03:00.000Z")]);
  assert.ok(f.lines.some((l) => /FAILED to start the game-day read: HTTP 403/.test(l)));

  const g = fake({ startIso: "2026-11-13T20:00:00Z", dispatchFails: (w) => w === READ_WORKFLOW });
  const again = await runClock({ minutes: 330, retry: true, playoffsText: null, ...g });
  assert.deepEqual(again, { failed: true, handedOn: false, ticks: 1 });
  assert.deepEqual(g.calls, [NEXT("330", "false", "2026-11-13T20:00:00.000Z"), { cancel: true, at: "2026-11-13T20:03:00.000Z" }]);
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
