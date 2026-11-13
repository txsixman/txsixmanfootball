// Invented fixtures only: no test calls the feed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createClient, isLive, liveRowsFromItems, mergeLive, periodLabel, sameSchool, teamId, teamMaps, teamSlugOf, USER_AGENT } from "./davecampbells.mjs";

const json = (status, body) => ({ status, json: async () => body });

test("the client asks only public feed paths, with our agent, one request per gap, no redirects", async () => {
  const calls = [];
  const waits = [];
  const client = createClient({
    fetchImpl: async (url, init) => (calls.push({ url, init }), json(200, { success: true, data: { teamId: "019ff136-fb13-7f5a-9e95-c8a10eadfcfa", schoolName: "Lark" } })),
    sleep: async (ms) => waits.push(ms),
  });
  assert.equal(await teamId(client, "lark-owls", "s1"), "019ff136-fb13-7f5a-9e95-c8a10eadfcfa");
  await client.getData("/api/public/teams/x");
  assert.equal(calls[0].url, "https://www.davecampbells.com/api/public/teams/lark-owls?seasonId=s1");
  assert.equal(calls[0].init.headers["user-agent"], USER_AGENT);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 2000 && waits[0] <= 2500);
  await assert.rejects(client.getData("/team/lark-owls"), /not a public feed path/);
});

test("a 403 or 429 stops the read with no retry; other errors and bad bodies give null", async () => {
  for (const status of [403, 429]) {
    let n = 0;
    const client = createClient({ fetchImpl: async () => (n++, json(status, {})), gapMs: 0 });
    await assert.rejects(client.getData("/api/public/teams/x"), new RegExp(`HTTP ${status}`));
    assert.equal(n, 1);
  }
  const answers = [json(500, {}), json(301, {}), json(200, { success: false, data: { id: "x" } }), json(200, { success: true, data: { id: "not-a-uuid" } })];
  const client = createClient({ fetchImpl: async () => answers.shift(), gapMs: 0 });
  assert.equal(await client.getData("/api/public/a"), null);
  assert.equal(await client.getData("/api/public/b"), null);
  assert.equal(await teamId(client, "x", "s"), null);
  assert.equal(await teamId(client, "x", "s"), null);
});

test("periods become Q1 to Q4, Halftime or OT, never a clock", () => {
  const cases = [[1, "Q1"], [4, "Q4"], [5, "OT"], [0, null], ["2", "Q2"], ["Q3", "Q3"], ["3rd", "Q3"], ["4th Quarter", "Q4"], ["Half", "Halftime"], ["HALFTIME", "Halftime"], ["OT", "OT"], ["Overtime 2", "OT"], ["Final", null], ["Q2 4:31", null], [null, null]];
  for (const [period, want] of cases) assert.equal(periodLabel({ period }), want, String(period));
  for (const label of cases.map(([p]) => periodLabel({ period: p })).filter(Boolean)) assert.match(label, /^[A-Za-z0-9 ]{1,12}$/);
});

test("live means live, in progress or halftime", () => {
  for (const status of ["Live", "IN_PROGRESS", "in progress", "Halftime"]) assert.ok(isLive({ status }), status);
  for (const status of ["Upcoming", "Finished", "Final", ""]) assert.ok(!isLive({ status }), status);
  assert.ok(isLive({ summary: { status: "Live" } }));
});

test("team slugs come from team addresses only", () => {
  assert.equal(teamSlugOf("https://www.davecampbells.com/team/lark-owls"), "lark-owls");
  assert.equal(teamSlugOf("/team/lark-owls/?x=1"), "lark-owls");
  assert.equal(teamSlugOf("https://example.org/teams/lark-owls"), null);
  assert.equal(teamSlugOf("lark-owls"), "lark-owls");
  assert.equal(teamSlugOf("Lark Owls"), null);
  assert.equal(teamSlugOf(undefined), null);
});

test("the team map keeps clean slugs only and reads both ways", () => {
  const { theirs, ours } = teamMaps({ lark: "lark-owls", "bad slug": "x", wren: "Wren" });
  assert.deepEqual([...theirs], [["lark", "lark-owls"]]);
  assert.equal(ours.get("lark-owls"), "lark");
});

test("the committed team map is clean, one to one, and sorted", () => {
  const raw = JSON.parse(readFileSync(new URL("./davecampbells-teams.json", import.meta.url), "utf8"));
  const { theirs, ours } = teamMaps(raw);
  assert.equal(theirs.size, Object.keys(raw).length);
  assert.equal(ours.size, theirs.size);
  assert.deepEqual(Object.keys(raw), Object.keys(raw).sort());
});

// Invented schools: Lark (home in our bracket) and Wren; Finch and Heron are another game.
const ours = new Map([["lark-owls", "lark"], ["wren-wrens", "wren"], ["finch-falcons", "finch"], ["heron-herons", "heron"]]);
const due = [
  { game_date: "2026-11-13", home: "Lark", away: "Wren", home_score: "" },
  { game_date: "2026-11-13", home: "Finch", away: "Heron", home_score: "" },
];
const item = (over = {}) => ({
  scheduledKickoff: "2026-11-14T01:00:00Z", // 7 PM Central on Nov 13
  status: "Live",
  pointSpread: -7,
  winner: "HOME",
  summary: { period: 2, homeScore: 20, awayScore: 14 },
  participants: [
    { participantType: "HOME", websiteUrl: "https://www.davecampbells.com/team/wren-wrens", score: 20 },
    { participantType: "AWAY", websiteUrl: "https://www.davecampbells.com/team/lark-owls", score: 14 },
  ],
  ...over,
});
const readAt = new Date("2026-11-14T02:00:00Z");

test("a live game becomes one row in the bracket row's own home and away order, with only the fields the site reads", () => {
  const rows = liveRowsFromItems([item(), item()], { date: "2026-11-13", due, ours, readAt });
  assert.deepEqual(rows, [{ game_key: "2026-11-13|lark|wren", home: "lark", away: "wren", home_score: 14, away_score: 20, period: "Q2", read_at: "2026-11-14T02:00:00.000Z" }]);
});

test("skips games not live, not tonight, not due, unmapped, forfeited, out of range, or 0-0 before kickoff", () => {
  const opts = { date: "2026-11-13", due, ours, readAt };
  const [h, a] = item().participants;
  const skipped = [
    item({ status: "Upcoming" }),
    item({ status: "Finished" }),
    item({ scheduledKickoff: "2026-11-14T07:00:00Z" }), // 1 AM Central on Nov 14
    item({ scheduledKickoff: "not a date" }),
    item({ participants: [h, { ...a, websiteUrl: "https://www.davecampbells.com/team/robin-robins" }] }),
    item({ participants: [h, { ...a, websiteUrl: "https://www.davecampbells.com/team/heron-herons" }] }), // a real pair, but not tonight's bracket game
    item({ participants: [{ ...h, forfeited: true }, a] }),
    item({ participants: [{ ...h, score: 201 }, a] }),
    item({ participants: [{ ...h, score: -1 }, a] }),
    item({ participants: [{ ...h, score: 0 }, { ...a, score: 0 }], summary: { period: null } }),
    item({ participants: [h] }),
  ];
  for (const it of skipped) assert.deepEqual(liveRowsFromItems([it], opts), [], JSON.stringify(it));
  // 0-0 with a period is a game under way.
  assert.equal(liveRowsFromItems([item({ participants: [{ ...h, score: 0 }, { ...a, score: 0 }], summary: { period: 1 } })], opts)[0].period, "Q1");
  // The summary's scores stand in when a participant has none.
  assert.equal(liveRowsFromItems([item({ participants: [{ ...h, score: undefined }, { ...a, score: undefined }] })], opts)[0].away_score, 20);
});

test("with one team mapped, the other is tonight's bracket opponent, only when the school name matches", () => {
  const opts = { date: "2026-11-13", due, ours: new Map([["lark-owls", "lark"]]), readAt };
  const [h, a] = item().participants;
  const unmapped = (schoolName) => ({ ...h, websiteUrl: "https://www.davecampbells.com/team/wren-something", schoolName });
  for (const name of ["Wren", "WREN"]) assert.equal(liveRowsFromItems([item({ participants: [unmapped(name), a] })], opts)[0]?.game_key, "2026-11-13|lark|wren", name);
  for (const name of ["Wrenfield", "Heron", "", undefined]) assert.deepEqual(liveRowsFromItems([item({ participants: [unmapped(name), a] })], opts), [], String(name));
  // Neither team mapped: nothing.
  assert.deepEqual(liveRowsFromItems([item()], { ...opts, ours: new Map() }), []);
});

test("a school name matches our slug exactly or with a town added on either side", () => {
  assert.ok(sameSchool("Lark", "lark"));
  assert.ok(sameSchool("Lark", "lark-west"));
  assert.ok(sameSchool("Lark West", "lark"));
  assert.ok(!sameSchool("Larkin", "lark"));
  assert.ok(!sameSchool("", "lark"));
});

test("merging keeps one row a game: the higher total, then the one with a period", () => {
  const row = (key, hs, as, period) => ({ game_key: key, home: "a", away: "b", home_score: hs, away_score: as, period, read_at: "t" });
  const mp = [row("2026-11-13|a|b", 14, 7, "Q2"), row("2026-11-13|c|d", 6, 0, null)];
  const dc = [row("2026-11-13|a|b", 14, 14, "Q3"), row("2026-11-13|c|d", 6, 0, "Q1"), row("2026-11-13|e|f", 0, 8, "Q1")];
  assert.deepEqual(mergeLive(mp, dc).map((r) => [r.game_key, r.home_score + r.away_score, r.period]), [
    ["2026-11-13|a|b", 28, "Q3"],
    ["2026-11-13|c|d", 6, "Q1"],
    ["2026-11-13|e|f", 8, "Q1"],
  ]);
  // An older, lower read never replaces a newer one.
  assert.deepEqual(mergeLive(dc, [row("2026-11-13|a|b", 7, 7, "Q2")])[0].period, "Q3");
  assert.deepEqual(mergeLive([], []), []);
});
