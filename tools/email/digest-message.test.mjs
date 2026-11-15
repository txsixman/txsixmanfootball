import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigest, MAX_TEAMS, postalAddress, rankingLine } from "./digest-message.mjs";

const TOKEN = "cccccccc-0000-4000-8000-000000000001";
const ORIGIN = "https://txsixmanfootball.com";
const POSTAL = ["<postal address>"]; // a placeholder: no real address is committed
const section = (over = {}) => ({
  slug: "alpha", name: "Alpha",
  last: { kind: "result", date: "2026-11-13", home: "Alpha", away: "Beta", homeScore: 40, awayScore: 14 },
  ranking: { group: "Division I", place: 1, moved: 1, before: 2 },
  next: { date: "2026-11-20", kickoff: "2026-11-21T01:30:00Z", home: "Alpha", away: "Delta", round: "area", homeChance: 0.69 },
  ...over,
});
const off = { last: { kind: "none" }, ranking: undefined, next: undefined };
const build = (teams = [section(), section({ slug: "beta", name: "Beta", ...off })], extra = {}) => buildDigest({ teams, token: TOKEN, origin: ORIGIN, postal: POSTAL, ...extra });

test("the digest says the result, the ranking move and the next game with each side's chance to win, team by team", () => {
  const m = build();
  assert.equal(m.subject, "Your weekly team digest");
  assert.ok(m.text.startsWith([
    "Your weekly team digest", "", "Alpha", "Last week: Final score: Beta 14, Alpha 40.", "Ranking: #1 in Division I, up 1 place from #2.",
    "Next game: Delta vs Alpha (Area). Fri, Nov 20, 7:30 PM Central. Chance to win: Delta 31%, Alpha 69%.", "https://txsixmanfootball.com/programs/alpha", "",
  ].join("\n")), m.text);
  assert.match(m.text, /https:\/\/txsixmanfootball\.com\/programs\/alpha\n/);
  // A team with nothing says so, in the words the brief gives.
  assert.match(m.text, /Beta\nLast week: No game last week\.\nNext game: No game scheduled\.\nhttps/);
});

test("ranking move wording: up, down, the same, new, not ranked yet, no move known, and nothing when there is no data", () => {
  const g = "Division I";
  assert.equal(rankingLine({ group: g, place: 1, moved: 1, before: 2 }), "#1 in Division I, up 1 place from #2.");
  assert.equal(rankingLine({ group: g, place: 2, moved: 3, before: 5 }), "#2 in Division I, up 3 places from #5.");
  assert.equal(rankingLine({ group: g, place: 6, moved: -2, before: 4 }), "#6 in Division I, down 2 places from #4.");
  assert.equal(rankingLine({ group: "TAPPS", place: 4, moved: 0 }), "#4 in TAPPS, about the same as last week.");
  assert.equal(rankingLine({ group: g, place: 9, moved: "new" }), "#9 in Division I, new in the rankings.");
  assert.equal(rankingLine({ group: g, place: undefined, moved: undefined }), "Not ranked yet: too few games.");
  assert.equal(rankingLine({ group: g, place: 3, moved: undefined }), "#3 in Division I.");
  assert.equal(rankingLine(undefined), null);
  assert.doesNotMatch(build([section({ ranking: undefined })]).text, /Ranking:/);
});

test("a game with no date yet says so; an unconfirmed game says no confirmed result; no chance is shown for a team the ratings do not rate", () => {
  const m = build([section({ last: { kind: "unconfirmed" }, next: { home: "Beta", away: "Gamma", round: "regional", homeChance: undefined } })]);
  assert.match(m.text, /Last week: No confirmed result yet\./);
  assert.match(m.text, /Next game: Gamma vs Beta \(Regional\)\. Date to be listed\.\n/);
  assert.doesNotMatch(m.text, /Chance to win/);
  assert.match(build([section({ next: { ...section().next, kickoff: undefined, round: undefined } })]).text, /Delta vs Alpha\. Fri, Nov 20\. Chance to win/);
});

test("every digest carries RFC 8058 headers, links with the fan's token alone, the postal address, and says why they got it", () => {
  const m = build();
  assert.equal(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const u = new URL(/^<(https:\/\/[^>]+)>$/.exec(m.headers["List-Unsubscribe"])[1]);
  assert.equal(u.origin + u.pathname, "https://txsixmanfootball.com/api/email/unsubscribe");
  assert.deepEqual([...u.searchParams.entries()], [["t", TOKEN]]);
  assert.match(m.text, new RegExp(`Unsubscribe: https://txsixmanfootball\\.com/account/email/unsubscribe\\?t=${TOKEN}\\n`));
  assert.match(m.text, /You are getting this because you turned on the weekly digest on your account\.\nChange it: https:\/\/txsixmanfootball\.com\/account/);
  assert.ok(m.text.trimEnd().endsWith("<postal address>"), "the address ends the text");
  assert.ok(m.html.includes("unsubscribe</a>") && m.html.includes("&lt;postal address&gt;"));
  assert.ok(!m.text.includes("bbbbbbbb") && !m.text.includes("user_id"));
});

test("no betting word, no source's name, no address of a fan, whatever the teams are called", () => {
  const BETTING = /\b(spread|spreads|odds|betting|bet|bets|wager|parlay|line|lines|pick|picks|lock|locks|favou?rite|favou?rites|underdog|upset|payout)\b/i;
  const worst = [
    section(),
    section({ slug: "b", name: "Beta", last: { kind: "unconfirmed" }, ranking: { group: "TAPPS", place: 3, moved: -1, before: 2 }, next: { home: "B", away: "C", round: "state", homeChance: 0.999 } }),
    section({ slug: "c", name: "Gamma", ranking: { group: "Division II", place: undefined }, next: { date: "2026-11-20", home: "X", away: "Y", homeChance: 0.001 } }),
    section({ slug: "d", name: "Delta", ...off }),
  ];
  const m = build(worst);
  for (const part of [m.subject, m.text, m.html, JSON.stringify(m.headers)]) {
    assert.doesNotMatch(part, /@/);
    assert.doesNotMatch(part, /maxpreps|calpreps|(?<!tx)sixmanfootball\.com|hudl|tapps\.biz|taiao|uiltexas/i);
  }
  assert.doesNotMatch(m.text.replace(/Change it:|Unsubscribe:/g, ""), BETTING);
  assert.match(m.text, /Chance to win: C <1%, B >99%\./); // never 100% or 0%
  assert.match(m.text, /Chance to win: Y >99%, X <1%\./);
});

test("a team name cannot break the markup or inject a line; a long list is cut with a note", () => {
  const m = build([section({ name: 'A&B <script>"x"\r\nBcc: y', last: { kind: "result", date: "2026-11-13", home: "<b>H</b>", away: "A", homeScore: 1, awayScore: 3 } })]);
  assert.doesNotMatch(m.html, /<script>|<b>H/);
  assert.match(m.html, /A&amp;B &lt;script&gt;/);
  assert.doesNotMatch(m.text.split("\n")[2], /\r/);
  assert.doesNotMatch(m.subject + JSON.stringify(m.headers), /[\r\n]/);
  assert.equal(MAX_TEAMS, 25);
  assert.match(build([section()], { more: 3 }).text, /3 more teams you follow are on your account\./);
  assert.match(build([section()], { more: 1 }).text, /1 more team you follow is on your account\./);
});

test("the postal address is required: unset, empty or blank is refused; a multi-line address is kept as lines; markup or a wall of text is refused", () => {
  assert.deepEqual(postalAddress(undefined), { error: "not set" });
  assert.deepEqual(postalAddress(""), { error: "not set" });
  assert.deepEqual(postalAddress("  \n \r\n"), { error: "not set" });
  assert.deepEqual(postalAddress("<postal address>"), { error: "not a postal address a footer can hold" }); // a placeholder in angle brackets is not an address
  assert.deepEqual(postalAddress("Example Co\r\n  PO Box 1   \n\nTown, ST 00000"), { lines: ["Example Co", "PO Box 1", "Town, ST 00000"] });
  assert.ok(postalAddress("x".repeat(301)).error);
  assert.ok(postalAddress("1\n2\n3\n4\n5\n6").error);
  assert.ok(postalAddress("a <img src=x> b").error);
});
