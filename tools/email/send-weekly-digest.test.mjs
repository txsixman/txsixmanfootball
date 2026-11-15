import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { report, runWeeklyDigest } from "./send-weekly-digest.mjs";

const SCRIPT = fileURLToPath(new URL("./send-weekly-digest.mjs", import.meta.url));
const WEEK = "2026-w47";
const TOKEN = "cccccccc-0000-4000-8000-000000000001";
const POSTAL = { lines: ["<postal address>"] };
// Teams: alpha has a result and a next game; beta has neither (the off season for it).
const sections = {
  alpha: { slug: "alpha", name: "Alpha", last: { kind: "result", date: "2026-11-13", home: "Alpha", away: "Beta", homeScore: 40, awayScore: 14 }, ranking: { group: "Division I", place: 1, moved: 0 }, next: undefined },
  beta: { slug: "beta", name: "Beta", last: { kind: "none" }, ranking: { group: "Division I", place: 2, moved: 0 }, next: undefined },
};
const data = { forTeam: (slug) => sections[slug] };
const due = (n, slugs = ["alpha"]) => ({ user_id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`, email: `fan${n}@example.test`, followed_slugs: slugs, unsubscribe_token: TOKEN });
/** A database that answers the two calls and remembers what was marked. */
const fakeDb = (rows) => {
  const marked = [];
  const asked = [];
  return {
    marked, asked,
    query: async (sql, p) => {
      if (sql.includes("email_pending_digests")) return (asked.push(p), { rows });
      if (sql.includes("email_mark_sent")) return (marked.push(p), { rows: [] });
      throw new Error(`unexpected ${sql}`);
    },
  };
};
const run = (db, send, extra = {}) => runWeeklyDigest({ db, data, week: WEEK, postal: POSTAL, from: "A <a@example.test>", apiKey: "k", send, sleep: async () => {}, paceMs: 0, ...extra });

test("each due fan with news is sent one digest and it is recorded for the week; a refusal is recorded too; a retry is not", async () => {
  const db = fakeDb([due(1), due(2), due(3)]);
  const outcomes = ["sent", "rejected", "retry"];
  const sent = [];
  let i = 0;
  const r = await run(db, async (m) => (sent.push(m), { outcome: outcomes[i++], status: 0 }));
  assert.deepEqual([r.due, r.sent, r.rejected, r.retry, r.deferred, r.empty], [3, 1, 1, 1, 0, 0]);
  assert.deepEqual(db.asked, [[WEEK, 500]]);
  assert.deepEqual(db.marked.map((m) => [m[1], m[2], m[3]]), [["weekly_digest", WEEK, "sent"], ["weekly_digest", WEEK, "rejected"]]);
  assert.ok(sent.every((m) => m.subject === "Your weekly team digest" && /^[0-9a-f]{64}$/.test(m.key) && m.text.includes("<postal address>") && m.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click"));
  assert.equal(new Set(sent.map((m) => m.key)).size, 3); // one key per fan and week
});

test("a fan none of whose teams has a result or a next game is sent nothing that week, and nothing is recorded for them", async () => {
  const db = fakeDb([due(1, ["beta"]), due(2, ["beta", "alpha"]), due(3, [])]);
  const sent = [];
  const r = await run(db, async (m) => (sent.push(m.to), { outcome: "sent", status: 200 }));
  assert.deepEqual([r.due, r.sent, r.empty], [3, 1, 2]);
  assert.deepEqual(sent, ["fan2@example.test"]);
  assert.deepEqual(db.marked.map((m) => m[0]), [due(2).user_id]);
  assert.ok(sent.length === 1);
});

test("the same week is the same key, so a repeated run cannot send twice; the next week is a new key", async () => {
  const keys = [];
  const go = (week) => run(fakeDb([due(1)]), async (m) => (keys.push(m.key), { outcome: "sent", status: 200 }), { week });
  await go(WEEK);
  await go(WEEK);
  await go("2026-w48");
  assert.deepEqual([keys[0] === keys[1], keys[1] === keys[2]], [true, false]);
});

test("a dry run sends nothing and records nothing: it only counts who would be sent", async () => {
  const db = fakeDb([due(1), due(2, ["beta"])]);
  const r = await run(db, async () => assert.fail("sent in a dry run"), { dryRun: true });
  assert.deepEqual([r.due, r.wouldSend, r.empty, r.sent], [2, 1, 1, 0]);
  assert.deepEqual(db.marked, []);
});

test("without the postal address nothing is sent and every due digest is counted refused", async () => {
  for (const postal of [{ error: "not set" }, { error: "not a postal address a footer can hold" }]) {
    const db = fakeDb([due(1), due(2), due(3, ["beta"])]);
    const r = await run(db, async () => assert.fail("sent without an address"), { postal });
    assert.deepEqual([r.due, r.refused, r.sent, r.wouldSend], [3, 3, 0, 0]);
    assert.deepEqual(db.marked, []);
  }
});

test("the run summary names a refused address and fails the run; a clean run does not", async () => {
  const refused = await run(fakeDb([due(1), due(2)]), async () => assert.fail("sent"), { postal: { error: "not set" } });
  const bad = report({ r: refused, postal: { error: "not set" }, dryRun: false, week: WEEK });
  assert.equal(bad.fail, true);
  assert.match(bad.lines.join("\n"), /REFUSED: 2 digest\(s\) were not sent because the postal address \(repo variable EMAIL_POSTAL_ADDRESS\) is not set\./);
  const dry = report({ r: refused, postal: { error: "not set" }, dryRun: true, week: WEEK });
  assert.equal(dry.fail, true); // a dry run shows what a real run would refuse
  const ok = await run(fakeDb([due(1)]), async () => ({ outcome: "sent", status: 200 }));
  assert.deepEqual(report({ r: ok, postal: POSTAL, dryRun: false, week: WEEK }), { lines: [`${WEEK}: 1 digest(s) due: 1 sent, 0 refused by the email service, 0 to retry next run, 0 waiting, 0 with nothing to report.`], fail: false });
  assert.equal(report({ r: { ...ok, stopped: "stop" }, postal: POSTAL, dryRun: false, week: WEEK }).fail, true);
});

test("a slow-down or a refused key stops the run and leaves the rest waiting; the pace is kept between sends", async () => {
  const sleeps = [];
  const sent = [];
  const r = await run(fakeDb([due(1), due(2), due(3)]), async (m) => (sent.push(m.to), { outcome: sent.length === 2 ? "slow" : "sent", status: 0 }), { sleep: async (ms) => sleeps.push(ms), paceMs: 600 });
  assert.deepEqual([r.sent, r.stopped, r.deferred, sleeps], [1, "slow", 2, [600]]);
  assert.equal((await run(fakeDb([due(1)]), async () => ({ outcome: "stop", status: 401 }))).stopped, "stop");
});

test("a failure to record a sent digest is counted, and the run goes on", async () => {
  const db = fakeDb([due(1), due(2)]);
  const q = db.query;
  db.query = async (sql, p) => { if (sql.includes("email_mark_sent")) throw new Error("db fan1@example.test"); return q(sql, p); };
  const r = await run(db, async () => ({ outcome: "sent", status: 200 }));
  assert.deepEqual([r.sent, r.recordFailed], [2, 2]);
});

test("a fan who follows more than 25 teams gets the first 25 and a note", async () => {
  const slugs = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, "0")}`);
  const many = { forTeam: (slug) => ({ ...sections.alpha, slug, name: slug }) };
  let mail;
  await run(fakeDb([due(1, slugs)]), async (m) => ((mail = m), { outcome: "sent", status: 200 }), { data: many });
  assert.equal((mail.text.match(/^Last week:/gm) ?? []).length, 25);
  assert.match(mail.text, /5 more teams you follow are on your account\./);
});

test("nothing is sent while a switch, the Resend key or another setting is missing, and the summary says which", () => {
  const go = (env, args = []) => spawnSync("node", [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  const off = go({ EMAIL_ALERTS: "true", EMAIL_FROM: "f", PGPASSWORD: "p", RESEND_API_KEY: "k" }); // game alerts on is not the digest on
  assert.equal(off.status, 0);
  assert.match(off.stdout, /The weekly digest is off: the repo variable EMAIL_DIGEST is not true/);
  const noKey = go({ EMAIL_DIGEST: "true", EMAIL_FROM: "f", PGPASSWORD: "p" });
  assert.equal(noKey.status, 0);
  assert.match(noKey.stdout, /::warning::RESEND_API_KEY not set; no digest was sent\./);
  assert.match(go({ EMAIL_DIGEST: "true" }).stdout, /not set yet: RESEND_API_KEY, EMAIL_FROM \(repo variable\), EMAIL_DB_PASSWORD\./);
});

test("no address, id or postal address reaches the log, even when the database fails", async () => {
  const logs = [];
  const real = [console.log, console.error];
  console.log = console.error = (...a) => logs.push(a.join(" "));
  try {
    await run(fakeDb([due(7)]), async () => ({ outcome: "sent", status: 200 }));
    await run(fakeDb([due(8)]), async () => ({ outcome: "sent", status: 200 }), { postal: { error: "not set" } });
    await assert.rejects(run({ query: async () => { throw Object.assign(new Error("key (user_id)=(bbbbbbbb) fan7@example.test"), { code: "23503" }); } }, async () => ({})));
  } finally {
    [console.log, console.error] = real;
  }
  assert.doesNotMatch(logs.join("\n"), /@|bbbbbbbb|postal address>/);
});
