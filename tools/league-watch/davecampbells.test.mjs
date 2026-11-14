// Invented fixtures only: no test calls the feed.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bracketFields, positionProblems, DETAIL_COLUMNS, kickoffRows, mergeKickoffs, missingDetails, opponentRows, placeFields } from "./davecampbells.mjs";
import { allFinishedGames, asOf, footballSeasons, HISTORY_COLUMNS, historyCsv, historyRows, knownPrograms, programByName, checkFinals, noAgreement, NO_AGREEMENT_MIN, raise, seasonIdOwed, createClient, daysBefore, finalOf, finalsSummary, gamesToCheck, isFinal, isForfeit, isLate, isLive, liveRowsFromItems, matchGames, mergeLive, periodByMinutes, periodLabel, readReport, REPORT_COLUMNS, reportCsv, sameSchool, TEAMS_PER_RUN, teamId, teamMaps, teamSlugOf, USER_AGENT, verdictOf } from "./davecampbells.mjs";

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

test("periods become Q1 to Q4, Halftime or OT in words, never a clock; a number above 4 is not OT", () => {
  const cases = [[1, "Q1"], [2, "Q2"], [3, "Q3"], [4, "Q4"], [5, null], [6, null], [0, null], ["2", "Q2"], ["Q3", "Q3"], ["3rd", "Q3"], ["4th Quarter", "Q4"], ["Half", "Halftime"], ["HALFTIME", "Halftime"], ["OT", "OT"], ["Overtime 2", "OT"], ["Final", null], ["Q2 4:31", null], [null, null]];
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
  assert.deepEqual(rows, [{ game_key: "2026-11-13|lark|wren", home: "lark", away: "wren", home_score: 14, away_score: 20, period: null, read_at: "2026-11-14T02:00:00.000Z" }]);
});

test("a game the feed calls finished keeps its last score, marked finished, with no period (ADR 0042)", () => {
  const opts = { date: "2026-11-13", due, ours, readAt };
  for (const status of ["Finished", "Final", "Completed"]) {
    assert.deepEqual(liveRowsFromItems([item({ status, summary: { period: 4, homeScore: 20, awayScore: 14 } })], opts), [
      { game_key: "2026-11-13|lark|wren", home: "lark", away: "wren", home_score: 14, away_score: 20, period: null, finished: true, late: true, read_at: "2026-11-14T02:00:00.000Z" },
    ], status); // period 4: late too (ADR 0043)
  }
  // A live listing of the same game comes first in the answer: the row says under way (no finished field).
  assert.equal(liveRowsFromItems([item(), item({ status: "Finished" })], opts)[0].finished, undefined);
});

test("skips games not live or finished, not tonight, not due, unmapped, forfeited, out of range, 0-0 before kickoff or a finished 0-0", () => {
  const opts = { date: "2026-11-13", due, ours, readAt };
  const [h, a] = item().participants;
  const skipped = [
    item({ status: "Upcoming" }),
    item({ status: "Forfeit" }),
    item({ status: "Double Forfeit" }),
    item({ status: "Finished", participants: [{ ...item().participants[0], forfeited: true }, item().participants[1]] }),
    item({ status: "Final", participants: [{ ...item().participants[0], score: 0 }, { ...item().participants[1], score: 0 }] }),
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
  // 0-0 is skipped even with a period: the feed's period is not trusted to say kickoff has passed (ADR 0042).
  assert.deepEqual(liveRowsFromItems([item({ participants: [{ ...h, score: 0 }, { ...a, score: 0 }], summary: { period: 1 } })], opts), []);
  // No row carries the feed's period, whatever it says.
  for (const period of [1, 4, 5, "Q3", "Halftime", "OT"]) assert.equal(liveRowsFromItems([item({ summary: { period, homeScore: 20, awayScore: 14 } })], opts)[0].period, null, String(period));
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

// ---- Finals cross-check (ADR 0026). Invented schools and invented feed answers only. ----

const PLAYOFFS = [
  "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes",
  "UIL,1,bi-district,2026-11-12,Lark,Wren,,46,0,unknown,,https://example.invalid/a,",
  "UIL,1,bi-district,2026-11-12,Finch,Heron,,30,28,unknown,,https://example.invalid/b,",
  "UIL,1,bi-district,2026-11-13,Robin,Jay,,52,6,unknown,,https://example.invalid/c,",
  "UIL,1,bi-district,2026-11-13,Kite,Owl,,,,,,https://example.invalid/d,", // not played yet
  "UIL,1,bi-district,2026-11-06,Lark,Owl,,40,7,unknown,,https://example.invalid/e,", // older than three game nights
  "UIL,1,area,2026-11-13,Dove,Crow,,1,0,forfeit,,https://example.invalid/f,", // a forfeit at MaxPreps
].join("\n");
const theirsMap = new Map([["lark", "lark-owls"], ["wren", "wren-wrens"], ["finch", "finch-falcons"], ["robin", "robin-robins"]]);
const oursMap = new Map([...theirsMap].map(([o, t]) => [t, o]));
const finalItem = (home, away, hScore, aScore, over = {}) => ({
  scheduledKickoff: "2026-11-13T01:00:00Z", // 7 PM Central, Nov 12
  status: "Final",
  winner: "HOME",
  pointSpread: -10,
  participants: [
    { participantType: "HOME", websiteUrl: `https://www.davecampbells.com/team/${home}`, schoolName: home.split("-")[0], score: hScore },
    { participantType: "AWAY", websiteUrl: `https://www.davecampbells.com/team/${away}`, schoolName: away.split("-")[0], score: aScore },
  ],
  ...over,
});

test("finished means Final, Completed or Finished; a forfeit by status or flag", () => {
  for (const s of ["Final", "FINAL", "completed", "Finished"]) assert.ok(isFinal({ status: s }), s);
  for (const s of ["Live", "Upcoming", "Forfeit", "", undefined]) assert.ok(!isFinal({ status: s }), String(s));
  assert.ok(isForfeit({ status: "Double Forfeit" }));
  assert.ok(isForfeit({ status: "Final", participants: [{ forfeited: true }] }));
  assert.ok(!isForfeit({ status: "Final", participants: [{ forfeited: false }] }));
});

test("the games to check: scored at MaxPreps, not a forfeit, the last three game nights, not settled", () => {
  assert.equal(daysBefore("2026-11-13", 3), "2026-11-10");
  assert.equal(daysBefore("2026-12-01", 3), "2026-11-28");
  const keys = (rows) => rows.map((r) => `${r.game_date} ${r.home}`);
  assert.deepEqual(keys(gamesToCheck(PLAYOFFS, new Map(), "2026-11-13")), ["2026-11-12 Finch", "2026-11-12 Lark", "2026-11-13 Robin"]);
  // An agree for the same score is settled; a disagree, a missing final or a corrected score is checked again.
  const report = readReport([
    REPORT_COLUMNS.join(","),
    "2026-11-12,lark,wren,46,0,46,0,agree,t,t",
    "2026-11-12,finch,heron,30,28,30,21,disagree,t,t",
    "2026-11-13,robin,jay,50,6,50,6,agree,t,t",
  ].join("\n"));
  assert.deepEqual(keys(gamesToCheck(PLAYOFFS, report, "2026-11-13")), ["2026-11-12 Finch", "2026-11-13 Robin"]);
});

test("a feed final is set in the bracket row's order and judged against MaxPreps", () => {
  const rows = [{ game_date: "2026-11-12", home: "Lark", away: "Wren", home_score: "46", away_score: "0" }];
  // The feed has Wren at home: the scores flip into Lark's order.
  const [m] = matchGames([finalItem("wren-wrens", "lark-owls", 0, 46)], { rows, ours: oursMap });
  assert.deepEqual(finalOf(m), { home: 46, away: 0 });
  assert.equal(verdictOf(rows[0], finalOf(m)), "agree");
  assert.equal(verdictOf(rows[0], { home: 46, away: 6 }), "disagree");
  assert.equal(verdictOf(rows[0], null), "dc-missing");
  assert.equal(verdictOf(rows[0], { forfeit: true }), "dc-forfeit");
  const [live] = matchGames([finalItem("wren-wrens", "lark-owls", 0, 46, { status: "Live" })], { rows, ours: oursMap });
  assert.equal(finalOf(live), null);
  const [out] = matchGames([finalItem("wren-wrens", "lark-owls", 0, 246)], { rows, ours: oursMap });
  assert.equal(finalOf(out), null);
  // Matching works on any night, not only tonight's.
  assert.equal(matchGames([finalItem("wren-wrens", "lark-owls", 0, 46, { scheduledKickoff: "2026-11-14T01:00:00Z" })], { rows, ours: oursMap }).length, 0);
});

/** A fake feed: team ids for the listed teams, each team's finished games, and every request recorded. */
function fakeFeed(lists, { idsKnown = Object.keys(lists), stopOn } = {}) {
  const asked = [];
  const client = {
    async getData(p) {
      asked.push(p);
      if (stopOn && p.includes(stopOn)) throw new Error("HTTP 429 from the feed: stopping the read (ADR 0025)");
      const team = /\/teams\/([a-z0-9-]+)\?/.exec(p)?.[1];
      if (team) return idsKnown.includes(team) ? { teamId: `00000000-0000-4000-8000-${String(idsKnown.indexOf(team)).padStart(12, "0")}` } : { id: null };
      const id = /teamId=([0-9a-f-]+)/.exec(p)[1];
      const name = idsKnown[Number(id.slice(-12))];
      return { items: lists[name] ?? [] };
    },
  };
  return { client, asked };
}

const run = (feed, report = new Map(), ids = {}, warn = () => {}) =>
  checkFinals({ playoffsText: PLAYOFFS, report, ids, date: "2026-11-13", seasonId: "s1", client: feed.client, theirs: theirsMap, ours: oursMap, now: new Date("2026-11-14T03:00:00Z"), warn });

test("a check asks one mapped team a game, records a verdict for every game, and caches team ids", async () => {
  const feed = fakeFeed({
    "lark-owls": [finalItem("wren-wrens", "lark-owls", 0, 46)],
    "finch-falcons": [finalItem("finch-falcons", "heron-herons", 30, 21)], // Heron is not mapped: matched by its name
    "robin-robins": [], // no final there yet
  });
  const r = await run(feed);
  assert.deepEqual(r.counts, { agree: 1, disagree: 1, "dc-missing": 1, "dc-forfeit": 0, unmatched: 0 });
  const rows = [...r.report.values()].map((x) => `${x.game_date} ${x.home}-${x.away} ${x.mp_home}-${x.mp_away} ${x.dc_home}-${x.dc_away} ${x.verdict}`);
  assert.deepEqual(rows.sort(), ["2026-11-12 finch-heron 30-28 30-21 disagree", "2026-11-12 lark-wren 46-0 46-0 agree", "2026-11-13 robin-jay 52-6 - dc-missing"]);
  // Two requests a team (id, then games); every path is a public feed path asking for finished games, newest first.
  assert.equal(r.requests, 6);
  assert.ok(feed.asked.every((p) => p.startsWith("/api/public/")));
  assert.ok(feed.asked.filter((p) => p.includes("game-schedules")).every((p) => p.includes("status=Final%2CCompleted%2CFinished%2CForfeit%2CDouble%20Forfeit&sort=NEWEST")));
  assert.equal(Object.keys(r.ids).length, 3);
  // The next run: the agree is settled, the ids are cached, so one request a team that still has a game to check.
  const again = await run(fakeFeed({ "finch-falcons": [], "robin-robins": [] }), r.report, r.ids);
  assert.equal(again.games, 2);
  assert.equal(again.requests, 2);
  const lark = [...again.report.values()].find((x) => x.home === "lark");
  assert.equal(lark.last_checked, "2026-11-14T03:00:00.000Z");
});

test("a feed forfeit is skipped and settled; an unknown status is dc-missing and its shape logged once, names only", async () => {
  const warnings = [];
  const feed = fakeFeed({
    "lark-owls": [finalItem("wren-wrens", "lark-owls", 0, 46, { status: "Forfeit" })],
    "finch-falcons": [finalItem("finch-falcons", "heron-herons", 30, 28, { status: "Postponed" })],
    "robin-robins": [finalItem("robin-robins", "jay-jays", 52, 6, { status: "Suspended", scheduledKickoff: "2026-11-14T01:00:00Z" })],
  });
  const r = await run(feed, new Map(), {}, (w) => warnings.push(w));
  assert.equal(r.counts["dc-forfeit"], 1);
  assert.equal(r.counts["dc-missing"], 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\{scheduledKickoff, status, winner, pointSpread, participants:\[/);
  assert.ok(!/Postponed|finch|30/.test(warnings[0]), warnings[0]);
  // A settled forfeit is not asked again.
  assert.ok(!gamesToCheck(PLAYOFFS, r.report, "2026-11-13").some((g) => g.home === "Lark"));
});

test("at most TEAMS_PER_RUN teams a run; the rest wait, oldest first", async () => {
  const many = [PLAYOFFS.split("\n")[0]];
  const theirs = new Map();
  for (let i = 0; i < TEAMS_PER_RUN + 3; i++) {
    many.push(`UIL,1,bi-district,2026-11-1${i < 5 ? 2 : 3},T${i},U${i},,20,10,unknown,,,`);
    theirs.set(`t${i}`, `t${i}-team`);
  }
  const feed = fakeFeed({}, { idsKnown: [...theirs.values()] });
  const r = await checkFinals({ playoffsText: many.join("\n"), report: new Map(), ids: {}, date: "2026-11-13", seasonId: "s1", client: feed.client, theirs, ours: new Map([...theirs].map(([o, t]) => [t, o])), now: new Date() });
  assert.equal(r.teams, TEAMS_PER_RUN);
  assert.equal(r.left, 3);
  assert.equal(r.report.size, TEAMS_PER_RUN);
  assert.ok([...r.report.values()].every((x) => x.verdict === "dc-missing"));
});

test("a 403 or 429 stops the check: it throws, so nothing is written", async () => {
  const feed = fakeFeed({ "lark-owls": [] }, { stopOn: "finch-falcons" });
  await assert.rejects(run(feed), /HTTP 429/);
});

test("the report round-trips through CSV, one row a game, sorted; the summary names no team and no score", async () => {
  const r = await run(fakeFeed({ "lark-owls": [finalItem("wren-wrens", "lark-owls", 0, 46)], "finch-falcons": [], "robin-robins": [] }));
  const csv = reportCsv(r.report);
  assert.equal(csv.split("\n")[0], REPORT_COLUMNS.join(","));
  assert.deepEqual(readReport(csv), r.report);
  assert.equal(reportCsv(readReport(csv)), csv);
  const line = finalsSummary(r);
  assert.match(line, /^Finals cross-check: 3 games to check, 3 teams asked \(6 requests\); 1 agree, 0 disagree, 2 no final there yet, 0 forfeits skipped, 0 unmatched\.$/);
  for (const word of ["lark", "wren", "finch", "heron", "robin", "jay", "46"]) assert.ok(!line.toLowerCase().includes(word), word);
});

test("a game with no mapped team, or a team the feed has no id for, is unmatched", async () => {
  const text = [PLAYOFFS.split("\n")[0], "UIL,1,bi-district,2026-11-12,Kite,Owl,,20,14,unknown,,,", "UIL,1,bi-district,2026-11-12,Lark,Wren,,46,0,unknown,,,"].join("\n");
  const feed = fakeFeed({}, { idsKnown: [] });
  const r = await checkFinals({ playoffsText: text, report: new Map(), ids: {}, date: "2026-11-13", seasonId: "s1", client: feed.client, theirs: theirsMap, ours: oursMap, now: new Date() });
  assert.equal(r.counts.unmatched, 2);
  // Kite costs no request; Lark costs one (its id), and no games request without an id.
  assert.deepEqual(feed.asked, ["/api/public/teams/lark-owls?seasonId=s1"]);
});

test("problems for the robot-alert issue: a season id owed from August, no agreement among 10 or more past games", () => {
  assert.equal(seasonIdOwed("2027-07-31"), false);
  assert.equal(seasonIdOwed("2027-08-01"), true);
  assert.equal(seasonIdOwed("2027-12-05"), true);
  const rows = (n, verdict, date = "2026-11-12") =>
    Array.from({ length: n }, (_, i) => ({ game_date: date, home: `h${i}${verdict}${date}`, away: `a${i}`, verdict }));
  const rep = (...lists) => new Map(lists.flat().map((r) => [`${r.game_date}|${r.home}|${r.away}`, r]));
  assert.equal(noAgreement(rep(rows(NO_AGREEMENT_MIN, "dc-missing")), "2026-11-13"), true);
  assert.equal(noAgreement(rep(rows(NO_AGREEMENT_MIN - 1, "disagree")), "2026-11-13"), false, "too few");
  assert.equal(noAgreement(rep(rows(NO_AGREEMENT_MIN, "disagree"), rows(1, "agree")), "2026-11-13"), false);
  assert.equal(noAgreement(rep(rows(NO_AGREEMENT_MIN, "unmatched")), "2026-11-13"), false, "unmatched is not checked");
  assert.equal(noAgreement(rep(rows(NO_AGREEMENT_MIN, "dc-missing", "2026-11-13")), "2026-11-13"), false, "tonight is left out");
  assert.equal(noAgreement(rep(rows(NO_AGREEMENT_MIN, "dc-missing", "2026-11-01")), "2026-11-13"), false, "older than the window");
  // raise writes one word a line to the file, and nothing without one.
  const file = path.join(mkdtempSync(path.join(tmpdir(), "reasons-")), "r.txt");
  raise("second-source-refused", file);
  raise("second-source-no-season", file);
  assert.equal(readFileSync(file, "utf8"), "second-source-refused\nsecond-source-no-season\n");
  raise("x", undefined);
});

// ---- Past seasons (ADR 0032) ----

test("the season list gives high school boys football ids by year, nothing else", () => {
  const ids = footballSeasons([
    { year: 2019, seasonId: "s-2019", sportName: "Football", gender: "BOYS", schoolTypeName: "High School" },
    { year: 2019, seasonId: "s-jv", sportName: "JV Football", gender: "BOYS", schoolTypeName: "High School" },
    { year: 2019, seasonId: "s-college", sportName: "Football", gender: "BOYS", schoolTypeName: "College" },
    { year: 2019, seasonId: "s-ball", sportName: "Baseball", gender: "BOYS", schoolTypeName: "High School" },
  ]);
  assert.deepEqual([...ids], [[2019, "s-2019"]]);
  assert.equal(footballSeasons(null).size, 0);
});

test("a team's finished games are read page by page, and a repeated page stops the read", async () => {
  const pages = [
    { items: [{ n: 1 }], page: 0, totalPages: 2 },
    { items: [{ n: 2 }], page: 1, totalPages: 2 },
  ];
  const asked = [];
  const client = { getData: async (p) => (asked.push(p), pages.shift()) };
  assert.deepEqual(await allFinishedGames(client, "s1", "t1"), [{ n: 1 }, { n: 2 }]);
  assert.equal(asked.length, 2);
  assert.match(asked[1], /&page=1$/);
  const warned = [];
  const stuck = { getData: async () => ({ items: [{ n: 1 }], page: 0, totalPages: 3 }) };
  assert.deepEqual(await allFinishedGames(stuck, "s1", "t1", (w) => warned.push(w)), [{ n: 1 }]);
  assert.match(warned[0], /answered as page 0/);
});

const past = (over = {}) => ({
  scheduledKickoff: "2019-09-07T00:30:00Z", // 7:30 PM Central on Sep 6
  status: "Final",
  pointSpread: -7,
  winner: "HOME",
  rank: 3,
  participants: [
    { participantType: "HOME", websiteUrl: "https://www.davecampbells.com/team/wren-wrens", schoolName: "Wren", score: 52 },
    { participantType: "AWAY", websiteUrl: "https://www.davecampbells.com/team/finch-finches", schoolName: "Finch", score: 6 },
  ],
  ...over,
});
const pastOurs = new Map([["wren-wrens", "wren"]]);
const slugs = new Set(["wren", "finch", "old-finch", "lark-west"]);

test("a past final is one row a game: date, our two programs, scores and forfeit flags, and no other field", () => {
  const { rows, skipped } = historyRows([past(), past()], { ours: pastOurs, slugs, renamed: new Map(), season: 2019 });
  assert.deepEqual(rows, [{ game_date: "2019-09-06", home: "wren", away: "finch", home_score: "52", away_score: "6", home_forfeit: "false", away_forfeit: "false" }]);
  assert.deepEqual(Object.keys(rows[0]), HISTORY_COLUMNS);
  assert.equal(skipped.notOurs, 0);
  assert.equal(historyCsv(rows), "game_date,home,away,home_score,away_score,home_forfeit,away_forfeit\n2019-09-06,wren,finch,52,6,false,false\n");
});

test("a team neither mapped nor one of ours by name is skipped and counted, as is an unfinished game", () => {
  const eleven = past({ participants: [past().participants[0], { participantType: "AWAY", websiteUrl: "x/team/big-city-bulldogs", schoolName: "Big City", score: 40 }] });
  const { rows, skipped } = historyRows([eleven, past({ status: "Scheduled" })], { ours: pastOurs, slugs, renamed: new Map(), season: 2019 });
  assert.deepEqual(rows, []);
  assert.deepEqual(skipped, { notFinished: 1, notOurs: 1, noDate: 0, forfeitUnflagged: 0 });
});

test("an old name: a program renamed after the season is written under the name it had then", () => {
  const renamed = new Map([["finch", [{ from: "old-finch", season: 2021 }]]]);
  assert.equal(asOf("finch", 2019, renamed), "old-finch");
  assert.equal(asOf("finch", 2021, renamed), "finch");
  const { rows } = historyRows([past()], { ours: pastOurs, slugs, renamed, season: 2019 });
  assert.equal(rows[0].away, "old-finch");
});

test("a school name that could be two of our programs is not guessed", () => {
  assert.equal(programByName("Lark", new Set(["lark-west", "lark-east"])), null);
  assert.equal(programByName("Lark", new Set(["lark-west", "wren"]), "west-lark-owls"), "lark-west");
});

test("a same-named school in another town is not ours: our slug's town must be in the feed's team slug", () => {
  const ours = new Set(["community-christian-mineral-wells", "wren"]);
  assert.equal(programByName("Community Christian", ours, "orange-community-christian-lions"), null);
  assert.equal(programByName("Community Christian", ours, "mineral-wells-community-christian-warriors"), "community-christian-mineral-wells");
  assert.equal(programByName("Wren", ours, "wren-wrens"), "wren");
  // Words that say what kind of school, not where, need not be in the feed's slug.
  assert.equal(programByName("Finch Charter", new Set(["finch-charter-school", "wren"]), "finch-charter-falcons"), "finch-charter-school");
});

test("a forfeit keeps its side's flag; one naming no side is not written", () => {
  const [h, a] = past().participants;
  const flagged = past({ status: "Forfeit", participants: [h, { ...a, forfeited: true, score: 0 }] });
  const unflagged = past({ scheduledKickoff: "2019-09-14T00:30:00Z", status: "Forfeit" });
  const { rows, skipped } = historyRows([flagged, unflagged], { ours: pastOurs, slugs, renamed: new Map(), season: 2019 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].away_forfeit, "true");
  assert.equal(skipped.forfeitUnflagged, 1);
});

test("known programs come from the published seasons and the lineage table", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dc-known-"));
  mkdirSync(path.join(dir, "maxpreps-2021"));
  mkdirSync(path.join(dir, "lineage"));
  writeFileSync(path.join(dir, "maxpreps-2021", "games.csv"), "division,round,game_date,home,away\nI,season,2021-09-03,Wren,Lark West\n");
  writeFileSync(path.join(dir, "lineage", "programs.csv"), "predecessor,successor,event,season,source_url,notes\nOld Finch,Finch,consolidation,2021,https://example.org,invented\n");
  const { slugs: found, renamed } = knownPrograms(dir);
  assert.deepEqual([...found].sort(), ["finch", "lark-west", "old-finch", "wren"]);
  assert.deepEqual(renamed.get("finch"), [{ from: "old-finch", season: 2021 }]);
});

test("a 0-0 final is the feed's placeholder: written with no score", () => {
  const [h, a] = past().participants;
  const blank = past({ participants: [{ ...h, score: 0 }, { ...a, score: 0 }] });
  const { rows } = historyRows([blank], { ours: pastOurs, slugs, renamed: new Map(), season: 2019 });
  assert.equal(rows[0].home_score, "");
  assert.equal(rows[0].away_score, "");
});

test("scores follow the feed's own home and away sides, whichever side is mapped", () => {
  const [h, a] = past().participants;
  const swapped = past({ participants: [{ ...a, participantType: "HOME" }, { ...h, participantType: "AWAY" }] });
  const { rows } = historyRows([swapped], { ours: pastOurs, slugs, renamed: new Map(), season: 2019 });
  assert.deepEqual([rows[0].home, rows[0].away, rows[0].home_score, rows[0].away_score], ["finch", "wren", "6", "52"]);
});

test("kickoffs: a bracket game still to play gets the feed's kickoff in UTC, the bracket's names, and no source", () => {
  const due = [{ game_date: "2026-11-13", home: "Lark", away: "Wren", home_score: "", away_score: "" }];
  // The feed has Wren at home: the row keeps the bracket's home and away.
  const rows = kickoffRows([finalItem("wren-wrens", "lark-owls", null, null, { status: "Upcoming", scheduledKickoff: "2026-11-14T01:00:00.000Z" })], { due, ours: oursMap });
  assert.deepEqual(rows, [{ date: "2026-11-13", home: "Lark", away: "Wren", kickoff_utc: "2026-11-14T01:00:00Z", site_name: "", site_city: "" }]);
  // A kickoff on another Central date is another game.
  assert.deepEqual(kickoffRows([finalItem("wren-wrens", "lark-owls", null, null, { scheduledKickoff: "2026-11-15T01:00:00Z" })], { due, ours: oursMap }), []);
  const text = mergeKickoffs("", rows);
  assert.equal(text, `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T01:00:00Z,,\n`);
  assert.doesNotMatch(text, /davecampbells|https?:/i);
  // A filled value is never overwritten (ADR 0041): a fresh value only fills a blank; other kept rows stay.
  const kept = `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T00:00:00Z,Bird Field,Lark\n2026-11-14,Finch,Heron,2026-11-14T19:00:00Z,,\n`;
  assert.equal(mergeKickoffs(kept, rows), kept);
  const blank = `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,,,\n`;
  const sited = [{ ...rows[0], site_name: "Bird Field", site_city: "Lark" }];
  assert.equal(mergeKickoffs(blank, sited), `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T01:00:00Z,Bird Field,Lark\n`);
});

test("kickoffs: the site is the feed's venue name and city, plain words only, or blank", () => {
  const due = [{ game_date: "2026-11-13", home: "Lark", away: "Wren", home_score: "", away_score: "" }];
  const at = (venue) =>
    kickoffRows([finalItem("wren-wrens", "lark-owls", null, null, { status: "Upcoming", scheduledKickoff: "2026-11-14T01:00:00Z", venue })], { due, ours: oursMap })[0];
  const site = (venue) => [at(venue).site_name, at(venue).site_city];
  assert.deepEqual(site({ locationName: "Bird Field", city: "Lark", state: "TX" }), ["Bird Field", "Lark"]);
  // No location name: the site label; a bad location name falls back the same way. Nothing else of the venue is kept.
  assert.deepEqual(site({ siteLabel: "Wren Stadium", city: "Lark" }), ["Wren Stadium", "Lark"]);
  assert.deepEqual(site({ locationName: "<b>x</b>", siteLabel: "Wren Stadium", city: "Lark" }), ["Wren Stadium", "Lark"]);
  const full = at({ locationName: "Bird Field", siteLabel: "Wren Stadium", addressLine1: "1 Main St", city: "Lark", postalCode: "79999", latitude: 33.1, longitude: -100.2 });
  assert.deepEqual(Object.keys(full), ["date", "home", "away", "kickoff_utc", "site_name", "site_city"]);
  assert.doesNotMatch(Object.values(full).join(","), /Main St|79999|33\.1|-100/);
  assert.deepEqual(site({ locationName: "  Shotwell   Stadium ", city: "Abilene" }), ["Shotwell Stadium", "Abilene"]);
  assert.deepEqual(site({ locationName: "Field 2, North Campus", city: "Lark" }), ["Field 2 - North Campus", "Lark"], "the file has no quoting");
  assert.deepEqual(site({ locationName: "St. Mary's (Annex) / Field & Track", city: "San Angelo" }), ["St. Mary's (Annex) / Field & Track", "San Angelo"]);
  for (const bad of [undefined, null, {}, { city: "Lark" }, { locationName: "<b>Field</b>", city: "Lark" }, { locationName: "x".repeat(81), city: "Lark" }, { locationName: 5, city: "Lark" }]) {
    assert.deepEqual(site(bad), ["", ""], JSON.stringify(bad));
  }
  assert.deepEqual(site({ locationName: "Bird Field", city: "Lark<br>" }), ["Bird Field", ""], "a bad city leaves the name");
  // The kickoff stands either way, and the file still names no source.
  assert.equal(at({ locationName: "Bird Field", city: "Lark" }).kickoff_utc, "2026-11-14T01:00:00Z");
  assert.doesNotMatch(mergeKickoffs("", [at({ locationName: "Bird Field", city: "Lark" })]), /davecampbells|https?:|venue/i);
});

test("kickoffs: what is still missing is counted by league, never naming a school", () => {
  const due = [
    { league: "TAPPS", game_date: "2026-11-13", home: "Lark", away: "Wren", home_score: "" },
    { league: "TAPPS", game_date: "2026-11-13", home: "Finch", away: "Heron", home_score: "" },
    { league: "TCAF", game_date: "2026-11-14", home: "Owl", away: "Crane", home_score: "" },
  ];
  const text = `${DETAIL_COLUMNS}\n2026-11-13,Wren,Lark,2026-11-14T01:00:00Z,Bird Field,Lark\n2026-11-14,Owl,Crane,2026-11-14T19:00:00Z,,\n`;
  const line = missingDetails(due, text);
  assert.equal(line, "Still missing: a kickoff 1 (TAPPS 1); a site 2 (TAPPS 1, TCAF 1).");
  assert.doesNotMatch(line, /Lark|Wren|Finch|Heron|Owl|Crane/);
  assert.equal(missingDetails(due.slice(0, 1), text), "Still missing: a kickoff 0; a site 0.");
  assert.equal(missingDetails(due, ""), "Still missing: a kickoff 3 (TAPPS 2, TCAF 1); a site 3 (TAPPS 2, TCAF 1).");
});

test("--merge-details lays an earlier read over the file without overwriting a filled value, and reads no feed", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(path.join(tmpdir(), "merge-details-"));
  const fresh = path.join(dir, "fresh.csv");
  const out = path.join(dir, "2026.csv");
  writeFileSync(fresh, `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T01:00:00Z,Bird Field,Lark\n2026-11-14,Finch,Heron,2026-11-14T19:00:00Z,,\n`);
  writeFileSync(out, `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T00:30:00Z,,\n`);
  // No network: the feed's host is unreachable here, so a read would fail the run.
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "davecampbells.mjs"), "--merge-details", fresh, "--out", out], { encoding: "utf8", env: { ...process.env, HTTPS_PROXY: "http://127.0.0.1:9" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, "utf8"), `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T00:30:00Z,Bird Field,Lark\n2026-11-14,Finch,Heron,2026-11-14T19:00:00Z,,\n`);
});

test("merging the two sources: on the same score, the row that says finished wins, then the one with a period", () => {
  const r = (over) => ({ game_key: "2026-11-13|a|b", home: "a", away: "b", home_score: 28, away_score: 14, period: null, read_at: "2026-11-14T02:00:00.000Z", ...over });
  assert.equal(mergeLive([r({ period: "Q4" })], [r({ finished: true })])[0].finished, true);
  assert.equal(mergeLive([r({ finished: true })], [r({ period: "Q4" })])[0].finished, true);
  // A higher score is the newer read, finished or not.
  assert.equal(mergeLive([r({ finished: true })], [r({ home_score: 34, period: "Q4" })])[0].home_score, 34);
  assert.equal(mergeLive([r({})], [r({ period: "Q2" })])[0].period, "Q2");
});

test("the period log counts the feed's period by minutes since kickoff, games under way only, never a team or score", () => {
  const now = new Date("2026-11-14T02:26:00Z");
  const at = (minutes, period, status = "Live") => item({ status, scheduledKickoff: new Date(now - minutes * 60_000).toISOString(), summary: { period, homeScore: 75, awayScore: 6 } });
  assert.equal(periodByMinutes([], now), "no game under way");
  const line = periodByMinutes([at(10, 1), at(20, 1), at(86, 1), at(116, 5), at(116, 5), at(45, null), at(130, 4, "Finished"), at(5, "Q<2>")], now);
  assert.equal(line, "0-30 min: 1 x2, Q2 x1; 30-60 min: none x1; 60-90 min: 1 x1; 90-120 min: 5 x2");
  assert.ok(!/75|6\b|wren|lark/i.test(line));
});

test("late (ADR 0043): the raw period is 4 or more, or 2 hours since kickoff; with no kickoff, the period alone", () => {
  const kickoff = "2026-11-14T01:00:00Z";
  const at = (minutes) => new Date(Date.parse(kickoff) + minutes * 60_000);
  assert.equal(isLate(item({ summary: { period: 4 } }), at(40)), true, "late by period");
  assert.equal(isLate(item({ summary: { period: 5 } }), at(40)), true, "past the fourth quarter");
  assert.equal(isLate(item({ summary: { period: "4" } }), at(40)), true, "a period given as text");
  assert.equal(isLate(item({ summary: { period: 2 } }), at(120)), true, "late by time: 2 hours since kickoff");
  assert.equal(isLate(item({ summary: { period: 2 } }), at(119)), false, "not late");
  assert.equal(isLate(item({ summary: { period: null } }), at(60)), false);
  assert.equal(isLate(item({ scheduledKickoff: undefined, summary: { period: 2 } }), at(600)), false, "no kickoff: period alone");
  assert.equal(isLate(item({ scheduledKickoff: undefined, summary: { period: 4 } }), at(0)), true);
  // The row carries the flag only when late; the period itself is never stored.
  const opts = { date: "2026-11-13", due, ours };
  const [late] = liveRowsFromItems([item({ summary: { period: 2, homeScore: 20, awayScore: 14 } })], { ...opts, readAt: at(130) });
  assert.deepEqual([late.late, late.period], [true, null]);
  assert.equal(liveRowsFromItems([item()], { ...opts, readAt: at(60) })[0].late, undefined);
});

test("mergeLive keeps late when either source's row says so (ADR 0043)", () => {
  const r = (total, late) => ({ game_key: "2026-11-13|a|b", home: "a", away: "b", home_score: total, away_score: 0, period: null, ...(late && { late: true }), read_at: "2026-11-14T03:00:00.000Z" });
  assert.equal(mergeLive([r(28)], [r(21, true)])[0].late, true, "the higher score wins, the late flag is kept");
  assert.equal(mergeLive([r(28)], [r(21, true)])[0].home_score, 28);
  assert.equal(mergeLive([r(28)], [r(21)])[0].late, undefined);
});

test("--opponents lists a team's opponents by slug and school name, once each, never the team itself", () => {
  const game = (a, b) => ({ participants: [{ websiteUrl: `/team/${a}`, schoolName: a.toUpperCase(), score: 7 }, { websiteUrl: `https://x.test/team/${b}/`, schoolName: "Wren Academy" }] });
  const rows = opponentRows([game("lark-owls", "wren-academy-wrens"), game("lark-owls", "wren-academy-wrens"), game("finch-falcons", "lark-owls"), { participants: null }, { participants: [{ websiteUrl: "/team/lark-owls" }, { schoolName: "Robin Prep" }, {}] }], "lark-owls");
  assert.deepEqual(rows, [{ slug: "", school: "Robin Prep" }, { slug: "finch-falcons", school: "FINCH-FALCONS" }, { slug: "wren-academy-wrens", school: "Wren Academy" }]);
  assert.ok(!JSON.stringify(rows).includes("7"), "no score");
});

test("--about shows only a team answer's name and place fields", () => {
  const answer = { teamId: "t1", schoolName: "Wren Academy", logoUrl: "https://x.test/l.png", school: { name: "Wren Academy", city: "Lark", state: "TX", websiteUrl: "https://x.test" }, ranking: 3, records: [{ city: "no" }] };
  assert.deepEqual(placeFields(answer), ["schoolName: Wren Academy", "school.name: Wren Academy", "school.city: Lark", "school.state: TX"]);
  assert.deepEqual(placeFields(null), []);
});

test("bracketFields prints a playoff game's bracket fields, never a score, and copes with missing ones (ADR 0047)", () => {
  const item = {
    scheduledKickoff: "2026-11-14T01:00:00Z", seasonPhase: "Playoffs", playoffRound: "Bi-District", playoffBracketPosition: 6,
    eventDescription: "1A D1 Bi-District", status: "Final", homeScore: 98, awayScore: 50,
    participants: [{ schoolName: "Invented Valley", participantType: "Home", seed: 1 }, { schoolName: "Made Up", participantType: "Away" }],
  };
  const line = bracketFields(item);
  assert.equal(line, "2026-11-13 | Invented Valley (Home, seed 1) v Made Up (Away, seed -) | phase Playoffs | round Bi-District | position 6 | event 1A D1 Bi-District | status Final");
  assert.doesNotMatch(line, /98|50/);
  assert.equal(bracketFields({}), "no date |  | phase - | round - | position - | event - | status -");
});

test("the feed's UIL bracket positions are checked against UIL's bracket: G(first of round + position) (ADR 0047)", () => {
  const structure = [
    ["G1", "bi-district", "Salt Fork", "Cedar Gap"], ["G2", "bi-district", "Dry Wash", "Owl Creek"],
    ["G3", "bi-district", "Lone Elm", "Big Draw"], ["G4", "bi-district", "Kite Hill", "Sand Bend"],
    ["G17", "area", "winner:G1", "winner:G2"], ["G18", "area", "winner:G3", "winner:G4"],
  ].map(([slot, round, a, b]) => ({ division: "I", round, slot, a, b }));
  const game = (round, position, home, away, league = "UIL") => ({ item: { playoffRound: round, playoffBracketPosition: position }, row: { league, division: "I", home, away } });
  const fit = positionProblems([game("Bi-District", 2, "Owl Creek", "Dry Wash"), game("Area", 1, "Owl Creek", "Salt Fork"), game("Area", 2, "Big Draw", "Sand Bend")], structure);
  assert.deepEqual(fit, { checked: 3, misfits: [] });
  // Area position 1 is G17 (G1 and G2's winners): a pairing from G3 and G4 there does not fit; nor does a position with no slot.
  const wrong = positionProblems([game("Area", 1, "Big Draw", "Sand Bend"), game("Area", 5, "Owl Creek", "Salt Fork")], structure);
  assert.deepEqual(wrong, { checked: 2, misfits: ["UIL I G17", "UIL I G21"] });
  // Not UIL, no position or an unknown round: not checked.
  const skipped = positionProblems([game("Area", 1, "Owl Creek", "Salt Fork", "TAPPS"), game("Area", null, "Owl Creek", "Salt Fork"), game("Playoffs", 1, "Owl Creek", "Salt Fork")], structure);
  assert.deepEqual(skipped, { checked: 0, misfits: [] });
});
