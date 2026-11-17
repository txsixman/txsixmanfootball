// What the share images say, and their alt text (ADR 0093).
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { championshipCardText, gameCardText, kickerSize, programCardText, recordInWords } from "../lib/share-text.ts";

const final = { kicker: "UIL Division I · Quarterfinal", date: "2026-11-27", state: "final", forfeit: false, confirmed: true, away: { name: "Kress", score: 14 }, home: { name: "Jayton", score: 42 } };
const upcoming = {
  kicker: "TAIAO D1 · Semifinal", date: "2026-11-20", kickoff: "2026-11-21T01:30:00Z", site: "Texas Wind Stadium, Waco", state: "scheduled", forfeit: false, confirmed: false,
  away: { name: "Austin Royals", score: null, record: "5-4" }, home: { name: "Texas Wind", score: null, record: "9-1" },
};
// A bare "1-0" or "7-2" in text reads as a score, so alt text spells records and scores out.
const noDigitsDashDigits = (text) => assert.doesNotMatch(text, /\d-\d/);

test("a confirmed final shows both scores and says Final", () => {
  const t = gameCardText(final);
  assert.equal(t.status, "Final");
  assert.equal(t.scores, true);
  assert.equal(t.upcoming, false);
  assert.equal(t.when, undefined);
  assert.match(t.alt, /^Final score, UIL Division I · Quarterfinal, Friday, November 27, 2026: Kress 14, Jayton 42\.$/);
});

test("a score the sources do not agree on is reported, never final, and the alt text says so", () => {
  const t = gameCardText({ ...final, confirmed: false });
  assert.equal(t.status, "Score reported");
  assert.equal(t.scores, true);
  assert.match(t.alt, /^Score reported, not confirmed,/);
});

test("a forfeit shows no score and says so", () => {
  const t = gameCardText({ ...final, away: { name: "Kress", score: null }, home: { name: "Jayton", score: null }, forfeit: true });
  assert.equal(t.status, "Forfeit");
  assert.equal(t.scores, false);
  assert.match(t.alt, /a forfeit\. No score was played\./);
  assert.doesNotMatch(t.alt, /Kress \d|Jayton \d/);
});

test("a game still to play shows the matchup, day, kickoff in Central time, site and each record", () => {
  const t = gameCardText(upcoming);
  assert.equal(t.status, "Scheduled");
  assert.equal(t.scores, false);
  assert.equal(t.upcoming, true);
  assert.equal(t.when, "Fri, Nov 20 · 7:30 PM CT");
  assert.equal(t.site, "Texas Wind Stadium, Waco");
  assert.deepEqual(t.records, { away: "5-4", home: "9-1" });
  assert.equal(
    t.alt,
    "Scheduled, TAIAO D1 · Semifinal: Austin Royals versus Texas Wind, Friday, November 20, 2026 at 7:30 PM CT, at Texas Wind Stadium, Waco. Records: Austin Royals 5 wins and 4 losses; Texas Wind 9 wins and 1 loss.",
  );
  noDigitsDashDigits(t.alt);
});

test("a game still to play never carries a score, a winner or a leader, whatever the data holds", () => {
  const t = gameCardText({ ...upcoming, away: { ...upcoming.away, score: 7 }, home: { ...upcoming.home, score: 3 } });
  assert.equal(t.scores, false);
  assert.doesNotMatch(t.alt, /\bfinal\b|winner|\bwon\b|leading|leads/i);
  assert.doesNotMatch(t.alt, /Royals 7|Wind 3\b/);
});

test("what is not known yet is left off: no site, no time, no records, no date", () => {
  const t = gameCardText({ ...upcoming, kickoff: undefined, site: "Site not listed yet", away: { name: "Austin Royals", score: null, record: "" }, home: { name: "Texas Wind", score: null } });
  assert.equal(t.when, "Fri, Nov 20");
  assert.equal(t.site, undefined);
  assert.deepEqual(t.records, { away: undefined, home: undefined });
  assert.doesNotMatch(t.alt, /Records|Site not listed/);
  assert.equal(gameCardText({ ...upcoming, kickoff: undefined, date: undefined, site: "Neutral site or not listed" }).site, undefined);
  assert.match(gameCardText({ ...upcoming, kickoff: undefined, date: undefined }).alt, /date not listed yet/);
});

test("a postponed game and one under way say so, with no score", () => {
  assert.equal(gameCardText({ ...upcoming, state: "postponed" }).status, "Postponed");
  assert.equal(gameCardText({ ...upcoming, state: "live" }).status, "In progress");
  assert.equal(gameCardText({ ...upcoming, state: "live" }).scores, false);
});

test("a State Championship game's card alt names its champion", () => {
  const t = gameCardText({ ...final, kicker: "2026 TCAF State Championship", banner: "Faustina Academy · State Champion" });
  assert.match(t.alt, /: Kress 14, Jayton 42\. Faustina Academy · State Champion\.$/);
});

test("records are written out in words", () => {
  assert.equal(recordInWords("7-2"), "7 wins and 2 losses");
  assert.equal(recordInWords("1-0"), "1 win and 0 losses");
  assert.equal(recordInWords("0-1"), "0 wins and 1 loss");
  assert.equal(recordInWords("7-2-1"), "7 wins, 2 losses and 1 tie");
  assert.equal(recordInWords("7-2-2"), "7 wins, 2 losses and 2 ties");
  assert.equal(recordInWords("n/a"), "n/a");
});

const program = { name: "Jayton", mascot: "Jaybirds", group: "UIL Division I", place: "Region 1 · District 4", season: 2026, rank: "#6 in Division I", record: "10-1", latest: { score: "75-6", versus: "vs Kress" } };

test("a program card says the school, place, this season's rank and record, and its latest score", () => {
  const t = programCardText(program);
  assert.equal(t.kicker, "UIL Division I · Region 1 · District 4");
  assert.equal(t.standing, "2026 · #6 in Division I · 10-1");
  assert.equal(t.latest, "Latest score: 75-6 vs Kress");
  assert.equal(t.alt, "Jayton Jaybirds football, UIL Division I · Region 1 · District 4. 2026: ranked number 6 in Division I, 10 wins and 1 loss. Latest score: 75 to 6 vs Kress.");
  noDigitsDashDigits(t.alt);
});

test("a program card never names a winner, and a forfeit shows the word, not a score", () => {
  const forfeit = programCardText({ ...program, latest: { score: "Forfeit", versus: "at Kress" } });
  assert.equal(forfeit.latest, "Latest game: forfeit at Kress");
  assert.match(forfeit.alt, /Latest game: a forfeit at Kress\./);
  assert.doesNotMatch(`${programCardText(program).latest} ${programCardText(program).alt}`, /\bwon\b|\blost\b|winner|W-L/i);
});

test("a program with no rank, no record or no game leaves those lines off", () => {
  const t = programCardText({ ...program, rank: "Not ranked" });
  assert.equal(t.standing, "2026 · Not ranked · 10-1");
  assert.match(t.alt, /2026: not yet ranked, 10 wins and 1 loss\./);
  const bare = programCardText({ name: "Dell City", group: "UIL Division II", place: "", season: 2026 });
  assert.equal(bare.standing, undefined);
  assert.equal(bare.latest, undefined);
  assert.equal(bare.kicker, "UIL Division II");
  assert.equal(bare.alt, "Dell City football, UIL Division II.");
  assert.equal(programCardText({ ...program, group: "Independent", place: "Independent" }).kicker, "Independent");
});

const side = (text, known = true, record) => ({ text, known, record });
const championship = { title: "2026 TCAF State Championship", sides: [side("Harvest Lantana"), side("Faustina Academy")], date: "2026-11-14" };

test("a recorded State Championship names its champion and shows the score, the champion's on its own side", () => {
  const t = championshipCardText({ ...championship, final: { champion: "Faustina Academy", runnerUp: "Harvest Lantana", championScore: 60, runnerUpScore: 16, forfeit: false } });
  assert.equal(t.banner, "Faustina Academy · State Champion");
  assert.deepEqual(t.shown, [16, 60]);
  assert.equal(t.footer, "Final");
  assert.equal(t.when, undefined);
  assert.equal(t.alt, "2026 TCAF State Championship: Faustina Academy, State Champion. Final score 60 to 16 over Harvest Lantana, Saturday, November 14, 2026.");
  const first = championshipCardText({ ...championship, final: { champion: "Harvest Lantana", runnerUp: "Faustina Academy", championScore: 28, runnerUpScore: 21, forfeit: false } });
  assert.deepEqual(first.shown, [28, 21]);
});

test("a forfeited State Championship names its winner and shows no score", () => {
  const t = championshipCardText({ ...championship, final: { champion: "Faustina Academy", runnerUp: "Harvest Lantana", forfeit: true } });
  assert.deepEqual(t.shown, [null, null]);
  assert.equal(t.footer, "Forfeit");
  assert.match(t.alt, /A forfeit, no score was played over Harvest Lantana/);
});

test("a State Championship played but not confirmed shows the listed score and names no champion", () => {
  const t = championshipCardText({ ...championship, scores: [14, 20] });
  assert.equal(t.banner, undefined);
  assert.deepEqual(t.shown, [14, 20]);
  assert.equal(t.footer, "Score reported");
  assert.match(t.alt, /not confirmed: Harvest Lantana 14, Faustina Academy 20\. No champion is named yet\.$/);
});

test("a State Championship still to play: the matchup (open sides as the bracket words them), day, time, site and records", () => {
  const t = championshipCardText({
    title: "2026 UIL Division I State Championship",
    sides: [side("Winner of G29", false), side("Winner of G30", false)],
    date: "2026-12-16",
    kickoff: "2026-12-16T20:00:00Z",
    site: "AT&T Stadium, Arlington",
  });
  assert.equal(t.banner, undefined);
  assert.deepEqual(t.shown, [null, null]);
  assert.equal(t.footer, "Scheduled");
  assert.equal(t.when, "Wed, Dec 16 · 2:00 PM CT");
  assert.equal(t.site, "AT&T Stadium, Arlington");
  assert.equal(t.alt, "2026 UIL Division I State Championship: Winner of G29 versus Winner of G30, Wednesday, December 16, 2026 at 2:00 PM CT, at AT&T Stadium, Arlington.");
  const known = championshipCardText({ ...championship, sides: [side("Harvest Lantana", true, "9-2"), side("Faustina Academy", true, "11-0")] });
  assert.deepEqual(known.records, ["9-2", "11-0"]);
  assert.match(known.alt, /Records: Harvest Lantana 9 wins and 2 losses; Faustina Academy 11 wins and 0 losses\.$/);
  noDigitsDashDigits(known.alt);
});

test("the wording is always State Championship, never final round or title game", () => {
  const text = [
    championshipCardText({ ...championship, final: { champion: "Faustina Academy", runnerUp: "Harvest Lantana", championScore: 60, runnerUpScore: 16, forfeit: false } }).alt,
    championshipCardText(championship).alt,
  ].join(" ");
  assert.match(text, /State Championship/);
  assert.doesNotMatch(text, /final round|title game|championship game|state final/i);
});

test("the top line steps down with its length, larger when no date shares it", () => {
  assert.equal(kickerSize("2026 TCAF State Championship", false), 34);
  assert.ok(kickerSize("2026 TAPPS Division II Large School State Championship", false) < kickerSize("2026 TCAF State Championship", false));
  assert.ok(kickerSize("2026 TCAF State Championship", true) > kickerSize("2026 TCAF State Championship", false));
  assert.ok(kickerSize("2026 TAPPS Division II Large School State Championship", true) < kickerSize("2026 TCAF State Championship", true));
});
