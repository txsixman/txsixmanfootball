import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedEndpoint, alertsOn, buildContext, finalEvent, kickoffEvents, message, newFinals, pairingEvents, pruneSent, roundLabel, sendAll } from "./send-finals.mjs";

// The database tests below need the real migrations and PGlite; they load them when they run, so the offline tests further down
// (a fake database, no packages) still run where PGlite is not installed.
const database = async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { migrate } = await import("../../packages/db/load.mjs");
  return { db: new PGlite(), migrate };
};

const FAN_A = "33333333-3333-4333-8333-333333333333";
const FAN_B = "44444444-4444-4444-8444-444444444444";

const HEADER = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";
const row = (date, home, away, hs, as) => `I,season,${date},${home},${away},false,${hs},${as},unknown,,https://example.com/g,`;
const csv = (...rows) => [HEADER, ...rows].join("\n");

test("a new final is a played game the earlier file lacked, or had with another score", () => {
  const before = csv(row("2026-11-06", "Jayton", "Guthrie", 52, 6), row("2026-11-13", "Strawn", "Gordon", "", ""));
  const after = csv(row("2026-11-06", "Jayton", "Guthrie", 52, 6), row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34));
  assert.deepEqual(newFinals(before, after).map((f) => f.home), ["Strawn", "Abbott"]);
  assert.equal(newFinals(after, after).length, 0);
  assert.equal(newFinals("", csv(row("2026-11-06", "Jayton", "Guthrie", 52, 6))).length, 1);
  const corrected = csv(row("2026-11-06", "Jayton", "Guthrie", 50, 6));
  assert.equal(newFinals(before, corrected).length, 1);
});

test("the alert names the score, not a winner, and links the followed program", () => {
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34)));
  assert.deepEqual(message(finals, ["gordon"]), { title: "Gordon 0, Strawn 45", body: "Final score. Tap for the program page.", url: "/programs/gordon" });
  assert.equal(message(finals, ["strawn", "abbott"]).title, "2 new finals");
  assert.equal(message(finals, ["jayton"]), null);
  for (const m of [message(finals, ["gordon"]), message(finals, ["strawn", "abbott"])]) {
    assert.doesNotMatch(JSON.stringify(m), /\b(win|won|beat|spread|odds|line|bet)s?\b/i);
  }
});

test("pushes go only to the browsers' push services", () => {
  assert.ok(allowedEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(allowedEndpoint("https://web.push.apple.com/QOk"));
  assert.ok(!allowedEndpoint("https://evil.example.com/fcm.googleapis.com"));
  assert.ok(!allowedEndpoint("http://fcm.googleapis.com/x"));
  assert.ok(!allowedEndpoint("not a url"));
});

test("sends one alert per following browser, deletes gone ones, counts failures", async () => {
  const { db, migrate } = await database();
  await migrate(db);
  const sub = (id, programs) => db.query("select push_follow($1, $2, $3, $4)", [`https://fcm.googleapis.com/fcm/send/${id}`, "B".repeat(87), "a".repeat(22), programs]);
  await sub("ok", ["strawn"]);
  await sub("gone", ["gordon"]);
  await sub("down", ["strawn", "gordon"]);
  await sub("other", ["jayton"]);
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0)));
  const sent = [];
  const send = async (s, body) => {
    const id = s.endpoint.split("/").at(-1);
    if (id === "gone") throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (id === "down") throw Object.assign(new Error("server"), { statusCode: 503 });
    sent.push([id, JSON.parse(body).url]);
  };
  const r = await sendAll({ db, send, finals });
  assert.deepEqual(sent, [["ok", "/programs/strawn"]]);
  assert.deepEqual({ ...r, failed: r.failed.length }, { finals: 1, subscriptions: 3, sent: 1, removed: 1, skipped: 0, failed: 1 });
  const left = await db.query("select endpoint from push_subscription order by 1");
  assert.equal(left.rows.length, 3);
  assert.ok(!left.rows.some((x) => x.endpoint.endsWith("/gone")));
  // Only the browser the push service accepted a message for is confirmed (migration 0018).
  const confirmed = await db.query("select endpoint from push_subscription where confirmed_at is not null");
  assert.deepEqual(confirmed.rows.map((x) => x.endpoint.split("/").at(-1)), ["ok"]);
});

// Push alerts tied to the account (migration 0023, ADR 0054): the real migrations, the real SQL, only the push itself is a stub.
async function accountDb() {
  const { db: d, migrate } = await database();
  await d.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  await migrate(d);
  for (const [id, name] of [[FAN_A, "Fan A"], [FAN_B, "Fan B"]]) await d.query("insert into profile (user_id, display_name, birth_year) values ($1, $2, 1990)", [id, name]);
  return d;
}
const endpointOf = (id) => `https://fcm.googleapis.com/fcm/send/${id}`;
const linkAs = async (d, sub, id) => {
  await d.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  await d.query("select link_push_subscription($1, $2, $3)", [endpointOf(id), "B".repeat(87), "a".repeat(22)]);
};
const followAs = async (d, sub, slugs) => {
  await d.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  for (const slug of slugs) await d.query("select follow_program($1)", [slug]);
};
const recorder = () => {
  const sent = [];
  return { sent, send: async (s, body) => void sent.push([s.endpoint.split("/").at(-1), JSON.parse(body)]) };
};

test("a browser linked to an account is alerted for the account's follows, one alert, whatever else it follows", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn"]); // followed on another device
  await linkAs(d, FAN_A, "laptop"); // a signed-in browser with nothing of its own
  await linkAs(d, FAN_A, "phone"); // a second browser of the same account
  await followAs(d, FAN_B, ["abbott"]);
  await linkAs(d, FAN_B, "other-fan"); // another account, following a program that did not play
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("signed-out"), "B".repeat(87), "a".repeat(22), ["strawn"]]); // as ever
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("elsewhere"), "B".repeat(87), "a".repeat(22), ["jayton"]]);
  const { sent, send } = recorder();
  const r = await sendAll({ db: d, send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0))) });
  assert.deepEqual(sent.map(([id]) => id).sort(), ["laptop", "phone", "signed-out"]);
  assert.ok(sent.every(([, m]) => m.title === "Gordon 0, Strawn 45" && m.url === "/programs/strawn"));
  assert.deepEqual({ ...r, failed: r.failed.length }, { finals: 1, subscriptions: 3, sent: 3, removed: 0, skipped: 0, failed: 0 });
});

test("a program followed both ways, or with two finals, is still one alert to the one browser", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn", "gordon"]);
  await linkAs(d, FAN_A, "laptop");
  // The browser's own list gets the same programs again (a signed-out push_follow on a linked browser, as when the session ended).
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("laptop"), "B".repeat(87), "a".repeat(22), ["strawn", "gordon"]]);
  const { sent, send } = recorder();
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34)));
  const r = await sendAll({ db: d, send, finals });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].title, "Gordon 0, Strawn 45"); // one game involves both followed programs: one line
  assert.equal(r.subscriptions, 1);
});

test("an unfollow on the account stops the alert on every linked browser; a gone linked browser is deleted like any other", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn", "abbott"]);
  await linkAs(d, FAN_A, "laptop");
  await linkAs(d, FAN_A, "gone");
  await d.query("select unfollow_program('strawn')");
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0)));
  const first = recorder();
  await sendAll({ db: d, send: first.send, finals });
  assert.deepEqual(first.sent, []);
  await d.query("select follow_program('strawn')");
  const send = async (s, body) => {
    if (s.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    return recorder().send(s, body);
  };
  const r = await sendAll({ db: d, send, finals });
  assert.deepEqual({ sent: r.sent, removed: r.removed }, { sent: 1, removed: 1 });
  assert.deepEqual((await d.query("select endpoint from push_subscription")).rows.map((x) => x.endpoint.split("/").at(-1)), ["laptop"]);
});

test("before migration 0023 is on the database the sender still alerts, by each browser's own programs, and says so", async () => {
  const d = await accountDb();
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("signed-out"), "B".repeat(87), "a".repeat(22), ["strawn"]]);
  await d.exec("alter table push_subscription drop column user_id cascade");
  const { sent, send } = recorder();
  const r = await sendAll({ db: d, send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0))) });
  assert.deepEqual(sent.map(([id]) => id), ["signed-out"]);
  assert.equal(r.accountLinksSkipped, true);
});

test("a program muted on a browser gets no alert there, whoever follows it; the account's other browsers and the other programs are unaffected (migration 0026)", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn", "abbott"]);
  await linkAs(d, FAN_A, "laptop");
  await linkAs(d, FAN_A, "phone");
  await d.query("select push_follow($1, $2, $3, $4)", [endpointOf("signed-out"), "B".repeat(87), "a".repeat(22), ["strawn"]]);
  const mute = (id, slugs) => d.query("update push_subscription set muted = $1 where endpoint = $2", [slugs, endpointOf(id)]);
  await mute("laptop", ["strawn"]); // muted on this browser only
  await mute("signed-out", ["strawn"]); // a browser's own program can be muted too
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0)));
  const first = recorder();
  const r = await sendAll({ db: d, send: first.send, finals });
  assert.deepEqual(first.sent.map(([id]) => id), ["phone"]);
  assert.deepEqual({ subscriptions: r.subscriptions, sent: r.sent, skipped: r.skipped, mutesSkipped: r.mutesSkipped }, { subscriptions: 3, sent: 1, skipped: 2, mutesSkipped: undefined });
  // Two finals, one muted: the alert is about the other one only; a muted program mutes nothing else.
  await mute("phone", ["strawn"]);
  const two = recorder();
  await sendAll({ db: d, send: two.send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0), row("2026-11-13", "Abbott", "Aquilla", 40, 34))) });
  assert.deepEqual(two.sent.map(([id, m]) => [id, m.title, m.url]).sort(), [
    ["laptop", "Aquilla 34, Abbott 40", "/programs/abbott"],
    ["phone", "Aquilla 34, Abbott 40", "/programs/abbott"],
  ]);
  // Unmuting brings the alert back (the same final again, so the sent-log of the first run is cleared: a final goes out once).
  await mute("laptop", []);
  await d.exec("delete from push_sent");
  const three = recorder();
  await sendAll({ db: d, send: three.send, finals });
  assert.deepEqual(three.sent.map(([id]) => id), ["laptop"]);
});

test("before migration 0026 is on the database the sender still alerts, account follows included, with no mutes, and says so", async () => {
  const d = await accountDb();
  await followAs(d, FAN_A, ["strawn"]);
  await linkAs(d, FAN_A, "laptop");
  await d.exec("alter table push_subscription drop column muted");
  const { sent, send } = recorder();
  const r = await sendAll({ db: d, send, finals: newFinals("", csv(row("2026-11-13", "Strawn", "Gordon", 45, 0))) });
  assert.deepEqual(sent.map(([id]) => id), ["laptop"]);
  assert.equal(r.mutesSkipped, true);
  assert.equal(r.accountLinksSkipped, undefined);
});

test("web-push provides what the sender and the key setup call (named exports, no default)", async () => {
  const webpush = await import("web-push");
  for (const name of ["generateVAPIDKeys", "setVapidDetails", "sendNotification"]) assert.equal(typeof webpush[name], "function", name);
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  assert.match(publicKey, /^[A-Za-z0-9_-]{87}$/);
  assert.match(privateKey, /^[A-Za-z0-9_-]{43}$/);
});

// Game alerts (ADR 0082, migration 0031): the fake database stands in for Postgres, so these run with no packages installed.
const FAKE_SUB = (id, programs, extra = {}) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: "B".repeat(87), auth: "a".repeat(22), muted: [], programs, ...extra });
const code = (c) => Object.assign(new Error(`sql ${c}`), { code: c });

/** Only the statements the sender runs: the switch, the sent-log claim and prune, the subscription read, confirm and delete. */
function fakeDb({ on = false, subs = [], sent = new Set(), noSentTable = false, noSwitchTable = false, sentAges = new Map() } = {}) {
  const log = { confirmed: [], deleted: [], claims: [] };
  return {
    sent, log, subs,
    async query(sql, params) {
      if (sql.includes("from site_switch")) {
        if (noSwitchTable) throw code("42P01");
        return { rows: on ? [{ is_on: true }] : [] };
      }
      if (sql.includes("insert into push_sent")) {
        if (noSentTable) throw code("42P01");
        log.claims.push(params[0]);
        if (sent.has(params[0])) return { rows: [] };
        sent.add(params[0]);
        return { rows: [{ event_key: params[0] }] };
      }
      if (sql.includes("delete from push_sent")) {
        if (noSentTable) throw code("42P01");
        const old = [...sentAges].filter(([, days]) => days > 90).map(([k]) => k);
        for (const k of old) sent.delete(k);
        return { rowCount: old.length, rows: [] };
      }
      if (sql.includes("from push_subscription s")) return { rows: subs.filter((s) => s.programs.some((p) => params[0].includes(p))) };
      if (sql.startsWith("update push_subscription")) {
        log.confirmed.push(params[0]);
        return { rows: [] };
      }
      if (sql.startsWith("delete from push_subscription")) {
        log.deleted.push(params[0]);
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}
const collect = () => {
  const sent = [];
  return { sent, send: async (s, body, opts) => void sent.push({ id: s.endpoint.split("/").at(-1), msg: JSON.parse(body), ttl: opts?.ttl }) };
};

const PHEADER = "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period";
const prow = (round, date, home, away, hs = "", as = "") => `UIL,I,${round},${date},${home},${away},,${hs},${as},,`;
const pcsv = (...rows) => [PHEADER, ...rows].join("\n");
const ALIGN = "league,division,region,district,school,source_url\nUIL,I,1,1,Whiteface,https://example.com/a\nUIL,I,1,1,Jayton,https://example.com/a";
const SEMI = { league: "UIL", division: "I", round: "semifinal", home: "Jayton", away: "Whiteface" };
const SEMI_UNPLAYED = pcsv(prow("semifinal", "2026-11-20", "Whiteface", "Jayton"));
const live = (home, away, extra = {}) => ({ game_key: `2026-11-13|${[home, away].sort().join("|")}`, home, away, home_score: 7, away_score: 0, period: "Q2", finished: false, late: false, read_at: "2026-11-13T02:00:00.000Z", ...extra });

test("alerts are off when the switch table or row is missing, on only when the row says so", async () => {
  assert.equal(await alertsOn(fakeDb({ noSwitchTable: true })), false);
  assert.equal(await alertsOn(fakeDb({ on: false })), false);
  assert.equal(await alertsOn(fakeDb({ on: true })), true);
  await assert.rejects(alertsOn({ query: async () => { throw code("08006"); } }), /08006/); // any other failure is loud
});

test("switch off: finals go out as ever (old wording and program page), no kickoff, no pairing, and the final is still claimed once", async () => {
  const db = fakeDb({ on: false, subs: [FAKE_SUB("a", ["jayton"]), FAKE_SUB("b", ["whiteface"])] });
  const { sent, send } = collect();
  const finals = newFinals("", csv(row("2026-11-13", "Strawn", "Jayton", 45, 0)));
  const ctx = buildContext({ season: "2026", playoffs: SEMI_UNPLAYED });
  const r = await sendAll({ db, send, finals, kickoffs: [live("whiteface", "jayton")], pairings: [SEMI], ctx });
  assert.deepEqual(sent.map((x) => [x.id, x.msg]), [["a", { title: "Jayton 0, Strawn 45", body: "Final score. Tap for the program page.", url: "/programs/jayton" }]]);
  assert.deepEqual({ ...r, failed: r.failed.length }, { finals: 1, subscriptions: 1, sent: 1, removed: 0, skipped: 0, failed: 0 });
  assert.deepEqual([...db.sent], ["final|2026-11-13|jayton|strawn|0-45"]);
  assert.equal(sent[0].ttl, 6 * 60 * 60);
});

test("switch on: the final says who won with the game page, the kickoff and the next round are sent, each with a tag and its own time to live", async () => {
  const db = fakeDb({ on: true, subs: [FAKE_SUB("fan", ["whiteface", "jayton"])] });
  const { sent, send } = collect();
  const ctx = buildContext({ season: "2026", playoffs: SEMI_UNPLAYED, texts: [csv(row("2026-11-06", "Whiteface", "Guthrie", 40, 6)), ALIGN] });
  const finals = newFinals("", csv(row("2026-11-13", "Jayton", "Whiteface", 12, 48)));
  const r = await sendAll({ db, send, finals, kickoffs: [live("jayton", "whiteface")], pairings: [SEMI], ctx });
  assert.deepEqual(sent.map((x) => x.msg.title), ["Final: Whiteface 48, Jayton 12", "Whiteface v Jayton has started", "Next round: Whiteface v Jayton"]);
  const [fin, kick, pair] = sent;
  for (const x of sent) assert.deepEqual(Object.keys(x.msg).sort(), ["body", "tag", "title", "url"]);
  assert.equal(fin.msg.body, "Tap for the game page.");
  assert.equal(fin.msg.url, "/scores/2026-11-13-whiteface-at-jayton");
  assert.equal(kick.msg.url, "/scores/2026-11-13-whiteface-at-jayton");
  assert.equal(fin.msg.tag, kick.msg.tag); // the final replaces the kickoff on the device
  assert.equal(fin.msg.tag, "game:2026-11-13|jayton|whiteface");
  assert.equal(pair.msg.tag, "pairing:2026|semifinal|jayton|whiteface");
  assert.equal(pair.msg.body, "UIL Division I · Semifinal · Fri, Nov 20");
  assert.equal(pair.msg.url, "/scores/2026-semifinal-whiteface-at-jayton");
  assert.deepEqual([fin.ttl, kick.ttl, pair.ttl], [6 * 3600, 3600, 6 * 3600]);
  for (const x of sent) assert.match(x.msg.tag, /^[a-z0-9:|._-]{1,120}$/);
  assert.deepEqual({ sent: r.sent, kickoffs: r.kickoffs, pairings: r.pairings }, { sent: 3, kickoffs: 1, pairings: 1 });
  assert.doesNotMatch(JSON.stringify(sent.map((x) => x.msg)), /\b(spread|odds|line|bet|wager|parlay|pick)s?\b/i);
});

test("the final names the winner first, and a tie names the away team first", () => {
  assert.equal(finalEvent({ date: "2026-11-13", home: "Jayton", away: "Whiteface", homeScore: 12, awayScore: 48 }).title, "Final: Whiteface 48, Jayton 12");
  assert.equal(finalEvent({ date: "2026-11-13", home: "Jayton", away: "Whiteface", homeScore: 50, awayScore: 8 }).title, "Final: Jayton 50, Whiteface 8");
  assert.equal(finalEvent({ date: "2026-11-13", home: "Jayton", away: "Whiteface", homeScore: 20, awayScore: 20 }).title, "Final: Whiteface 20, Jayton 20");
});

test("a claimed event is not sent twice, in one run or across two", async () => {
  const db = fakeDb({ on: true, subs: [FAKE_SUB("fan", ["jayton"])] });
  const finals = newFinals("", csv(row("2026-11-13", "Jayton", "Whiteface", 12, 48)));
  const kickoffs = [live("jayton", "whiteface")];
  const first = collect();
  const r1 = await sendAll({ db, send: first.send, finals: [...finals, ...finals], kickoffs });
  assert.deepEqual(first.sent.map((x) => x.msg.title), ["Final: Whiteface 48, Jayton 12", "Whiteface v Jayton has started"]);
  assert.equal(r1.duplicates, undefined);
  const second = collect();
  const r2 = await sendAll({ db, send: second.send, finals, kickoffs });
  assert.deepEqual(second.sent, []);
  assert.deepEqual({ sent: r2.sent, skipped: r2.skipped, duplicates: r2.duplicates }, { sent: 0, skipped: 1, duplicates: 2 });
  // A corrected score is a new final, as ever.
  const fixed = newFinals("", csv(row("2026-11-13", "Jayton", "Whiteface", 13, 48)));
  const third = collect();
  await sendAll({ db, send: third.send, finals: fixed });
  assert.deepEqual(third.sent.map((x) => x.msg.title), ["Final: Whiteface 48, Jayton 13"]);
  assert.deepEqual([...db.sent].sort(), ["final|2026-11-13|jayton|whiteface|48-12", "final|2026-11-13|jayton|whiteface|48-13", "kickoff|2026-11-13|jayton|whiteface"]);
});

test("the sent-log dedupe holds with the switch off too", async () => {
  const db = fakeDb({ subs: [FAKE_SUB("fan", ["jayton"])] });
  const finals = newFinals("", csv(row("2026-11-13", "Jayton", "Whiteface", 12, 48)));
  const one = collect();
  const two = collect();
  await sendAll({ db, send: one.send, finals });
  await sendAll({ db, send: two.send, finals });
  assert.equal(one.sent.length, 1);
  assert.equal(two.sent.length, 0);
});

test("an event nobody follows is not claimed (a fan who follows later still gets the next-round alert); a muted team gets nothing", async () => {
  const db = fakeDb({ on: true, subs: [FAKE_SUB("muted", ["jayton"], { muted: ["jayton"] })] });
  const ctx = buildContext({ season: "2026", pairings: [SEMI] });
  const one = collect();
  const r = await sendAll({ db, send: one.send, pairings: [SEMI], ctx });
  assert.deepEqual({ sent: r.sent, skipped: r.skipped, claimed: db.sent.size }, { sent: 0, skipped: 1, claimed: 0 });
  db.subs.push(FAKE_SUB("later", ["whiteface"]));
  const two = collect();
  await sendAll({ db, send: two.send, pairings: [SEMI], ctx });
  assert.deepEqual(two.sent.map((x) => x.id), ["later"]);
});

test("a gone browser (404 or 410) is deleted and gets nothing more; any other failure is counted", async () => {
  const db = fakeDb({ on: true, subs: [FAKE_SUB("gone410", ["jayton"]), FAKE_SUB("gone404", ["jayton"]), FAKE_SUB("down", ["jayton"]), FAKE_SUB("ok", ["jayton"])] });
  const calls = [];
  const send = async (s, body) => {
    const id = s.endpoint.split("/").at(-1);
    calls.push(id);
    if (id === "gone410") throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (id === "gone404") throw Object.assign(new Error("gone"), { statusCode: 404 });
    if (id === "down") throw Object.assign(new Error("server"), { statusCode: 503 });
  };
  const finals = newFinals("", csv(row("2026-11-13", "Jayton", "Whiteface", 12, 48)));
  const r = await sendAll({ db, send, finals, kickoffs: [live("jayton", "whiteface")] });
  assert.deepEqual(db.log.deleted.sort(), [FAKE_SUB("gone404", []).endpoint, FAKE_SUB("gone410", []).endpoint]);
  assert.equal(r.removed, 2);
  assert.equal(calls.filter((c) => c === "gone410").length, 1); // deleted on the first failure, the kickoff is not tried
  assert.deepEqual(r.failed, ["fcm.googleapis.com: 503", "fcm.googleapis.com: 503"]);
  assert.deepEqual(db.log.confirmed, [FAKE_SUB("ok", []).endpoint, FAKE_SUB("ok", []).endpoint]);
});

test("a kickoff skips a game the read saw finished; its name comes from the season's files, else the slug title-cased", () => {
  const ctx = buildContext({ season: "2026", playoffs: "", texts: [csv(row("2026-11-06", "Fort Bend Chargers", "Guthrie", 40, 6)), ALIGN] });
  const events = kickoffEvents([live("whiteface", "jayton"), live("fort-bend-chargers", "guthrie", { finished: true }), live("some-new-team", "jayton")], ctx);
  assert.deepEqual(events.map((e) => e.title), ["Jayton v Whiteface has started", "Jayton v Some New Team has started"]);
  assert.deepEqual(events.map((e) => e.key), ["kickoff|2026-11-13|jayton|whiteface", "kickoff|2026-11-13|jayton|some-new-team"]);
  assert.equal(events[0].url, "/scores/2026-11-13-jayton-at-whiteface");
  assert.equal(kickoffEvents([live("a-team", "b-team", { finished: true })], ctx).length, 0);
});

test("a game's page: a playoff game in the bracket's order, a first-round game in its listing's order, any other game by date", () => {
  const ctx = buildContext({
    season: "2026",
    playoffs: pcsv(prow("round-1", "2026-11-06", "Strawn", "Gordon", 45, 0), prow("semifinal", "2026-11-20", "Jayton", "Whiteface", 12, 48)),
    pairings: [{ ...SEMI, home: "Whiteface", away: "Jayton" }],
  });
  const ev = (f) => finalEvent(newFinals("", pcsv(f)).concat([])[0], ctx);
  // The listing says Jayton at Whiteface, the bracket sets Jayton away: the page is the bracket's.
  assert.equal(ev(prow("semifinal", "2026-11-20", "Jayton", "Whiteface", 12, 48)).url, "/scores/2026-semifinal-jayton-at-whiteface");
  assert.equal(ev(prow("semifinal", "2026-11-20", "Whiteface", "Jayton", 48, 12)).url, "/scores/2026-semifinal-jayton-at-whiteface");
  // A first round has no bracket-set order: the listing's.
  assert.equal(ev(prow("round-1", "2026-11-06", "Strawn", "Gordon", 45, 0)).url, "/scores/2026-round-1-gordon-at-strawn");
  // A regular-season game (games.csv) is its own page by date.
  const regular = finalEvent(newFinals("", csv(row("2026-10-23", "Jayton", "Guthrie", 52, 6)))[0], ctx);
  assert.equal(regular.url, "/scores/2026-10-23-guthrie-at-jayton");
  assert.equal(regular.tag, "game:2026-10-23|guthrie|jayton");
  // A game games.csv and playoffs.csv both hold is the playoff page.
  const both = finalEvent(newFinals("", csv(row("2026-11-20", "Jayton", "Whiteface", 12, 48)))[0], ctx);
  assert.equal(both.url, "/scores/2026-semifinal-jayton-at-whiteface");
});

test("a pairing skips a game already played; the last round is always the State Championship", () => {
  const pairings = [
    SEMI,
    { league: "UIL", division: "II", round: "state", home: "Aquilla", away: "Abbott" },
    { league: "TAIAO", division: "2", round: "final", home: "Texas Wind", away: "Valor North Austin" },
    { league: "TAIAO", division: "1", round: "round-2", home: "Lubbock Titans", away: "Fort Bend Chargers" },
  ];
  const playedAlready = pcsv(prow("semifinal", "2026-11-20", "Whiteface", "Jayton", 48, 12));
  const events = pairingEvents(pairings, buildContext({ season: "2026", playoffs: playedAlready, pairings }));
  assert.deepEqual(events.map((e) => e.title), ["Next round: Abbott v Aquilla", "Next round: Valor North Austin v Texas Wind", "Next round: Fort Bend Chargers v Lubbock Titans"]);
  assert.deepEqual(events.map((e) => e.body), ["UIL Division II · State Championship", "TAIAO Division 2 · State Championship", "TAIAO Division 1 · Round 2"]);
  assert.equal(events[0].key, "pairing|2026|UIL|II|state|abbott|aquilla");
  assert.deepEqual([roundLabel("state"), roundLabel("final"), roundLabel("semifinal"), roundLabel("quarterfinal"), roundLabel("round-1"), roundLabel("bi-district")], ["State Championship", "State Championship", "Semifinal", "Quarterfinal", "Round 1", "Bi-district"]);
  // Not yet played: the date is in the body when a listing has it, and left out when not.
  const unplayed = pairingEvents([SEMI], buildContext({ season: "2026", playoffs: SEMI_UNPLAYED, pairings: [SEMI] }));
  assert.equal(unplayed[0].body, "UIL Division I · Semifinal · Fri, Nov 20");
  assert.equal(pairingEvents([SEMI], buildContext({ season: "2026", playoffs: "", pairings: [SEMI] }))[0].body, "UIL Division I · Semifinal");
});

test("a pairing is sent once to the browsers following either team, then never again", async () => {
  const db = fakeDb({ on: true, subs: [FAKE_SUB("a", ["jayton"]), FAKE_SUB("b", ["whiteface"]), FAKE_SUB("c", ["strawn"])] });
  const ctx = buildContext({ season: "2026", playoffs: SEMI_UNPLAYED, pairings: [SEMI] });
  const one = collect();
  await sendAll({ db, send: one.send, pairings: [SEMI], ctx });
  assert.deepEqual(one.sent.map((x) => x.id), ["a", "b"]);
  const two = collect();
  await sendAll({ db, send: two.send, pairings: [SEMI], ctx });
  assert.deepEqual(two.sent, []);
});

test("without push_sent (SQL state 42P01) alerts still go out, with no memory, and the result says so", async () => {
  const db = fakeDb({ on: true, noSentTable: true, subs: [FAKE_SUB("fan", ["jayton"])] });
  const finals = newFinals("", csv(row("2026-11-13", "Jayton", "Whiteface", 12, 48)));
  const one = collect();
  const r = await sendAll({ db, send: one.send, finals });
  const two = collect();
  await sendAll({ db, send: two.send, finals });
  assert.equal(r.dedupeSkipped, true);
  assert.deepEqual([one.sent.length, two.sent.length], [1, 1]);
  assert.equal(await pruneSent(db), 0);
});

test("the sent-log keeps 90 days: older rows are deleted", async () => {
  const db = fakeDb({ sent: new Set(["old-event-key", "new-event-key"]), sentAges: new Map([["old-event-key", 91], ["new-event-key", 3]]) });
  assert.equal(await pruneSent(db), 1);
  assert.deepEqual([...db.sent], ["new-event-key"]);
});

test("the sent-log's real table: migration 0031: claiming a key twice sends it once, the switch starts closed, and a 91-day-old row is pruned", async (t) => {
  let made;
  try {
    made = await accountDb();
  } catch (e) {
    return t.skip(`PGlite is not installed here (${e.code ?? e.message}); CI runs this`);
  }
  const d = made;
  assert.equal((await d.query("select is_on from site_switch where name = 'push_alerts'")).rows[0].is_on, false);
  await d.query("insert into push_subscription (endpoint, p256dh, auth, programs) values ($1, $2, $3, $4)", [endpointOf("one"), "B".repeat(87), "a".repeat(22), ["jayton"]]);
  const finals = newFinals("", csv(row("2026-11-13", "Jayton", "Whiteface", 12, 48)));
  const one = recorder();
  const two = recorder();
  await sendAll({ db: d, send: one.send, finals });
  await sendAll({ db: d, send: two.send, finals });
  assert.deepEqual([one.sent.length, two.sent.length], [1, 0]);
  assert.equal((await d.query("select count(*)::int as n from push_sent where kind = 'final'")).rows[0].n, 1);
  await d.exec("update site_switch set is_on = true where name = 'push_alerts'");
  assert.equal(await alertsOn(d), true);
  await d.exec("update push_sent set sent_at = now() - interval '91 days'");
  assert.equal(await pruneSent(d), 1);
});
