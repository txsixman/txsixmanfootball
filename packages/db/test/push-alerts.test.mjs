import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLive } from "../load.mjs";
import { as, asFan, db, fan, sudo } from "./posts-helpers.mjs";

// The push alerts switch and the sent-log (migration 0031): the dark switch `push_alerts` in site_switch (off until the owner
// flips it, every flip logged, never deleted, as the posts switch is, migration 0024) and push_sent, the log the nightly
// sender claims each event in before it sends, so an event goes out at most once. The table has row-level security, no
// policy and no grant: only the owner (the sender, with the database's own login) can read or write it.
const KICKOFF = "kickoff|2026-11-20|jayton|whiteface";
const FINAL = "final|2026-11-20|jayton|whiteface|12-48";
const PAIRING = "pairing|2026|TAIAO|1|semifinal|jayton|whiteface";

const claim = (d, key, kind) =>
  d.query("insert into push_sent (event_key, kind) values ($1, $2) on conflict (event_key) do nothing returning event_key", [key, kind]);
const count = async (d) => (await sudo(d, "select count(*)::int as n from push_sent")).rows[0].n;

test("a fresh database has the push_alerts switch off, next to the posts switch", async () => {
  const d = await db({ games: false, posts: false });
  const rows = (await d.query("select name, is_on from site_switch order by name")).rows;
  assert.deepEqual(rows.find((r) => r.name === "push_alerts"), { name: "push_alerts", is_on: false });
  assert.deepEqual(rows.find((r) => r.name === "posts"), { name: "posts", is_on: false });
  assert.equal(await count(d), 0);
});

test("anon and signed-in fans cannot read, add, change or delete the sent-log, and cannot change the switch", async () => {
  const d = await db({ games: false, posts: false });
  await claim(d, KICKOFF, "kickoff"); // the owner's row, so every refusal below is the grant and not an empty table
  const who = await fan(d, "Push Fan");
  for (const role of ["anon", "authenticated"]) {
    if (role === "anon") await as(d, "anon");
    else await asFan(d, who);
    await assert.rejects(d.query("select * from push_sent"), /permission denied/);
    await assert.rejects(d.query("insert into push_sent (event_key, kind) values ($1, 'final')", [FINAL]), /permission denied/);
    await assert.rejects(d.query("update push_sent set kind = 'final'"), /permission denied/);
    await assert.rejects(d.query("delete from push_sent"), /permission denied/);
    await assert.rejects(d.query("select * from site_switch where name = 'push_alerts'"), /permission denied/);
    await assert.rejects(d.query("update site_switch set is_on = true where name = 'push_alerts'"), /permission denied/);
  }
  assert.deepEqual((await sudo(d, "select event_key from push_sent")).rows, [{ event_key: KICKOFF }]);
  assert.equal((await sudo(d, "select is_on from site_switch where name = 'push_alerts'")).rows[0].is_on, false);
});

test("the owner claims an event once: the same key a second time does nothing", async () => {
  const d = await db({ games: false, posts: false });
  const first = await claim(d, KICKOFF, "kickoff");
  assert.deepEqual(first.rows, [{ event_key: KICKOFF }]); // claimed: this run sends it
  const again = await claim(d, KICKOFF, "kickoff");
  assert.deepEqual(again.rows, []); // already claimed: no send
  assert.equal(await count(d), 1);
  // The three kinds, and a corrected score is a new final (the score is part of the key).
  await claim(d, FINAL, "final");
  await claim(d, PAIRING, "pairing");
  assert.equal((await claim(d, "final|2026-11-20|jayton|whiteface|12-49", "final")).rows.length, 1);
  assert.equal(await count(d), 4);
  const row = (await d.query("select kind, sent_at is not null as stamped, sent_at <= now() as past from push_sent where event_key = $1", [KICKOFF])).rows[0];
  assert.deepEqual(row, { kind: "kickoff", stamped: true, past: true });
});

test("a kind outside kickoff, final and pairing is refused, and so is a key that is too short or too long", async () => {
  const d = await db({ games: false, posts: false });
  await assert.rejects(claim(d, KICKOFF, "reminder"), /check constraint/);
  await assert.rejects(claim(d, KICKOFF, ""), /check constraint/);
  await assert.rejects(claim(d, "short", "final"), /check constraint/); // under 10 characters
  await assert.rejects(claim(d, `final|${"a".repeat(300)}`, "final"), /check constraint/); // over 300
  await assert.rejects(d.query("insert into push_sent (event_key, kind) values (null, 'final')"), /not-null|null value/);
  await assert.rejects(d.query("insert into push_sent (event_key, kind) values ($1, null)", [KICKOFF]), /not-null|null value/);
  for (const kind of ["kickoff", "final", "pairing"]) assert.equal((await claim(d, `${kind}|2026-11-20|a|b`, kind)).rows.length, 1);
  assert.equal(await count(d), 3);
});

test("the owner can prune the log (the sender deletes rows older than 90 days)", async () => {
  const d = await db({ games: false, posts: false });
  await claim(d, KICKOFF, "kickoff");
  await claim(d, FINAL, "final");
  await d.query("update push_sent set sent_at = now() - interval '91 days' where event_key = $1", [KICKOFF]);
  const gone = await d.query("delete from push_sent where sent_at < now() - interval '90 days' returning event_key");
  assert.deepEqual(gone.rows, [{ event_key: KICKOFF }]);
  assert.deepEqual((await d.query("select event_key from push_sent")).rows, [{ event_key: FINAL }]);
});

test("the sent-log has row-level security on, and no policy and no grant for the API roles", async () => {
  const d = await db({ games: false, posts: false });
  assert.equal((await d.query("select relrowsecurity from pg_class where relname = 'push_sent' and relkind = 'r'")).rows[0].relrowsecurity, true);
  assert.deepEqual((await d.query("select policyname from pg_policies where tablename = 'push_sent'")).rows, []);
  for (const role of ["anon", "authenticated"]) {
    const g = await d.query(
      "select p as privilege, has_table_privilege($1, 'push_sent', p) as held from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p",
      [role],
    );
    assert.deepEqual(g.rows.filter((r) => r.held), [], role);
  }
});

test("flipping push_alerts writes an audit row each way, and nothing else on the switch table does", async () => {
  const d = await db({ games: false, posts: false });
  await d.query("update site_switch set is_on = true where name = 'push_alerts'");
  await d.query("update site_switch set is_on = true where name = 'push_alerts'"); // no change: no row
  await d.query("update site_switch set is_on = false where name = 'push_alerts'");
  const log = await d.query("select before, after from audit_log where entity = 'site_switch' order by id");
  assert.deepEqual(log.rows, [
    { before: { name: "push_alerts", on: false }, after: { name: "push_alerts", on: true } },
    { before: { name: "push_alerts", on: true }, after: { name: "push_alerts", on: false } },
  ]);
  // The posts switch is a separate row: flipping one leaves the other.
  assert.equal((await d.query("select is_on from site_switch where name = 'posts'")).rows[0].is_on, false);
});

test("the push_alerts row cannot be deleted, the table cannot be emptied, and the live check passes", async () => {
  const d = await db({ games: false, posts: false });
  await assert.rejects(d.query("delete from site_switch where name = 'push_alerts'"), /cannot be changed/);
  await assert.rejects(d.query("truncate site_switch"), /cannot be changed/);
  assert.equal((await d.query("select count(*)::int as n from site_switch where name = 'push_alerts'")).rows[0].n, 1);
  assert.deepEqual(await checkLive(d), []);
});
