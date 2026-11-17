// Calendar feeds (lib/calendar.ts, ADR 0095): the iCalendar file a phone subscribes to. Escaping, line folding, a stable UID,
// timed and all-day events, a forfeit and an unconfirmed score. Invented games only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarFile, calendarResponse, escapeText, fold, webcalUrl } from "../lib/calendar.ts";

const NOW = new Date("2026-11-16T15:30:00Z");
// Friday Nov 20, 2026, 7:00 PM Central is 01:00 UTC on the 21st.
const timed = { id: "2026-quarterfinal-cedar-gap-at-red-bluff-creek", date: "2026-11-20", kickoff: "2026-11-21T01:00:00Z", away: "Cedar Gap", home: "Red Bluff Creek", label: "UIL DI · Quarterfinal", status: "to-play" };
const allDay = { id: "2026-semifinal-salt-fork-at-pecan-valley", date: "2026-11-27", away: "Salt Fork", home: "Pecan Valley", label: "UIL DI · Semifinal", status: "to-play" };

/** The file's content lines as a calendar app reads them: split at CRLF, each folded line joined back. */
const unfold = (text) => text.split("\r\n").reduce((out, line) => (line.startsWith(" ") ? [...out.slice(0, -1), out.at(-1) + line.slice(1)] : [...out, line]), []);
const events = (text) => {
  const lines = unfold(text);
  const list = [];
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") list.push({});
    else if (l !== "END:VEVENT" && list.length && !l.startsWith("END:VCALENDAR")) {
      const i = l.indexOf(":");
      list.at(-1)[l.slice(0, i)] = l.slice(i + 1);
    }
  }
  return list;
};

test("the file is a calendar with CRLF line ends, a name and one event a game", () => {
  const text = calendarFile("Cedar Gap 2026 games", [timed, allDay], NOW);
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.doesNotMatch(text.replaceAll("\r\n", ""), /[\r\n]/);
  assert.ok(unfold(text).includes("X-WR-CALNAME:Cedar Gap 2026 games"));
  assert.equal(events(text).length, 2);
  assert.equal(text.match(/BEGIN:VEVENT/g).length, text.match(/END:VEVENT/g).length);
});

test("a game with a kickoff is a timed event in UTC, three hours long", () => {
  const [e] = events(calendarFile("x", [timed], NOW));
  assert.equal(e.DTSTART, "20261121T010000Z");
  assert.equal(e.DTEND, "20261121T040000Z");
  assert.equal(e.DTSTAMP, "20261116T153000Z");
});

test("a game with no kickoff is an all-day event on its date, ending the next day", () => {
  const [e] = events(calendarFile("x", [allDay], NOW));
  assert.equal(e["DTSTART;VALUE=DATE"], "20261127");
  assert.equal(e["DTEND;VALUE=DATE"], "20261128");
  assert.equal(e.DTSTART, undefined);
  // The month and the year roll over.
  const [dec] = events(calendarFile("x", [{ ...allDay, date: "2026-12-31" }], NOW));
  assert.equal(dec["DTEND;VALUE=DATE"], "20270101");
  // A kickoff that is not a UTC time is not used: the game stays all-day rather than at a wrong hour.
  const [bad] = events(calendarFile("x", [{ ...timed, kickoff: "7:00 PM" }], NOW));
  assert.equal(bad["DTSTART;VALUE=DATE"], "20261120");
});

test("the summary is Away vs Home, never at", () => {
  const [e] = events(calendarFile("x", [timed], NOW));
  assert.equal(e.SUMMARY, "Cedar Gap vs Red Bluff Creek");
  assert.doesNotMatch(calendarFile("x", [timed, allDay], NOW), / at [A-Z]/);
});

test("the UID comes from the game's id and does not change when the game is played or the file is rebuilt", () => {
  const before = events(calendarFile("x", [timed], NOW))[0];
  const played = { ...timed, status: "final", score: { away: 14, home: 28 } };
  const after = events(calendarFile("x", [played], new Date("2026-11-22T09:00:00Z")))[0];
  assert.equal(before.UID, `${timed.id}@txsixmanfootball.com`);
  assert.equal(after.UID, before.UID);
  // One file's UIDs are all different.
  const uids = events(calendarFile("x", [timed, allDay], NOW)).map((e) => e.UID);
  assert.equal(new Set(uids).size, 2);
  // The order of the games given does not change the file.
  assert.equal(calendarFile("x", [allDay, timed], NOW), calendarFile("x", [timed, allDay], NOW));
});

test("a game has its page's address, and a site as the location with its address when known", () => {
  const [e] = events(calendarFile("x", [{ ...timed, site: "Ram Field, Cedar Gap", address: "1 Mesa Rd, Cedar Gap, TX 79000" }], NOW));
  assert.equal(e.URL, `https://txsixmanfootball.com/scores/${timed.id}`);
  assert.equal(e.LOCATION, "Ram Field\\, Cedar Gap\\, 1 Mesa Rd\\, Cedar Gap\\, TX 79000");
  assert.match(e.DESCRIPTION, /Game page: https:\/\/txsixmanfootball\.com\/scores\//);
  const [bare] = events(calendarFile("x", [{ ...timed, site: "Ram Field, Cedar Gap" }], NOW));
  assert.equal(bare.LOCATION, "Ram Field\\, Cedar Gap");
  // No site known: no location line at all, not a guess.
  assert.equal(events(calendarFile("x", [timed], NOW))[0].LOCATION, undefined);
});

test("a game still to play says its kickoff, and when it is not listed says so", () => {
  assert.match(events(calendarFile("x", [timed], NOW))[0].DESCRIPTION, /^Kickoff 7:00 PM CT\.\\nUIL DI · Quarterfinal\\n/);
  assert.match(events(calendarFile("x", [allDay], NOW))[0].DESCRIPTION, /^Kickoff time not listed yet\./);
});

test("a confirmed final puts the score in the description, in words, away team first", () => {
  const [e] = events(calendarFile("x", [{ ...timed, status: "final", score: { away: 14, home: 28 } }], NOW));
  assert.match(e.DESCRIPTION, /^Final: Cedar Gap 14\\, Red Bluff Creek 28\./);
  // The summary stays the same title, so a played game is the same event.
  assert.equal(e.SUMMARY, "Cedar Gap vs Red Bluff Creek");
});

test("a score the sources have not backed says 'Score reported', never 'Final'", () => {
  const [e] = events(calendarFile("x", [{ ...timed, status: "reported", score: { away: 14, home: 28 } }], NOW));
  assert.match(e.DESCRIPTION, /^Score reported: Cedar Gap 14\\, Red Bluff Creek 28\./);
  assert.doesNotMatch(e.DESCRIPTION, /Final/);
});

test("a forfeit says so and shows no score, even if one was handed in", () => {
  const [e] = events(calendarFile("x", [{ ...timed, status: "forfeit", score: { away: 1, home: 0 } }], NOW));
  assert.match(e.DESCRIPTION, /^Forfeit\. No score was played\./);
  assert.doesNotMatch(e.DESCRIPTION, /Cedar Gap 1|Red Bluff Creek 0|1-0|Final/);
});

test("nothing in a feed names a winner or a leader, or uses a betting word", () => {
  const all = [timed, allDay, { ...timed, id: "a", status: "final", score: { away: 14, home: 28 } }, { ...timed, id: "b", status: "reported", score: { away: 3, home: 2 } }, { ...timed, id: "c", status: "forfeit" }];
  assert.doesNotMatch(calendarFile("x", all, NOW), /\b(won|beat|beats|defeated|wins|winner|leads?|leading|odds|spreads?|lines?|picks?|lock|bets?)\b/i);
});

test("a game with no date, or no real date, is left out", () => {
  const text = calendarFile("x", [{ ...timed, date: undefined }, { ...timed, id: "b", date: "2026-02-30" }, { ...timed, id: "c", date: "soon" }, allDay], NOW);
  assert.deepEqual(events(text).map((e) => e.UID), [`${allDay.id}@txsixmanfootball.com`]);
  assert.equal(events(calendarFile("x", [], NOW)).length, 0); // an empty feed is still a calendar
  assert.match(calendarFile("x", [], NOW), /^BEGIN:VCALENDAR[\s\S]*END:VCALENDAR\r\n$/);
});

test("escaping: backslash, semicolon, comma and a line break, and control characters dropped", () => {
  assert.equal(escapeText("a,b;c\\d"), "a\\,b\\;c\\\\d");
  assert.equal(escapeText("one\ntwo\r\nthree\rfour"), "one\\ntwo\\nthree\\nfour");
  assert.equal(escapeText("a\u0000b\u0007c\u007fd\te"), "abcd\te");
  // A team named with punctuation stays one line of the file, and a line break in a name cannot start a new property.
  const text = calendarFile("x", [{ ...timed, away: "St. Mary's, Inc; Academy", home: "Red\r\nBluff" }], NOW);
  const [e] = events(text);
  assert.equal(e.SUMMARY, "St. Mary's\\, Inc\\; Academy vs Red\\nBluff");
  assert.ok(!unfold(text).some((l) => l.startsWith("Bluff")));
});

test("folding: no line is over 75 octets, a fold is a CRLF and one space, and unfolding restores the line", () => {
  const long = "DESCRIPTION:" + "Cedar Gap, Red Bluff Creek ".repeat(12);
  const folded = fold(long);
  for (const l of folded.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75, l);
  assert.ok(folded.includes("\r\n "));
  assert.equal(unfold(folded)[0], long);
  assert.equal(fold("SHORT:line"), "SHORT:line");
  // Exactly 75 octets stays on one line; 76 folds.
  assert.equal(fold("A".repeat(75)).includes("\r\n"), false);
  assert.equal(fold("A".repeat(76)), `${"A".repeat(75)}\r\n A`);
});

test("folding never splits a multi-byte character", () => {
  const line = "SUMMARY:" + "Peña Blanca é".repeat(20) + "\u{1F3C8}".repeat(10);
  const folded = fold(line);
  for (const l of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(l) <= 75, l);
    assert.ok(!l.includes("�"));
  }
  assert.equal(unfold(folded)[0], line);
});

test("a whole feed has no line over 75 octets", () => {
  const long = { ...timed, site: "A Very Long Stadium Name That Goes On, Somewhere Far Away", address: "12345 Farm to Market Road 1234 - Gate 2, Somewhere Far Away, TX 79999", label: "TAPPS DII Large School · State Championship" };
  const text = calendarFile("TAPPS Division II Large School 2026 playoffs and a name that goes on and on and on", [long, { ...long, id: "z", status: "final", score: { away: 14, home: 28 } }], NOW);
  for (const l of text.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75, l);
});

test("the subscribe address swaps https for webcal and keeps the path", () => {
  assert.equal(webcalUrl("/programs/jayton/calendar.ics"), "webcal://txsixmanfootball.com/programs/jayton/calendar.ics");
});

test("a feed answers as a calendar and stays out of search", async () => {
  const res = calendarResponse("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
});
