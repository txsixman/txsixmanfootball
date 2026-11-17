import { expect, test, type APIResponse, type Page } from "@playwright/test";
import path from "node:path";
import { noLiveScores } from "./live-route";

// Calendar feeds (ADR 0095): a program's games, a bracket's games and one game, each an iCalendar file made at build time, and the
// "Add to calendar" links to them. The feeds answer as text/calendar, parse as RFC 5545 (CRLF, folded lines of at most 75 octets,
// each event with a UID, a stamp, a start and a title "Away vs Home"), and never name a winner or use a betting word. The links
// are 44px targets. The game to add comes from the same files the site is built from; with none left to play the test skips.
noLiveScores(test);
test.setTimeout(120_000); // the dev server compiles each route the first time it is asked

const BAD_WORDS = /\b(winner|winners|leading|leads|odds|spreads?|lines?|picks?|bets?|locks?|maxpreps|hudl|calpreps|sixmanfootball)\b/i;

type Event = Record<string, string>;

/** The file as a calendar app reads it: the lines unfolded, and the events as property maps. Fails on anything RFC 5545 forbids. */
function parse(text: string): { name: string; events: Event[] } {
  expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  const physical = text.slice(0, -2).split("\r\n");
  for (const line of physical) expect(Buffer.byteLength(line), line).toBeLessThanOrEqual(75);
  const lines = physical.reduce<string[]>((out, l) => (l.startsWith(" ") ? [...out.slice(0, -1), out.at(-1)! + l.slice(1)] : [...out, l]), []);
  const events: Event[] = [];
  let name = "";
  for (const l of lines) {
    const i = l.indexOf(":");
    if (l === "BEGIN:VEVENT") events.push({});
    else if (l.startsWith("X-WR-CALNAME:")) name = l.slice(i + 1);
    else if (events.length && !/^(END:|BEGIN:)/.test(l)) events.at(-1)![l.slice(0, i)] = l.slice(i + 1);
  }
  expect(text.match(/BEGIN:VEVENT/g)?.length ?? 0).toBe(events.length);
  expect(text.match(/END:VEVENT/g)?.length ?? 0).toBe(events.length);
  return { name, events };
}

function checkFeed(res: APIResponse, text: string) {
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^text\/calendar/);
  const { name, events } = parse(text);
  expect(name).not.toBe("");
  expect(new Set(events.map((e) => e.UID)).size, "one UID a game").toBe(events.length);
  for (const e of events) {
    expect(e.UID).toMatch(/^[a-z0-9-]+@txsixmanfootball\.com$/);
    expect(e.DTSTAMP).toMatch(/^\d{8}T\d{6}Z$/);
    expect(e.SUMMARY).toMatch(/ vs /); // "Away vs Home"
    expect(e.SUMMARY).not.toMatch(/ at [A-Z]/);
    expect(Object.keys(e).some((k) => /^DTSTART(;VALUE=DATE)?$/.test(k)), "a start").toBe(true);
    expect(e.URL).toBe(`https://txsixmanfootball.com/scores/${e.UID.split("@")[0]}`);
    // The words the site writes, not a team's or a street's name (County Line Road is a place).
    expect(e.DESCRIPTION.split("\\n").filter((l) => !l.startsWith("Game page:")).join(" ")).not.toMatch(BAD_WORDS);
  }
  return { name, events };
}

/** A link's size, and that it is a tap target. */
async function tapTarget(page: Page, name: string | RegExp) {
  const link = page.getByRole("main").getByRole("link", { name }).first();
  await expect(link).toBeVisible();
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(43.5);
  expect(box.width).toBeGreaterThanOrEqual(43.5);
  return link;
}

test("a program's feed is a calendar of this season's games, and its page offers it twice: for iPhone and Mac, and as a file", async ({ page, request }) => {
  const res = await request.get("/programs/jayton/calendar.ics");
  const { name, events } = checkFeed(res, await res.text());
  expect(name).toMatch(/^Jayton \d{4} games$/);
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((e) => /Jayton/.test(e.SUMMARY))).toBe(true);
  expect(events.some((e) => /^Final: /.test(e.DESCRIPTION)), "a played game says its final").toBe(true);
  // A forfeit never shows its 1-0 or 2-0.
  for (const e of events.filter((x) => /^Forfeit/.test(x.DESCRIPTION))) expect(e.DESCRIPTION).not.toMatch(/\d/);

  expect((await page.goto("/programs/jayton"))?.status()).toBe(200);
  const subscribe = await tapTarget(page, /^Add to calendar/);
  expect(await subscribe.getAttribute("href")).toBe("webcal://txsixmanfootball.com/programs/jayton/calendar.ics");
  const file = await tapTarget(page, /^Calendar file/);
  expect(await file.getAttribute("href")).toBe("/programs/jayton/calendar.ics");
});

test("a bracket's feed holds its playoff games, and its page offers it", async ({ page, request }) => {
  const res = await request.get("/playoffs/bracket/uil-division-i/calendar.ics");
  const { name, events } = checkFeed(res, await res.text());
  expect(name).toBe("UIL Division I 2026 playoffs");
  expect(events.length).toBeGreaterThan(0);

  expect((await page.goto("/playoffs/bracket/uil-division-i"))?.status()).toBe(200);
  const subscribe = await tapTarget(page, /^Add to calendar/);
  expect(await subscribe.getAttribute("href")).toBe("webcal://txsixmanfootball.com/playoffs/bracket/uil-division-i/calendar.ics");
  const file = await tapTarget(page, /^Calendar file/);
  expect(await file.getAttribute("href")).toBe("/playoffs/bracket/uil-division-i/calendar.ics");
  expect((await page.request.get("/playoffs/bracket/tapps-division-i/calendar.ics")).status()).toBe(200);
});

/** A game still to play with a day, and one already played, from the files the site is built from. */
async function games() {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    const { loadAlignments } = await import("../lib/alignments");
    const { loadGames } = await import("../lib/games");
    const all = (await loadGames(await loadAlignments())).filter((g) => g.date);
    return { ahead: all.find((g) => g.state === "scheduled"), played: all.find((g) => g.state === "final") };
  } finally {
    process.chdir(was);
  }
}

test("a game still to play offers a one-game file, at its kickoff when one is listed", async ({ page, request }) => {
  const { ahead } = await games();
  test.skip(!ahead, "no playoff game is left to play (offseason, or every listed game is scored)");
  expect((await page.goto(`/scores/${ahead!.id}`))?.status()).toBe(200);
  const link = await tapTarget(page, /^Add to calendar$/);
  expect(await link.getAttribute("href")).toBe(`/scores/${ahead!.id}/calendar.ics`);
  const res = await request.get(`/scores/${ahead!.id}/calendar.ics`);
  const { events } = checkFeed(res, await res.text());
  expect(events).toHaveLength(1);
  expect(events[0].SUMMARY).toBe(`${ahead!.away.name} vs ${ahead!.home.name}`.replace(/[,;]/g, (c) => `\\${c}`));
  const day = ahead!.date!.replaceAll("-", "");
  if (ahead!.kickoff) expect(events[0].DTSTART).toBe(ahead!.kickoff.replace(/[-:]/g, ""));
  else expect(events[0]["DTSTART;VALUE=DATE"]).toBe(day);
});

test("a game already played offers no calendar link and has no file", async ({ page, request }) => {
  const { played } = await games();
  test.skip(!played, "no playoff game has been played yet");
  expect((await page.goto(`/scores/${played!.id}`))?.status()).toBe(200);
  await expect(page.getByRole("link", { name: /add to calendar/i })).toHaveCount(0);
  expect((await request.get(`/scores/${played!.id}/calendar.ics`)).status()).toBe(404);
});
