import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, centralDate, chanceText, digestData, groupWeek, hasNews, homeChance, isoWeek, mondayOf, sendWindowOpen } from "./digest-data.mjs";

// The digest's facts for invented teams. The rules copied from the site are held to the site's own in
// apps/web/scripts/email-digest-parity.test.mjs, on the real data.
const team = (name, trend, rated_trend) => ({ team: name, rating: trend.at(-1), rated: rated_trend.at(-1), trend, rated_trend });
const ratings = {
  season: 2026, home_field: 4.6, sigma: 20.2, playoff_edge: 0.5, calibration: { family: "logistic", scale: 15.57 },
  weeks: ["2026-11-01", "2026-11-08", "2026-11-15"],
  teams: [
    team("Alpha", [100, 110, 120], [4, 5, 6]), team("Beta", [120, 112, 100], [4, 5, 6]), team("Gamma", [90, 95, 96], [4, 5, 6]),
    team("Delta", [60, 70, 110], [4, 5, 6]), team("Echo", [50, 58, 60], [1, 2, 3]), team("Foxtrot", [null, null, 50], [0, 0, 4]),
    team("Zulu", [190, 195, 200], [4, 5, 6]), team("Tango", [30, 31, 32], [4, 5, 6]),
  ],
};
const GAMES = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period";
const PLAYOFFS = "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period";
const files = (over = {}) => {
  const f = {
    "data/ratings/2026.json": JSON.stringify(ratings),
    "data/seed/uil-2026-28/alignments.csv": ["league,division,region,district,school,source_url", ...["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot"].map((s) => `UIL,I,1,1,${s},x`), "UIL,II,1,1,Zulu,x"].join("\n"),
    "data/seed/tapps-2026-28/alignments.csv": "league,division,region,district,school,source_url\nTAPPS,I,,1,Tango,x",
    "data/seed/maxpreps-2026/games.csv": [GAMES, "I,season,2026-11-13,Alpha,Beta,,40,14,unknown,", "I,season,2026-11-13,Gamma,Delta,,21,20,unknown,", "I,season,2026-11-12,Echo,Foxtrot,,1,0,unknown,", "II,season,2026-11-12,Zulu,Yak,,0,0,unknown,", "I,season,2026-11-04,Tango,Yak,,7,0,unknown,"].join("\n"),
    "data/seed/maxpreps-2026/playoffs.csv": [PLAYOFFS, "UIL,I,area,2026-11-20,Alpha,Delta,,,,,", "UIL,II,area,2026-11-10,Zulu,Yak,,,,,"].join("\n"),
    "data/seed/disputed/2026.csv": "game_date,home,away\n2026-11-13,Gamma,Delta",
    "data/seed/game-details/2026.csv": "date,home,away,kickoff_utc,site_name,site_city\n2026-11-20,Alpha,Delta,2026-11-21T01:30:00Z,,",
    ...over,
  };
  return { read: (p) => f[p] ?? "", list: (d) => [...new Set(Object.keys(f).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1).split("/")[0]))] };
};
const bracket = { alert: "next_game", home_slug: "beta", away_slug: "gamma", home_name: "Beta", away_name: "Gamma", round: "regional" };
const data = (over, events = [bracket]) => digestData({ season: 2026, today: "2026-11-16", files: files(over), events });

test("weeks are ISO weeks in Central time, last week runs Monday to Sunday, and a send is allowed Monday to Wednesday", () => {
  assert.equal(isoWeek("2026-11-16"), "2026-w47");
  assert.equal(isoWeek("2026-11-22"), "2026-w47"); // a Sunday belongs to the week before it
  assert.equal(isoWeek("2027-01-01"), "2026-w53");
  assert.equal(isoWeek("2024-12-30"), "2025-w01");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(data().week, { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-22"].map(sendWindowOpen), [true, true, true, false, false]);
  assert.equal(centralDate(Date.parse("2026-11-17T04:30:00Z")), "2026-11-16"); // still Monday evening in Texas
});

test("last week's result is a confirmed final only: never a disputed game, a forfeit or a 0-0", () => {
  const d = data();
  assert.deepEqual(d.forTeam("alpha").last, { kind: "result", date: "2026-11-13", home: "Alpha", away: "Beta", homeScore: 40, awayScore: 14 });
  assert.equal(d.forTeam("beta").last.kind, "result"); // the same game, from the other side
  for (const slug of ["gamma", "delta", "echo", "foxtrot", "zulu"]) assert.equal(d.forTeam(slug).last.kind, "unconfirmed", slug);
  assert.equal(d.forTeam("tango").last.kind, "none"); // its game was the week before
  assert.equal(d.forTeam("nobody").last.kind, "none");
});

test("a ranking move counts places within the team's group, only when the rating itself moved, and says new or not ranked", () => {
  const d = data();
  assert.deepEqual(d.forTeam("alpha").ranking, { group: "Division I", place: 1, moved: 1, before: 2 });
  assert.deepEqual(d.forTeam("delta").ranking, { group: "Division I", place: 2, moved: 2, before: 4 });
  assert.deepEqual(d.forTeam("beta").ranking, { group: "Division I", place: 3, moved: -2, before: 1 });
  assert.deepEqual(d.forTeam("gamma").ranking, { group: "Division I", place: 4, moved: 0, before: undefined }); // a place lost, but the rating moved by 1 point
  assert.deepEqual(d.forTeam("foxtrot").ranking, { group: "Division I", place: 5, moved: "new", before: undefined });
  assert.deepEqual(d.forTeam("echo").ranking, { group: "Division I", place: undefined, moved: undefined, before: undefined }); // three rated games: no rank
  assert.deepEqual(d.forTeam("zulu").ranking, { group: "Division II", place: 1, moved: 0, before: undefined }); // Division I's teams do not count
  assert.deepEqual(d.forTeam("tango").ranking, { group: "TAPPS", place: 1, moved: 0, before: undefined });
  assert.equal(d.forTeam("nobody").ranking, undefined);
});

test("a week with no rating column, or the season's first column, gives no move", () => {
  assert.equal(digestData({ season: 2026, today: "2026-11-23", files: files() }).forTeam("alpha").ranking, undefined);
  const early = { ...ratings, weeks: ["2026-11-15"], teams: ratings.teams.map((t) => ({ ...t, trend: [t.trend.at(-1)], rated_trend: [t.rated_trend.at(-1)] })) };
  const r = digestData({ season: 2026, today: "2026-11-16", files: files({ "data/ratings/2026.json": JSON.stringify(early) }) }).forTeam("alpha").ranking;
  assert.deepEqual([r.place, r.moved], [1, undefined]);
  assert.equal(groupWeek(ratings, () => true, 0).moved.size, 0);
});

test("the next game is the earliest listed one from today on, with its kickoff and a chance to win for each side; none listed, or none at all, says so", () => {
  const d = data();
  const n = d.forTeam("alpha").next;
  assert.deepEqual([n.date, n.kickoff, n.home, n.away, n.round], ["2026-11-20", "2026-11-21T01:30:00Z", "Alpha", "Delta", "area"]);
  // A playoff site is neutral unless the file says otherwise; the listed home team still gets the playoff share of the home edge.
  const margin = 120 - 110 + 4.6 * 0.5;
  assert.ok(Math.abs(n.homeChance - 1 / (1 + Math.exp(-margin / 15.57))) < 1e-12);
  assert.equal(chanceText(n.homeChance) + chanceText(1 - n.homeChance), "69%31%");
  assert.equal(d.forTeam("zulu").next, undefined); // its only unscored game was last week's date
  assert.equal(d.forTeam("tango").next, undefined);
  // No game listed, but the bracket gives it both teams: the round and the teams, the date to come.
  const b = d.forTeam("gamma").next;
  assert.deepEqual([b.date, b.home, b.away, b.round, chanceText(b.homeChance)], [undefined, "Beta", "Gamma", "regional", "60%"]);
  // A game on Monday counts; one the day before does not.
  assert.equal(digestData({ season: 2026, today: "2026-11-20", files: files() }).forTeam("alpha").next.date, "2026-11-20");
  assert.equal(digestData({ season: 2026, today: "2026-11-21", files: files() }).forTeam("alpha").next, undefined);
});

test("no chance to win for a team the ratings do not rate; the table without a fit gives none; neutral and true-neutral change the edge", () => {
  assert.equal(homeChance(ratings, "Alpha", "Nobody", false), undefined);
  assert.equal(homeChance({ ...ratings, sigma: undefined }, "Alpha", "Beta", false), undefined);
  assert.ok(homeChance(ratings, "Alpha", "Beta", false) > homeChance(ratings, "Alpha", "Beta", true, true));
  assert.equal(homeChance(ratings, "Alpha", "Beta", true, true), 1 / (1 + Math.exp(-20 / 15.57)));
  const { calibration, ...plain } = ratings; // a table without the calibration falls back to the normal chance, as the site does
  assert.ok(Math.abs(homeChance(plain, "Alpha", "Beta", true, true) - 0.8387) < 0.001);
  assert.deepEqual([chanceText(0.995), chanceText(0.004), chanceText(0.5)], [">99%", "<1%", "50%"]);
});

test("a hand-captured playoff game wins over a robot row for the same game, and a team name is the school's, whatever the slug", () => {
  const hand = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes\nI,area,2026-11-20,Alpha,Delta,false,,,,,x,";
  const n = data({ "data/seed/uil-2026-28/playoffs-2026.csv": hand }).forTeam("alpha").next;
  assert.ok(n.homeChance > data().forTeam("alpha").next.homeChance); // a true home game: the full home edge
  assert.equal(data().forTeam("alpha").name, "Alpha");
  assert.equal(data().forTeam("some-new-team").name, "Some New Team");
});

test("a digest has news only when a team has a confirmed result or a next game: a ranking alone, or an unconfirmed game, is not enough", () => {
  const d = data();
  assert.equal(hasNews([d.forTeam("alpha")]), true);
  assert.equal(hasNews([d.forTeam("tango"), d.forTeam("gamma")]), true); // gamma has the bracket's next game
  assert.equal(hasNews([d.forTeam("tango"), d.forTeam("echo"), d.forTeam("zulu"), d.forTeam("nobody")]), false);
  assert.equal(hasNews([]), false);
  const offSeason = digestData({ season: 2026, today: "2027-01-18", files: files() });
  assert.equal(hasNews(["alpha", "beta", "tango"].map(offSeason.forTeam)), false);
});
