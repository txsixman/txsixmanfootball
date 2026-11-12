import assert from "node:assert/strict";
import { test } from "node:test";
import { ALIASES, ALLOWED, bracketOf, centralDate, COLUMNS, gameNight, loadAlignments, match, mergeTonight, OUTSIDE_COLUMNS, outsideCsv, parseSchedule, roundName, scheduleUrl, seasonSegment, slugify, teamPage, toCsv, tonightsGames } from "./maxpreps.mjs";

// The positional shape MaxPreps used on Nov 10, 2026, with invented schools (ADR 0008).
function team({ name, homeAway, score = null, result = null, contestId = "c1" }) {
  const t = Array(31).fill(null);
  Object.assign(t, { 5: result, 6: score, 11: homeAway, 15: "Somewhere", 13: `https://www.maxpreps.com/tx/x/${name.toLowerCase().replace(/ /g, "-")}/football/`, 14: name, 16: "TX", 26: contestId });
  return t;
}
function contest({ teams, start, deleted = false, hasResult = false, gameUrl = null }) {
  const c = Array(41).fill(null);
  Object.assign(c, { 0: teams, 3: deleted, 4: hasResult, 11: start, 18: gameUrl, 29: "A narrative the reader must ignore." });
  return c;
}
const page = (contests) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { contests } } })}</script></html>`;

const played = contest({
  teams: [team({ name: "Cedar Gap", homeAway: 1, score: 61, result: "W" }), team({ name: "Salt Fork", homeAway: 0, score: 14, result: "L" })],
  start: "2026-08-28T19:30:00",
  hasResult: true,
  gameUrl: "https://www.maxpreps.com/tx/football/game/cedar-gap-vs-salt-fork/8-28-2026/?c=c1",
});
const deleted = contest({ teams: [team({ name: "Cedar Gap", homeAway: 0 }), team({ name: "Dry Wash", homeAway: 1 })], start: "2026-08-21T19:00:00", deleted: true });
const upcoming = contest({ teams: [team({ name: "Dry Wash", homeAway: 0, contestId: "c3" }), team({ name: "Cedar Gap", homeAway: 1, contestId: "c3" })], start: "2026-11-13T19:00:00" });

test("reads home, away, score and date; skips deleted games", () => {
  const games = parseSchedule(page([played, deleted, upcoming]));
  assert.equal(games.length, 2);
  const [g, later] = games;
  assert.equal(g.date, "2026-08-28");
  assert.equal(g.home.name, "Salt Fork");
  assert.equal(g.away.name, "Cedar Gap");
  assert.deepEqual([g.home.score, g.away.score, g.played], [14, 61, true]);
  assert.equal(later.played, false);
});

test("fails loudly when the page shape changes", () => {
  assert.throws(() => parseSchedule("<html></html>"), /no __NEXT_DATA__/);
  assert.throws(() => parseSchedule(page([contest({ teams: [team({ name: "A", homeAway: 0 })], start: "2026-09-01" })])), /exactly two teams/);
  assert.throws(() => parseSchedule(page([contest({ teams: [team({ name: "A", homeAway: 0 }), team({ name: "B", homeAway: 1 })], start: null })])), /without a date/);
});

test("writes played games only, with our school names and the game page as source", () => {
  const bySlug = new Map([
    ["cedar-gap", { school: "Cedar Gap", division: "I" }],
    ["salt-fork", { school: "Salt Fork", division: "II" }],
    ["dry-wash", { school: "Dry Wash", division: "I" }],
  ]);
  const games = parseSchedule(page([played, upcoming])).map((g) => {
    for (const t of [g.home, g.away]) t.slug = match(t, bySlug);
    return { ...g, source: "schedule-page" };
  });
  const [header, ...rows] = toCsv(games, bySlug).trim().split("\n");
  assert.equal(header, COLUMNS);
  assert.deepEqual(rows, ["II,season,2026-08-28,Salt Fork,Cedar Gap,false,14,61,unknown,,https://www.maxpreps.com/tx/football/game/cedar-gap-vs-salt-fork/8-28-2026/?c=c1,"]);
});

test("matches on an alias, the name, or city and name, in Texas only", () => {
  const bySlug = new Map([["lenorah-grady", {}], ["jayton", {}], ["turkey-valley", {}]]);
  const t = (name, city, url = "u", state = "TX") => ({ name, city, url, state });
  assert.equal(match(t("Jayton", "Jayton"), bySlug, {}), "jayton");
  assert.equal(match(t("Grady", "Lenorah"), bySlug, {}), "lenorah-grady");
  assert.equal(match(t("Valley", "Turkey", "v"), bySlug, { v: "Turkey Valley" }), "turkey-valley");
  assert.equal(match(t("Jayton", "Jayton", "u", "OK"), bySlug, {}), null);
  assert.equal(match(t("Valley", "Elsewhere"), bySlug, {}), null);
  assert.equal(match(t("Grady", "X", "g"), bySlug, { g: ["Lenorah Grady", "Jayton"] }), "lenorah-grady"); // listed twice: first wins
});

test("maps MaxPreps playoff brackets to our leagues, and skips the rest", () => {
  assert.deepEqual(bracketOf("2026 UIL Texas Football State Championships ", "2026 Football 6-Man 1A D2 "), { league: "UIL", division: "II" });
  assert.deepEqual(bracketOf("TAPPS 2026 High School Football Playoff", "TAPPS 6 Man III Large School"), { league: "TAPPS", division: "III Large School" });
  assert.deepEqual(bracketOf("TAIAO 2026 Football Championships", "Division II"), { league: "TAIAO", division: "2" });
  assert.deepEqual(bracketOf("2026 TCAF Football State Championships", "TCAF"), { league: "TCAF", division: "Six-Man" });
  assert.equal(bracketOf("2026 UIL Texas Football State Championships", "2026 Football 2A D1"), null);
});

test("names rounds back from the final", () => {
  const uil5 = [0, 1, 2, 3, 4].map((i) => roundName("UIL", i, 5));
  assert.deepEqual(uil5, ["bi-district", "area", "regional", "semifinal", "state"]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => roundName("UIL", i, 6)).slice(3), ["quarterfinal", "semifinal", "state"]);
  assert.deepEqual([0, 1, 2, 3].map((i) => roundName("TAIAO", i, 4)), ["round-1", "quarterfinal", "semifinal", "final"]);
});

test("reads a playoff game's bracket from pageProps.tournaments", () => {
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { contests: [upcoming], tournaments: [{ contestId: "c3", isTournamentPlayOff: true, tournamentName: "TCAF", bracketName: "TCAF" }] } },
  })}</script></html>`;
  assert.deepEqual(parseSchedule(html)[0].bracket, { league: "TCAF", division: "Six-Man" });
});

test("builds a past season's schedule URL from the team page, and allows only that shape", () => {
  const team = "https://www.maxpreps.com/tx/cedar-gap/cedar-gap-herons/football/";
  assert.equal(seasonSegment(2025), "25-26");
  assert.equal(seasonSegment(2099), "99-00");
  assert.equal(scheduleUrl(team, 2026, 2026), `${team}schedule/`);
  assert.equal(scheduleUrl(team, 2025, 2026), `${team}25-26/schedule/`);
  assert.ok(ALLOWED.test(scheduleUrl(team, 2026, 2026)));
  assert.ok(ALLOWED.test(scheduleUrl(team, 2025, 2026)));
  for (const bad of [
    `${team}25-26/roster/`,
    `${team}schedule/all-time/`,
    `${team}25-26/schedule/all-time/`,
    `${team}2025/schedule/`,
    `${team}25-26/26-27/schedule/`,
    `${team}25-26/schedule/?x=1`,
    "https://www.maxpreps.com/team/cedar-gap/football/25-26/schedule/",
    "https://www.maxpreps.com/tx/cedar-gap/cedar-gap-herons/football/stats/",
    "https://www.maxpreps.com/api/schedule/",
  ]) assert.ok(!ALLOWED.test(bad), bad);
});

test("a past season's team links reduce to the team page", () => {
  const base = "https://www.maxpreps.com/tx/cedar-gap/cedar-gap-herons/football/";
  assert.equal(teamPage(`${base}25-26/schedule/`), base);
  assert.equal(teamPage(`${base}schedule/`), base);
  assert.equal(teamPage(base), base);
});

test("a dropped connection is retried, a 4xx is not, and the last error is thrown", async () => {
  const { withRetries } = await import("./maxpreps.mjs");
  let calls = 0;
  assert.equal(await withRetries("u", async () => (++calls < 3 ? Promise.reject(new Error("socket")) : "ok"), [0, 0]), "ok");
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(withRetries("u", async () => { calls++; throw Object.assign(new Error("HTTP 403"), { final: true }); }, [0, 0]), /403/);
  assert.equal(calls, 1);
  await assert.rejects(withRetries("u", async () => { throw new Error("still down"); }, [0, 0]), /still down/);
});

test("an unplayed date with no opponent named is skipped; a played one with a team missing fails", () => {
  const nobody = Array(31).fill(null);
  const open = contest({ teams: [team({ name: "Cedar Gap", homeAway: 0 }), nobody], start: "2026-09-04T12:00:00" });
  assert.equal(parseSchedule(page([open, played])).length, 1);
  const odd = contest({ teams: [team({ name: "Cedar Gap", homeAway: 0, score: 40 }), nobody], start: "2026-09-04T12:00:00", hasResult: true });
  assert.throws(() => parseSchedule(page([odd])), /played game with a team without a name/);
});

test("a game listed twice is one game; twice with different scores, it is left out", async () => {
  const { dedupe } = await import("./maxpreps.mjs");
  const g = (id, hs, as, bracket = null) => ({ id, date: "2026-09-04", played: true, bracket, home: { slug: "cedar-gap", score: hs }, away: { slug: "salt-fork", score: as } });
  const flipped = { ...g("c3", 0, 0), home: { slug: "salt-fork", score: 14 }, away: { slug: "cedar-gap", score: 61 } };
  const same = dedupe([g("c1", 61, 14), flipped]);
  assert.equal(same.kept.length, 1);
  assert.deepEqual(same.conflicts, []);
  assert.equal(dedupe([g("c1", 61, 14), g("c2", 61, 14, { league: "UIL" })]).kept[0].id, "c2");
  const odd = dedupe([g("c1", 0, 8), g("c2", 0, 2)]);
  assert.equal(odd.kept.length, 0);
  assert.equal(odd.conflicts.length, 1);
});

test("a game against a school outside our alignments is kept for the ratings, once, never a placeholder opponent", () => {
  const side = (slug, url, score, home = false) => ({ slug, url, name: url.split("/")[5], score, home });
  const g = (id, ours, theirs, date = "2025-09-05") => ({ id, date, home: ours, away: theirs, played: true, gameUrl: `https://example.test/${id}`, source: "s" });
  const bySlug = new Map([["cedar-gap", { school: "Cedar Gap" }]]);
  const cedar = (n) => side("cedar-gap", "https://www.maxpreps.com/tx/x/cedar-gap/football/", n);
  const far = (n) => side(null, "https://www.maxpreps.com/tx/x/far-away/football/", n);
  const ghost = side(null, "https://www.maxpreps.com/pseudo/unknown/non-varsity-opponent/football/", 0);
  const { csv, count, conflicts } = outsideCsv([g("a", cedar(50), far(7)), g("b", cedar(50), far(7)), g("c", cedar(40), ghost, "2025-09-12"), g("d", cedar(40), far(6), "2025-09-19"), g("e", cedar(30), far(9), "2025-09-19")], bySlug);
  assert.equal(csv.split("\n")[0], OUTSIDE_COLUMNS);
  assert.equal(count, 1);
  assert.equal(conflicts, 1); // two listings of the 9/19 game disagree
  assert.match(csv.split("\n")[1], /^2025-09-05,Cedar Gap,far-away,.*far-away.*,true,50,7,/);
});

// The real alias file and alignments, as the next run reads them. Results watch runs this file before it reads MaxPreps.
test("every alias names a school in our alignments, so no alias page is read for nothing", () => {
  const bySlug = loadAlignments();
  const stale = Object.entries(ALIASES).flatMap(([url, names]) => [names].flat().filter((n) => !bySlug.has(slugify(n))).map((n) => `${n} (${url})`));
  assert.deepEqual(stale, []);
});

test("a CenTex Chargers game against Community Christian is kept, under our names (Independent and TCAF, Nov 11, 2026)", () => {
  const CENTEX = "https://www.maxpreps.com/tx/temple/centex-homeschool-chargers/football/";
  const MINERAL_WELLS = "https://www.maxpreps.com/tx/mineral-wells/community-christian-warriors/football/";
  // Both pages are starting pages (every alias page is), so the run reads them even if no other school plays them.
  assert.ok(CENTEX in ALIASES && MINERAL_WELLS in ALIASES);
  const real = (t, url, name, city) => Object.assign(t, { 13: url, 14: name, 15: city });
  const game = contest({
    teams: [
      real(team({ name: "x", homeAway: 0, score: 40, result: "W", contestId: "cx" }), CENTEX, "CenTex Homeschool", "Temple"),
      real(team({ name: "y", homeAway: 1, score: 20, result: "L", contestId: "cx" }), MINERAL_WELLS, "Community Christian", "Mineral Wells"),
    ],
    start: "2026-10-30T19:00:00",
    hasResult: true,
    gameUrl: "https://www.maxpreps.com/tx/football/game/x/?c=cx",
  });
  const bySlug = loadAlignments();
  const games = parseSchedule(page([game])).map((g) => {
    for (const t of [g.home, g.away]) t.slug = match(t, bySlug);
    return { ...g, source: "schedule-page" };
  });
  const [, row] = toCsv(games, bySlug).trim().split("\n");
  assert.equal(row, "Six-Man,season,2026-10-30,CenTex Chargers Homeschool Sports Association,Community Christian,false,40,20,unknown,,https://www.maxpreps.com/tx/football/game/x/?c=cx,");
});

// Playoff Friday nights (ADR 0015): only tonight's unscored bracket games are read, and only their scores change.
test("tonight is the date in Texas, whatever the runner's clock zone", () => {
  assert.equal(centralDate(new Date("2026-11-14T05:30:00Z")), "2026-11-13"); // 11:30 PM Friday, Central
  assert.equal(centralDate(new Date("2026-11-14T06:30:00Z")), "2026-11-14");
});

test("every Friday-night run reads Friday's games, the midnight one and a late start included", () => {
  for (const utc of ["2026-11-14T01:00:00Z", "2026-11-14T05:30:00Z", "2026-11-14T06:00:00Z", "2026-11-14T06:45:00Z", "2026-11-14T11:59:00Z"]) {
    assert.equal(gameNight(new Date(utc)), "2026-11-13", utc);
  }
  assert.equal(gameNight(new Date("2026-11-14T12:00:00Z")), "2026-11-14"); // 6 AM Saturday Central: Saturday's games
});

test("a night read fills tonight's finals into the bracket and the games file, and changes nothing else", () => {
  const bySlug = new Map([
    ["cedar-gap", { school: "Cedar Gap", division: "I" }],
    ["salt-fork", { school: "Salt Fork", division: "I" }],
    ["dry-wash", { school: "Dry Wash", division: "II" }],
    ["mesa-verde", { school: "Mesa Verde", division: "II" }],
  ]);
  const P = `league,${COLUMNS}`;
  const playoffsText = [
    P,
    "UIL,I,area,2026-11-13,Salt Fork,Cedar Gap,,,,,,https://www.maxpreps.com/tx/football/game/a/?c=g1,",
    "UIL,II,area,2026-11-13,Dry Wash,Mesa Verde,,,,,,https://www.maxpreps.com/tx/football/game/b/?c=g2,",
    "UIL,I,bi-district,2026-11-06,Salt Fork,Dry Wash,,50,0,unknown,,https://www.maxpreps.com/tx/football/game/c/?c=g0,",
  ].join("\n") + "\n";
  assert.deepEqual(tonightsGames(playoffsText, "2026-11-13").map((r) => r.home), ["Salt Fork", "Dry Wash"]);
  const gamesText = [COLUMNS, "I,season,2026-11-06,Salt Fork,Dry Wash,false,50,0,unknown,,https://www.maxpreps.com/tx/football/game/c/?c=g0,"].join("\n") + "\n";
  // MaxPreps lists the game with Cedar Gap at home; the bracket row has Salt Fork first. The other game is not final.
  const t = (slug, score) => ({ slug, score });
  const finals = [
    { date: "2026-11-13", played: true, home: t("cedar-gap", 42), away: t("salt-fork", 36), gameUrl: "https://www.maxpreps.com/tx/football/game/a/?c=g1" },
    { date: "2026-11-13", played: false, home: t("dry-wash", null), away: t("mesa-verde", null), gameUrl: null },
  ];
  const once = mergeTonight({ playoffsText, gamesText, finals, bySlug });
  assert.equal(once.filled, 1);
  assert.deepEqual(once.playoffs.split("\n"), [
    P,
    "UIL,I,area,2026-11-13,Salt Fork,Cedar Gap,,36,42,unknown,,https://www.maxpreps.com/tx/football/game/a/?c=g1,",
    "UIL,II,area,2026-11-13,Dry Wash,Mesa Verde,,,,,,https://www.maxpreps.com/tx/football/game/b/?c=g2,",
    "UIL,I,bi-district,2026-11-06,Salt Fork,Dry Wash,,50,0,unknown,,https://www.maxpreps.com/tx/football/game/c/?c=g0,",
    "",
  ]);
  assert.deepEqual(once.games.split("\n"), [
    COLUMNS,
    "I,season,2026-11-06,Salt Fork,Dry Wash,false,50,0,unknown,,https://www.maxpreps.com/tx/football/game/c/?c=g0,",
    "I,season,2026-11-13,Cedar Gap,Salt Fork,false,42,36,unknown,,https://www.maxpreps.com/tx/football/game/a/?c=g1,",
    "",
  ]);
  // The next half-hour's read finds nothing new to fill and adds nothing twice.
  const again = mergeTonight({ playoffsText: once.playoffs, gamesText: once.games, finals, bySlug });
  assert.equal(again.filled, 0);
  assert.equal(again.games, once.games);
  assert.equal(again.playoffs, once.playoffs);
});
