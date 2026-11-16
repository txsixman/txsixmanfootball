// Playoff games with no kickoff or no site (playoff-details.mjs): who is named, who is left out, and the quiet rule.
// Invented schools only.   node --test .github/scripts/playoff-details.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { uilSlotRows } from "../../apps/web/lib/bracket-fill.ts";
import { builtDue } from "../../tools/league-watch/bracket-due.mjs";
import { BOT, keyIn } from "./ops-alert.mjs";
import { bodyOf, centralDate, dayLabel, missingDetails, parseDetails, postAlert, QUIET_HOURS, recentIds, roundText, slotDetailsOf, withoutVoided } from "./playoff-details.mjs";

const NOW = Date.parse("2026-11-16T18:00:00Z"); // Monday noon Central; the window ends with Thursday Nov 19
const HOUR = 3_600_000;
const game = (round, date, home, away, hs = "", as = "", league = "UIL", division = "II") => ({ league, division, round, game_date: date, home, away, home_score: hs, away_score: as });
const details = (...rows) => parseDetails(["date,home,away,kickoff_utc,site_name,site_city", ...rows].join("\n"));
const lines = (found) => found.map((g) => g.line);

test("a dated game with a kickoff and no site is named with what is missing", () => {
  const found = missingDetails({
    playoffs: [game("area", "2026-11-18", "Larkspur Ridge", "Cedar Hollow")],
    details: details("2026-11-18,Larkspur Ridge,Cedar Hollow,2026-11-19T01:00:00Z,,"),
    now: NOW,
  });
  assert.deepEqual(lines(found), ["Larkspur Ridge v Cedar Hollow — UIL Division II area, Wed Nov 18: no site"]);
  assert.deepEqual(found[0].missing, ["site"]);
});

test("a game with both its kickoff and its site, in either team order, is not named; one with neither is named for both", () => {
  const playoffs = [game("area", "2026-11-18", "Larkspur Ridge", "Cedar Hollow"), game("area", "2026-11-18", "Willow Bend", "Amber Falls")];
  const found = missingDetails({ playoffs, details: details("2026-11-18,Cedar Hollow,Larkspur Ridge,2026-11-19T01:00:00Z,Pine Stadium,Dalton"), now: NOW });
  assert.deepEqual(lines(found), ["Willow Bend v Amber Falls — UIL Division II area, Wed Nov 18: no kickoff and no site"]);
});

test("the kickoff and site a bracket slot lists count, on the listed day only", () => {
  const slot = (kickoff_utc, site_name) => ({ division: "I", region: "1", round: "area", slot: "G17", a: "Larkspur Ridge", b: "Cedar Hollow", kickoff_utc, site_name, site_city: "Dalton" });
  const playoffs = [game("area", "2026-11-19", "Larkspur Ridge", "Cedar Hollow", "", "", "UIL", "I")];
  const same = slotDetailsOf(uilSlotRows([slot("2026-11-20T01:00:00Z", "Pine Stadium")]), playoffs);
  assert.deepEqual(missingDetails({ playoffs, details: details(), slotDetails: same, now: NOW }), []);
  // A kickoff on another day than the listed game is not used; the site still is.
  const other = slotDetailsOf(uilSlotRows([slot("2026-11-21T01:00:00Z", "Pine Stadium")]), playoffs);
  assert.deepEqual(lines(missingDetails({ playoffs, details: details(), slotDetails: other, now: NOW })), ["Larkspur Ridge v Cedar Hollow — UIL Division I area, Thu Nov 19: no kickoff"]);
});

test("a game outside the window, a scored game, a past game and a voided game are not named", () => {
  const playoffs = [
    game("area", "2026-11-20", "Larkspur Ridge", "Cedar Hollow"), // after the window
    game("area", "2026-11-15", "Willow Bend", "Amber Falls"), // before today
    game("area", "2026-11-17", "Pebble Creek", "Maple Run", "42", "14"), // scored
    game("area", "2026-11-17", "Fox Glen", "Birch Point"), // voided below
  ];
  const corrections = "game_date,home,away,action,home_score,away_score,source_url,reason,corrected_on\n2026-11-17,Birch Point,Fox Glen,void,,,,listed in error,2026-11-16";
  assert.deepEqual(missingDetails({ playoffs: withoutVoided(playoffs, corrections), details: details(), now: NOW }), []);
  assert.equal(withoutVoided(playoffs, corrections).length, 3);
  // A later correction that is not a void brings the game back.
  assert.equal(withoutVoided(playoffs, `${corrections}\n2026-11-17,Fox Glen,Birch Point,score,1,0,,fixed,2026-11-16`).length, 4);
});

test("a game dated today counts until it is scored; a known kickoff beyond the window leaves it out", () => {
  const today = game("area", "2026-11-16", "Larkspur Ridge", "Cedar Hollow");
  assert.equal(missingDetails({ playoffs: [today], details: details(), now: NOW }).length, 1);
  assert.equal(missingDetails({ playoffs: [{ ...today, home_score: "7", away_score: "0" }], details: details(), now: NOW }).length, 0);
  // Thursday is in the window by date, but this one kicks off Friday evening Central, past 72 hours.
  const late = game("area", "2026-11-19", "Willow Bend", "Amber Falls");
  const found = missingDetails({ playoffs: [late], details: details("2026-11-19,Willow Bend,Amber Falls,2026-11-20T01:30:00Z,,"), now: NOW });
  assert.equal(found.length, 0, "kickoff is 79.5 hours away");
  assert.equal(missingDetails({ playoffs: [late], details: details("2026-11-19,Willow Bend,Amber Falls,2026-11-19T12:00:00Z,,"), now: NOW }).length, 1);
});

test("a next-round pairing no listing holds is named when its round is dated within the window, missing both", () => {
  const slot = (round, s, a, b) => ({ division: "I", region: "1", round, slot: s, a, b, kickoff_utc: "", site_name: "", site_city: "" });
  const rows = uilSlotRows([slot("bi-district", "G1", "Lark", "Wren"), slot("bi-district", "G2", "Finch", "Heron"), slot("area", "G17", "winner:G1", "winner:G2"), slot("bi-district", "G3", "Owl", "Crane"), slot("bi-district", "G4", "Jay", "Kite"), slot("area", "G18", "winner:G3", "winner:G4")]);
  const playoffs = [
    game("bi-district", "2026-11-12", "Lark", "Wren", "50", "20", "UIL", "I"), game("bi-district", "2026-11-12", "Heron", "Finch", "6", "45", "UIL", "I"),
    game("bi-district", "2026-11-12", "Owl", "Crane", "30", "28", "UIL", "I"), game("bi-district", "2026-11-12", "Jay", "Kite", "3", "49", "UIL", "I"),
    game("area", "2026-11-18", "Owl", "Kite", "", "", "UIL", "I"), // G18 listed, dated, with a kickoff; G17 is the built pairing
  ];
  const built = builtDue(rows, playoffs);
  assert.deepEqual(built.map((b) => `${b.home} ${b.away}`), ["Lark Finch"]);
  const found = missingDetails({ playoffs, details: details("2026-11-18,Owl,Kite,2026-11-19T01:00:00Z,Pine Stadium,Dalton"), built, now: NOW });
  assert.deepEqual(lines(found), ["Lark v Finch — UIL Division I area, Wed Nov 18 (the round's date): no kickoff and no site"]);
  assert.equal(found[0].built, true);
  // No game of the round is dated within the window: nothing to say yet.
  assert.deepEqual(missingDetails({ playoffs: playoffs.slice(0, 4), details: details(), built, now: NOW }), []);
  // The file already has the pairing's own row: its date decides, and a row with a site and no kickoff misses only the kickoff.
  const hasRow = missingDetails({ playoffs: playoffs.slice(0, 4), details: details("2026-11-19,Finch,Lark,,Elm Stadium,Dalton"), built, now: NOW });
  assert.deepEqual(lines(hasRow), ["Lark v Finch — UIL Division I area, Thu Nov 19: no kickoff"]);
  // A row from before their last listed game is another game, not theirs.
  assert.deepEqual(missingDetails({ playoffs: playoffs.slice(0, 4), details: details("2026-11-10,Finch,Lark,,Elm Stadium,Dalton"), built, now: NOW }), []);
});

test("the last round is always State Championship, whatever the league calls it", () => {
  assert.equal(roundText("state"), "State Championship");
  assert.equal(roundText("final"), "State Championship");
  assert.equal(roundText("round-1"), "first round");
  const found = missingDetails({ playoffs: [game("final", "2026-11-18", "Tern Point", "Moss Bay", "", "", "TCAF", "Six-Man")], details: details(), now: NOW });
  assert.deepEqual(lines(found), ["Tern Point v Moss Bay — TCAF Six-Man State Championship, Wed Nov 18: no kickoff and no site"]);
});

test("dates read in Central time", () => {
  assert.equal(centralDate(Date.parse("2026-11-20T03:30:00Z")), "2026-11-19");
  assert.equal(dayLabel("2026-11-19"), "Thu Nov 19");
});

const fakeApi = ({ issue = null, comments = [] } = {}) => {
  const calls = { comment: [], open: [], label: 0 };
  return {
    calls,
    openIssue: async () => issue,
    comments: async () => comments,
    comment: async (n, body) => calls.comment.push([n, body]),
    open: async (body) => (calls.open.push(body), { number: 9 }),
    ensureLabel: async () => void calls.label++,
  };
};
const named = (...pairs) =>
  missingDetails({ playoffs: pairs.map(([h, a]) => game("area", "2026-11-18", h, a, "", "")), details: details(), now: NOW });
const post = (api, games, now = NOW) => postAlert({ api, games, now, log: () => {} });
const bot = (body, hoursAgo) => ({ body, created_at: new Date(NOW - hoursAgo * HOUR).toISOString(), user: { login: BOT } });

test("the comment names every game and carries no score, source or link", () => {
  const playoffs = [
    game("area", "2026-11-18", "Larkspur Ridge", "Cedar Hollow"), game("area", "2026-11-19", "Willow Bend", "Amber Falls"),
    game("area", "2026-11-17", "Pebble Creek", "Maple Run", "64", "14"), // scored: never in the list
  ];
  const games = missingDetails({ playoffs, details: details(), now: NOW });
  const body = bodyOf(games);
  for (const school of ["Larkspur Ridge", "Cedar Hollow", "Willow Bend", "Amber Falls"]) assert.match(body, new RegExp(school));
  assert.match(body, /\*\*2 playoff games within 72 hours have no kickoff or no site:\*\*/);
  assert.doesNotMatch(body, /Pebble|Maple|64|14\b/);
  assert.doesNotMatch(body, /https?:|www\./);
  assert.doesNotMatch(body, /\b(odds|favorite|underdog|spread|bet|wager|gambling)\b/i);
  assert.equal((body.match(/^- /gm) ?? []).length, 2);
  assert.match(keyIn(body), /^playoff-details\|[0-9a-f]{8},[0-9a-f]{8}$/);
});

test("quiet rule: no open issue opens one; the same games are not posted twice in 12 hours; a new game posts at once", async () => {
  const games = named(["Larkspur Ridge", "Cedar Hollow"]);
  const none = fakeApi();
  assert.equal(await post(none, games), "opened");
  assert.equal(none.calls.label, 1);
  assert.equal(none.calls.open.length, 1);

  const posted = bot(bodyOf(games), 5);
  const issue = { number: 4, body: "older", created_at: new Date(NOW - 99 * HOUR).toISOString(), user: { login: BOT } };
  const quiet = fakeApi({ issue, comments: [posted] });
  assert.equal(await post(quiet, games), "quiet");
  assert.equal(quiet.calls.comment.length, 0);

  // 12 hours later the same games post again.
  assert.equal(await post(fakeApi({ issue, comments: [bot(bodyOf(games), QUIET_HOURS + 0.5)] }), games), "commented");
  // A game that was not in the earlier post posts at once, and lists every game.
  const more = named(["Larkspur Ridge", "Cedar Hollow"], ["Willow Bend", "Amber Falls"]);
  const api = fakeApi({ issue, comments: [posted] });
  assert.equal(await post(api, more), "commented");
  assert.match(api.calls.comment[0][1], /Larkspur Ridge[\s\S]*Willow Bend/);
  // A game fixed since is not news: a shorter list of games already posted stays quiet.
  const both = bot(bodyOf(more), 2);
  assert.equal(await post(fakeApi({ issue, comments: [both] }), games), "quiet");
  // Another alert's comment, or a post by someone else, does not silence it.
  const other = { ...bot(bodyOf(games), 1), user: { login: "someone" } };
  const failure = bot("<!-- ops-alert key=Results%20watch%7Creason%3Aread-stuck -->", 1);
  assert.equal(await post(fakeApi({ issue, comments: [other, failure] }), games), "commented");
  assert.equal(recentIds({ issue, comments: [other, failure] }, NOW).size, 0);
});

test("no games, nothing posted", async () => {
  const api = fakeApi();
  assert.equal(await post(api, []), "nothing");
  assert.deepEqual([api.calls.open.length, api.calls.comment.length], [0, 0]);
});

test("game-details parsing keeps what the site keeps", () => {
  const d = details("2026-11-19,A,B,2026-11-20T01:00:00Z,Pine Stadium,Dalton", "bad-date,A,B,,,", "2026-11-19,C,D,not-a-time,,", "2026-11-19,E,F,,,");
  assert.equal(d.kickoffs.size, 1);
  assert.equal(d.sites.size, 1);
  assert.equal([...d.pairs.values()].flat().length, 1);
  assert.throws(() => parseDetails("date,home,away\n2026-11-19,A,B"), /unexpected header/);
});
