// Invented fixtures only: no test calls the feed.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DETAIL_COLUMNS, kickoffRows, liveFields, mergeKickoffs } from "./davecampbells.mjs";
import { allFinishedGames, asOf, footballSeasons, HISTORY_COLUMNS, historyCsv, historyRows, knownPrograms, programByName, checkFinals, noAgreement, NO_AGREEMENT_MIN, raise, seasonIdOwed, createClient, daysBefore, finalOf, finalsSummary, gamesToCheck, isFinal, isForfeit, isLive, liveRowsFromItems, matchGames, mergeLive, periodLabel, readReport, REPORT_COLUMNS, reportCsv, sameSchool, TEAMS_PER_RUN, teamId, teamMaps, teamSlugOf, USER_AGENT, verdictOf } from "./davecampbells.mjs";

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
  // A fresh value wins over a kept one, a blank keeps it; other kept rows stay.
  const kept = `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T00:00:00Z,Bird Field,Lark\n2026-11-14,Finch,Heron,2026-11-14T19:00:00Z,,\n`;
  assert.equal(mergeKickoffs(kept, rows), `${DETAIL_COLUMNS}\n2026-11-13,Lark,Wren,2026-11-14T01:00:00Z,Bird Field,Lark\n2026-11-14,Finch,Heron,2026-11-14T19:00:00Z,,\n`);
});

test("--fields lists the clock and period fields of games under way by format, never a team or a score", () => {
  const game = (status, clock) => ({
    status,
    summary: { homeScore: 28, awayScore: 14, period: 3, periodRemainingTime: clock, lastUpdatedUtc: 1794618000.5 },
    participants: [{ schoolName: "Alpha", score: 28 }, { schoolName: "Bravo", score: 14 }],
    venue: { timezone: "America/Chicago" },
  });
  const lines = liveFields([game("Live", "4:12"), game("Live", null), game("Final", "0:00")]);
  assert.equal(lines[0], "2 games under way");
  assert.ok(lines.includes('summary.periodRemainingTime string "9:99": 1 game(s), e.g. "4:12"'));
  assert.ok(lines.includes("summary.periodRemainingTime null: 1 game(s), e.g. null"));
  assert.ok(lines.includes('summary.period number "9": 2 game(s), e.g. 3'));
  const text = lines.join("\n");
  for (const hidden of ["Alpha", "Bravo", "28", "14", "Chicago", "0:00"]) assert.ok(!text.replace(/shape: .*/g, "").includes(hidden), hidden);
});
