// A playoff week end to end, with invented schools and a fake feed (no test calls any site): an area final recorded on
// Friday night, the regional pairing the bracket builds on Saturday, the Monday details read that fills its kickoff and
// site (never overwriting a kept value), and the game-day read that then sees the Thursday game that has a kickoff in the
// game details but no playoffs.csv row.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { uilSlotRows } from "../../apps/web/lib/bracket-fill.ts";
import { builtDue, playoffWeekCount } from "./bracket-due.mjs";
import { createClient, datedBuilt, DETAIL_COLUMNS, kickoffRows, kickoffTargets, liveAndUpcoming, mergeKickoffs, teamId, teamMaps } from "./davecampbells.mjs";
import { COLUMNS, datedBuiltRows, dueGames, mergeTonight, withBuiltRows } from "./maxpreps.mjs";
import { parseCsv } from "./store.mjs";

// UIL Division I, one region: eight teams, two area games, and the regional game those two feed.
const slot = (round, s, a, b) => ({ division: "I", region: "1", round, slot: s, a, b, kickoff_utc: "", site_name: "", site_city: "" });
const slotRows = uilSlotRows([
  slot("bi-district", "G1", "Lark", "Wren"), slot("bi-district", "G2", "Finch", "Heron"),
  slot("bi-district", "G3", "Owl", "Crane"), slot("bi-district", "G4", "Jay", "Kite"),
  slot("area", "G17", "winner:G1", "winner:G2"), slot("area", "G18", "winner:G3", "winner:G4"),
  slot("regional", "G25", "winner:G17", "winner:G18"),
]);

const HEADER = `league,${COLUMNS}`;
const game = (round, date, home, away, score = ["", ""]) => ["UIL", "I", round, date, home, away, "", score[0], score[1], score[0] === "" ? "" : "unknown", "", "", ""].join(",");
const csv = (...lines) => [HEADER, ...lines].join("\n") + "\n";
const rowsOf = (text) => parseCsv(text, "playoffs.csv").rows;

const BI_DISTRICT = [
  game("bi-district", "2026-11-13", "Lark", "Wren", ["50", "20"]), game("bi-district", "2026-11-13", "Finch", "Heron", ["45", "6"]),
  game("bi-district", "2026-11-13", "Owl", "Crane", ["30", "28"]), game("bi-district", "2026-11-13", "Jay", "Kite", ["33", "8"]),
];
const AREA_TO_PLAY = [game("area", "2026-11-20", "Lark", "Finch"), game("area", "2026-11-20", "Owl", "Jay")];
const AREA_FINAL = [game("area", "2026-11-20", "Lark", "Finch", ["42", "14"]), game("area", "2026-11-20", "Owl", "Jay", ["12", "35"])];

test("the area finals recorded on Friday night: on Saturday the regional pairing is built and counted as a playoff game still to play", () => {
  // Friday afternoon: the two area games are unscored, so they are the games still to play, and no regional pairing is built.
  const before = rowsOf(csv(...BI_DISTRICT, ...AREA_TO_PLAY));
  assert.deepEqual(builtDue(slotRows, before), []);
  assert.equal(playoffWeekCount(slotRows, before, "2026-11-20"), 2);
  // Past their night they are missing finals, not games still to play (the game-day reads look for those, not this count).
  assert.equal(playoffWeekCount(slotRows, before, "2026-11-23"), 0);

  // Saturday morning: both finals are in playoffs.csv. Lark and Jay won, so the bracket sets the regional game.
  const saturday = rowsOf(csv(...BI_DISTRICT, ...AREA_FINAL));
  assert.deepEqual(builtDue(slotRows, saturday), [{ league: "UIL", division: "I", round: "regional", game_date: "", home: "Lark", away: "Jay", home_score: "", away_score: "", built: true }]);
  assert.equal(playoffWeekCount(slotRows, saturday, "2026-11-21"), 1);
  // A listed regional game replaces the built one (never counted twice).
  const listed = rowsOf(csv(...BI_DISTRICT, ...AREA_FINAL, game("regional", "2026-11-27", "Jay", "Lark")));
  assert.deepEqual(builtDue(slotRows, listed), []);
  assert.equal(playoffWeekCount(slotRows, listed, "2026-11-21"), 1);
  // Once the regional game is scored too, no playoff game is left to place in this bracket: the details read is skipped.
  const played = rowsOf(csv(...BI_DISTRICT, ...AREA_FINAL, game("regional", "2026-11-27", "Jay", "Lark", ["14", "28"])));
  assert.equal(playoffWeekCount(slotRows, played, "2026-11-28"), 0);
});

test("the count on the command line reads the season's published files and prints a number", () => {
  const seed = mkdtempSync(path.join(tmpdir(), "playoff-week-"));
  mkdirSync(path.join(seed, "uil-2026-28"));
  mkdirSync(path.join(seed, "maxpreps-2026"));
  const cols = ["division", "region", "round", "slot", "a", "a_seed", "b", "b_seed", "kickoff_utc", "site_name", "site_city"];
  const bracket = [cols.join(","), ...slotRows.map((r) => [r.division, r.region ?? "", r.round, r.slot, r.a, "", r.b, "", "", "", ""].join(","))].join("\n") + "\n";
  writeFileSync(path.join(seed, "uil-2026-28", "bracket-2026.csv"), bracket);
  writeFileSync(path.join(seed, "maxpreps-2026", "playoffs.csv"), csv(...BI_DISTRICT, ...AREA_FINAL));
  const run = () => execFileSync(process.execPath, [path.join(import.meta.dirname, "bracket-due.mjs"), "--playoff-week", seed, "2026"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  assert.equal(run().trim(), "1");
  assert.throws(() => execFileSync(process.execPath, [path.join(import.meta.dirname, "bracket-due.mjs"), "--playoff-week", seed, "nope"], { stdio: "ignore" }));
});

/** The fake feed: each team asked about has an id, and only the one named in `item` has a game. */
function fakeFeed(item) {
  const calls = [];
  const answer = (data) => ({ status: 200, json: async () => ({ success: true, data }) });
  const ids = { "lark-owls": "11111111-1111-1111-1111-111111111111", "jay-jays": "22222222-2222-2222-2222-222222222222", "finch-falcons": "33333333-3333-3333-3333-333333333333" };
  const client = createClient({
    gapMs: 0,
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, agent: init.headers["user-agent"] });
      const team = /\/api\/public\/teams\/([a-z-]+)\?/.exec(url)?.[1];
      if (team && ids[team]) return answer({ teamId: ids[team] });
      if (url.includes("/api/public/game-schedules?")) return answer({ items: url.includes(`teamId=${ids["lark-owls"]}`) ? [item] : [] });
      return { status: 404, json: async () => ({}) };
    },
  });
  return { client, calls };
}

/** davecampbells.mjs's `--kickoffs` step, wired from its exported parts: the same targets, built pairings, dating, rows and merge. */
async function kickoffRead({ playoffs, detailsText, client, today }) {
  const { theirs, ours } = teamMaps({ lark: "lark-owls", jay: "jay-jays", finch: "finch-falcons" });
  const listed = kickoffTargets(playoffs, detailsText, today);
  const built = builtDue(slotRows, playoffs);
  const teams = [...new Set([...listed, ...built].map((r) => theirs.get(r.home.toLowerCase()) ?? theirs.get(r.away.toLowerCase())).filter(Boolean))];
  const items = [];
  for (const t of teams) {
    const id = await teamId(client, t, "season-1");
    if (id) items.push(...(await liveAndUpcoming(client, "season-1", id)));
  }
  const dated = datedBuilt(items, { built, ours, today });
  const fresh = kickoffRows(items, { due: [...listed, ...dated], ours });
  return { teams, dated, fresh, text: mergeKickoffs(detailsText, fresh) };
}

// Thursday Nov 26 at 7:00 PM Central (CST, UTC-6) is Friday 01:00 UTC.
const THURSDAY_GAME = {
  status: "Upcoming",
  scheduledKickoff: "2026-11-27T01:00:00.000Z",
  venue: { locationName: "Bird Field", city: "Lark" },
  participants: [
    { participantType: "HOME", websiteUrl: "https://www.davecampbells.com/team/jay-jays", schoolName: "Jay" },
    { participantType: "AWAY", websiteUrl: "https://www.davecampbells.com/team/lark-owls", schoolName: "Lark" },
  ],
};
const AREA_DETAIL = "2026-11-20,Lark,Finch,2026-11-21T01:00:00Z,Pine Stadium,Finch,,,\n";

test("the Monday details read dates the built regional pairing and fills its kickoff and site, asking the feed only for public paths", async () => {
  const monday = rowsOf(csv(...BI_DISTRICT, ...AREA_FINAL));
  const { client, calls } = fakeFeed(THURSDAY_GAME);
  const r = await kickoffRead({ playoffs: monday, detailsText: `${DETAIL_COLUMNS}\n${AREA_DETAIL}`, client, today: "2026-11-23" });
  assert.ok(r.teams.includes("lark-owls"), "the pairing's team is asked about");
  assert.ok(calls.length >= 2 && calls.length <= 2 * r.teams.length, "two requests a team at most, one at a time");
  assert.ok(calls.every((c) => c.url.startsWith("https://www.davecampbells.com/api/public/") && /^txsixmanfootball-results-reader\//.test(c.agent)));
  // The pairing took the feed's Central date (Thursday), and its row names the teams as the bracket does.
  assert.deepEqual(r.dated.map((d) => [d.game_date, d.home, d.away, d.round]), [["2026-11-26", "Lark", "Jay", "regional"]]);
  assert.equal(r.text, `${DETAIL_COLUMNS}\n${AREA_DETAIL}2026-11-26,Lark,Jay,2026-11-27T01:00:00Z,Bird Field,Lark,,,\n`);
  assert.doesNotMatch(r.text, /davecampbells|https?:|venue/i);
});

test("a kept value or a correction is never overwritten by the details read, nor by the commit step's merge", async () => {
  const monday = rowsOf(csv(...BI_DISTRICT, ...AREA_FINAL));
  const hand = `${DETAIL_COLUMNS}\n2026-11-26,Lark,Jay,,Hawk Stadium,Wren,,,\n`;
  const { client } = fakeFeed(THURSDAY_GAME);
  const r = await kickoffRead({ playoffs: monday, detailsText: hand, client, today: "2026-11-23" });
  // The kickoff was blank: it is filled. The site was filled by hand: it stays, and the feed's venue does not replace it.
  assert.equal(r.text, `${DETAIL_COLUMNS}\n2026-11-26,Lark,Jay,2026-11-27T01:00:00Z,Hawk Stadium,Wren,,,\n`);
  // A kickoff that is filled stays too, even when the feed now says another time.
  const kept = `${DETAIL_COLUMNS}\n2026-11-26,Lark,Jay,2026-11-27T00:00:00Z,Hawk Stadium,Wren,,,\n`;
  assert.equal((await kickoffRead({ playoffs: monday, detailsText: kept, client: fakeFeed(THURSDAY_GAME).client, today: "2026-11-23" })).text, kept);

  // The commit step (davecampbells.mjs --merge-details) lays the file the read wrote over the newest main's. Someone corrected
  // the site on main meanwhile, and the read's file has only what it found.
  const readFile = r.text;
  const newestMain = `${DETAIL_COLUMNS}\n2026-11-26,Lark,Jay,,Hawk Field,Wren,12 Main St,TX,79001\n`;
  const merged = mergeKickoffs(newestMain, parseCsv(readFile, "game details").rows);
  assert.equal(merged, `${DETAIL_COLUMNS}\n2026-11-26,Lark,Jay,2026-11-27T01:00:00Z,Hawk Field,Wren,12 Main St,TX,79001\n`);
  // Merging the same file again changes nothing.
  assert.equal(mergeKickoffs(merged, parseCsv(readFile, "game details").rows), merged);
});

test("Thanksgiving week: a Thursday game with a kickoff in the game details and no playoffs.csv row is a game-day game on Thursday", () => {
  const saturdayText = csv(...BI_DISTRICT, ...AREA_FINAL);
  const details = `${DETAIL_COLUMNS}\n${AREA_DETAIL}2026-11-26,Lark,Jay,2026-11-27T01:00:00Z,Bird Field,Lark,,,\n`;
  const built = builtDue(slotRows, rowsOf(saturdayText));
  // Without the fix: playoffs.csv has no row for it, so nothing is due, whatever the details say.
  assert.equal(dueGames(saturdayText, "2026-11-26").length, 0);
  // Thursday (the game night) and the three after it see it; Wednesday does not, and a pairing with no dated details never does.
  const thursday = withBuiltRows(saturdayText, built, details, "2026-11-26");
  assert.equal(thursday.added, 1);
  assert.deepEqual(dueGames(thursday.text, "2026-11-26").map((r) => [r.game_date, r.home, r.away, r.round]), [["2026-11-26", "Lark", "Jay", "regional"]]);
  assert.equal(dueGames(withBuiltRows(saturdayText, built, details, "2026-11-28").text, "2026-11-28").length, 1, "a Thursday final posted late is still looked for");
  assert.equal(withBuiltRows(saturdayText, built, details, "2026-11-25").added, 0);
  assert.equal(withBuiltRows(saturdayText, built, details, "2026-12-01").added, 0, "after the catch-up nights it leaves the list");
  assert.equal(withBuiltRows(saturdayText, built, `${DETAIL_COLUMNS}\n`, "2026-11-26").added, 0);
  assert.equal(withBuiltRows(saturdayText, built, "", "2026-11-26").text, saturdayText);
  // The row is a bracket game as any listing makes it: a league, division and round, no score.
  assert.match(thursday.text, /\nUIL,I,regional,2026-11-26,Lark,Jay,,,,,,,\n$/);
  assert.equal(datedBuiltRows(built, details, "2026-11-26")[0].home_score, "");

  // The read finds the final (the feed lists the teams the other way round) and fills the row; the pairing is then listed, not built.
  const bySlug = new Map([["lark", { school: "Lark", division: "I" }], ["jay", { school: "Jay", division: "I" }]]);
  const merged = mergeTonight({
    playoffsText: thursday.text,
    gamesText: `${COLUMNS}\n`,
    finals: [{ date: "2026-11-26", played: true, home: { slug: "jay", score: 14 }, away: { slug: "lark", score: 28 }, gameUrl: "https://www.maxpreps.com/tx/football/game/x/?c=t" }],
    bySlug,
  });
  assert.equal(merged.filled, 1);
  assert.match(merged.playoffs, /UIL,I,regional,2026-11-26,Lark,Jay,,28,14,unknown/);
  assert.equal(dueGames(merged.playoffs, "2026-11-26").length, 0);
  assert.deepEqual(builtDue(slotRows, rowsOf(merged.playoffs)), []);
  assert.equal(playoffWeekCount(slotRows, rowsOf(merged.playoffs), "2026-11-27"), 0);
});

test("a listing a correction voids is never looked for: it gets no final, so it would keep every tick reading for nothing", () => {
  // Nov 20, 2026: five TAIAO semifinal listings contradicted the league's own bracket and were voided in data/corrections.
  // Counted as due, they kept the game-day reads going (and reading their teams' pages) for three nights after the games.
  const friday = csv(game("area", "2026-11-20", "Lark", "Jay"), game("area", "2026-11-20", "Owl", "Finch"));
  const corrections = "game_date,home,away,action,home_score,away_score,source_url,reason,corrected_on\n2026-11-20,Finch,Owl,void,,,https://example.org,contradicts the bracket,2026-11-16\n";
  assert.deepEqual(dueGames(friday, "2026-11-20", 3, corrections).map((r) => r.home), ["Lark"]);
  assert.equal(dueGames(friday, "2026-11-20").length, 2, "with no corrections both are due");
  // Two nights later, once Lark v Jay has its final, nothing is due: the voided listing does not hold the reads open.
  const scored = csv(game("area", "2026-11-20", "Lark", "Jay", ["40", "20"]), game("area", "2026-11-20", "Owl", "Finch"));
  assert.equal(dueGames(scored, "2026-11-22", 3, corrections).length, 0);
  assert.equal(dueGames(scored, "2026-11-22").length, 1);
  // A later correction that restores the game (any action but void) makes it due again: the last correction wins.
  const restored = `${corrections}2026-11-20,Owl,Finch,score,,,https://example.org,listed again,2026-11-17\n`;
  assert.equal(dueGames(scored, "2026-11-22", 3, restored).length, 1);
});
