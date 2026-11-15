import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { missing, runGameAlerts } from "./send-game-alerts.mjs";

const SCRIPT = fileURLToPath(new URL("./send-game-alerts.mjs", import.meta.url));
const due = (n, over = {}) => ({
  user_id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`, email: `fan${n}@example.test`, alert: "final", event_key: "2026-11-13|alpha|beta",
  home_slug: "alpha", away_slug: "beta", home_name: "Alpha", away_name: "Beta", round: null, home_score: 1, away_score: 0, kickoff_at: null, followed_slug: "alpha", ...over,
});
/** A database that answers the three calls and remembers what was marked. */
const fakeDb = (rows) => {
  const marked = [];
  return {
    marked,
    query: async (sql, p) => {
      if (sql.includes("email_record_game_events")) return { rows: [{ n: JSON.parse(p[0]).length }] };
      if (sql.includes("email_pending_game_alerts")) return { rows };
      if (sql.includes("email_mark_sent")) return (marked.push(p), { rows: [] });
      throw new Error(`unexpected ${sql}`);
    },
  };
};
const run = (db, send, extra = {}) => runGameAlerts({ db, events: [{}], secret: "s".repeat(40), from: "A <a@example.test>", apiKey: "k", send, sleep: async () => {}, paceMs: 0, ...extra });

test("each due fan is sent one email and recorded; a refusal is recorded too; a retry is not", async () => {
  const db = fakeDb([due(1), due(2), due(3)]);
  const outcomes = ["sent", "rejected", "retry"];
  let i = 0;
  const r = await run(db, async () => ({ outcome: outcomes[i++], status: 0 }));
  assert.deepEqual([r.due, r.sent, r.rejected, r.retry, r.deferred], [3, 1, 1, 1, 0]);
  assert.deepEqual(db.marked.map((m) => [m[2], m[3]]), [["final:2026-11-13|alpha|beta", "sent"], ["final:2026-11-13|alpha|beta", "rejected"]]);
});

test("a slow-down or a refused key stops the run and leaves the rest waiting; the pace is kept between sends", async () => {
  const sleeps = [];
  const sent = [];
  const r = await run(fakeDb([due(1), due(2), due(3)]), async (m) => (sent.push(m.to), { outcome: sent.length === 2 ? "slow" : "sent", status: 0 }), { sleep: async (ms) => sleeps.push(ms), paceMs: 600 });
  assert.deepEqual([r.sent, r.stopped, r.deferred, sleeps], [1, "slow", 2, [600]]);
  assert.equal((await run(fakeDb([due(1)]), async () => ({ outcome: "stop", status: 401 }))).stopped, "stop");
});

test("a failure to record a sent email is counted, and the run goes on", async () => {
  const db = fakeDb([due(1), due(2)]);
  const q = db.query;
  db.query = async (sql, p) => { if (sql.includes("email_mark_sent")) throw new Error("db fan1@example.test"); return q(sql, p); };
  const r = await run(db, async () => ({ outcome: "sent", status: 200 }));
  assert.deepEqual([r.sent, r.recordFailed], [2, 2]);
});

test("nothing is sent while a switch, the Resend key or another setting is missing, and the summary says which", () => {
  assert.deepEqual(missing({}), ["RESEND_API_KEY", "EMAIL_FROM (repo variable)", "EMAIL_UNSUBSCRIBE_SECRET (32 characters or more)", "EMAIL_DB_PASSWORD"]);
  assert.deepEqual(missing({ RESEND_API_KEY: "k", EMAIL_FROM: "f", EMAIL_UNSUBSCRIBE_SECRET: "x".repeat(32), PGPASSWORD: "p" }), []);
  const go = (env) => spawnSync("node", [SCRIPT], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  const off = go({});
  assert.equal(off.status, 0);
  assert.match(off.stdout, /Email alerts are off/);
  const noKey = go({ EMAIL_ALERTS: "true", EMAIL_FROM: "f", EMAIL_UNSUBSCRIBE_SECRET: "x".repeat(32), PGPASSWORD: "p" });
  assert.equal(noKey.status, 0);
  assert.match(noKey.stdout, /::warning::RESEND_API_KEY not set; no email alerts were sent\./);
  assert.match(noKey.stdout, /Nothing was sent: not set yet: RESEND_API_KEY\./);
});

test("no address or id reaches the log, even when the database fails", async () => {
  const logs = [];
  const real = [console.log, console.error];
  console.log = console.error = (...a) => logs.push(a.join(" "));
  try {
    await run(fakeDb([due(7)]), async () => ({ outcome: "sent", status: 200 }));
    await assert.rejects(run({ query: async () => { throw Object.assign(new Error("key (user_id)=(bbbbbbbb) fan7@example.test"), { code: "23503" }); } }, async () => ({})));
  } finally {
    [console.log, console.error] = real;
  }
  assert.doesNotMatch(logs.join("\n"), /@|bbbbbbbb/);
});
