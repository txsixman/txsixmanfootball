// Each page's <title> (lib/titles.ts): the words fans search for first, at most 60 characters, no winner, no score, no
// betting word, no source. Invented and real school names (titles carry no result).   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "titles-"));
const outfile = path.join(tmp, "titles.mjs");
await build({ entryPoints: [path.join(WEB, "lib/titles.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const t = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const BANNED = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?|won|beat|defeated|winner|victory)\b|maxpreps|hudl|calpreps|sixmanfootball|dave campbell|80x40/i;
const LONG = "Tyler Heat (Home Education Athletics of Tyler)";
const clean = (text) => {
  assert.ok(text.length > 0 && text.length <= 61, `${text.length} characters: ${text}`);
  assert.doesNotMatch(text, BANNED, text);
  assert.doesNotMatch(text, /\d+\s*[-–]\s*\d+/, `a score: ${text}`);
  assert.doesNotMatch(text, /\s{2,}|\s$|^\s/, `stray spaces: ${text}`);
  return text;
};

test("a program leads with the school, its mascot and 'football'", () => {
  assert.equal(clean(t.programTitle({ name: "Jayton", mascot: "Jaybirds", season: 2026 })), "Jayton Jaybirds football: 2026 schedule, scores, ranking");
  assert.equal(clean(t.programTitle({ name: "Jayton", mascot: null, season: 2026 })), "Jayton football: 2026 schedule, scores, ranking");
  // The mascot is not said twice when the name already ends with it.
  assert.match(t.programTitle({ name: "Fort Bend Chargers", mascot: "Chargers", season: 2026 }), /^Fort Bend Chargers football:/);
  // A long name drops the mascot, then the list, and still starts with the name.
  assert.match(clean(t.programTitle({ name: "Founders Classical Academy-Conroe", mascot: "Warriors", season: 2026 })), /^Founders Classical Academy-Conroe (Warriors )?football/);
  assert.ok(clean(t.programTitle({ name: LONG, mascot: "Heat", season: 2026 })).startsWith("Tyler Heat"));
});

test("a program's season page names the year after 'football'", () => {
  assert.equal(clean(t.programSeasonTitle({ name: "Jayton", mascot: "Jaybirds", season: 2025 })), "Jayton Jaybirds football 2025: schedule and scores");
  assert.ok(clean(t.programSeasonTitle({ name: LONG, mascot: "Heat", season: 2025 })).startsWith("Tyler Heat"));
});

test("a game reads as the search: 'A vs B football score, date'; a game to play is a preview", () => {
  assert.equal(clean(t.gameTitle({ away: "Kress", home: "Jayton", date: "Nov 13, 2026", scheduled: false })), "Kress vs Jayton football score, Nov 13, 2026");
  assert.equal(clean(t.gameTitle({ away: "Kress", home: "Jayton", date: "Nov 20, 2026", scheduled: true })), "Kress vs Jayton football preview, Nov 20, 2026");
  assert.equal(clean(t.gameTitle({ away: "Kress", home: "Jayton", scheduled: false })), "Kress vs Jayton football score");
  const long = clean(t.gameTitle({ away: "Valor North Austin", home: "Fort Bend Chargers", date: "Nov 6, 2026", scheduled: false }));
  assert.match(long, /^Valor North Austin vs Fort Bend Chargers/);
  assert.match(long, /Nov 6, 2026$/, "the date stays: each meeting's title is its own");
  assert.ok(clean(t.gameTitle({ away: LONG, home: "Texas Home Educator's Sports Association", date: "Nov 6, 2026", scheduled: false })).startsWith("Tyler Heat"));
});

test("a played final carries both scores, away team first, and the round or the date; a forfeit carries none", () => {
  const final = { away: 6, home: 75 };
  assert.equal(t.gameTitle({ away: "Kress", home: "Jayton", date: "Nov 13, 2026", scheduled: false, final, round: "UIL DI · Bi-district", season: 2026 }), "Kress 6, Jayton 75 · UIL Division I bi-district 2026");
  assert.equal(t.gameTitle({ away: "Kress", home: "Jayton", date: "Oct 3, 2025", scheduled: false, final }), "Kress 6, Jayton 75 · Oct 3, 2025");
  assert.equal(t.gameTitle({ away: "Guthrie", home: "Jayton", date: "Nov 6, 2026", scheduled: false, final, round: "TAIAO D1 · First round", season: 2026 }), "Guthrie 6, Jayton 75 · TAIAO Division 1 first round 2026");
  // Too long for the round: the date, then the score alone; the names always lead.
  const long = t.gameTitle({ away: "Valor North Austin", home: "Fort Bend Chargers", date: "Nov 6, 2026", scheduled: false, final: { away: 28, home: 12 }, round: "TAIAO D1 · First round", season: 2026 });
  assert.equal(long, "Valor North Austin 28, Fort Bend Chargers 12 · Nov 6, 2026");
  // Names too long for any of it keep both scores whole.
  assert.equal(
    t.gameTitle({ away: "The Emery/Weiner School-Houston", home: "Faith Academy of Bellville", date: "Aug 20, 2026", scheduled: false, final: { away: 48, home: 0 } }),
    "The Emery/Weiner School-Houston 48, Faith Academy of Bellville 0",
  );
  for (const text of [long, t.gameTitle({ away: "Kress", home: "Jayton", scheduled: false, final })]) {
    assert.ok(text.length <= 61, text);
    assert.doesNotMatch(text, BANNED, text);
  }
});

test("playoffs and brackets carry the season, the league and 'six-man'", () => {
  assert.equal(clean(t.playoffsTitle({ league: "UIL", season: 2026, past: false })), "2026 UIL six-man playoffs: Division I and II brackets");
  assert.equal(clean(t.playoffsTitle({ league: "TAPPS", season: 2026, past: false })), "2026 TAPPS six-man playoffs: brackets and scores");
  assert.equal(clean(t.playoffsTitle({ league: "TAIAO", season: 2024, past: true })), "2024 TAIAO six-man playoffs: every bracket and score");
  assert.equal(clean(t.bracketTitle({ name: "UIL Division I", season: 2026 })), "2026 UIL Division I six-man playoff bracket");
  assert.equal(clean(t.bracketTitle({ name: "TAPPS Division II", season: 2026 })), "2026 TAPPS Division II six-man playoff bracket");
});

test("section pages: scores, rankings, standings, results, records, champions", () => {
  assert.equal(clean(t.scoresTitle(2026)), "Texas six-man football scores: 2026 playoffs");
  assert.equal(clean(t.tonightTitle()), "Six-man football scores tonight, live");
  assert.equal(clean(t.rankingsTitle({ label: "UIL Division II", season: 2026 })), "2026 UIL Division II six-man football rankings");
  assert.equal(clean(t.rankingsTitle({ label: "TAPPS", season: 2026, week: 9 })), "TAPPS six-man rankings after week 9, 2026");
  assert.equal(clean(t.standingsTitle({ label: "UIL Division I", season: 2026 })), "2026 UIL Division I six-man football standings");
  assert.equal(clean(t.resultsTitle({ label: "UIL", season: 2025, week: 9, scope: "week" })), "UIL six-man football scores: 2025 week 9");
  assert.equal(clean(t.resultsTitle({ label: "TCAF", season: 2025, week: 12, scope: "season" })), "TCAF six-man football scores, 2025 season");
  assert.equal(clean(t.resultsTitle({ label: "Independent", season: 2026, week: 12, scope: "latest" })), "Independent six-man football scores this week");
  assert.equal(clean(t.recordsTitle("TAIAO")), "TAIAO six-man football records");
  assert.equal(clean(t.championshipsTitle({ first: 1938, latest: 2025 })), "UIL six-man state champions, 1938 to 2025");
  assert.equal(clean(t.championshipsTitle({})), "UIL six-man state champions");
  for (const s of [t.homeTitle(), t.programsTitle(), t.matchupTitle(), t.seriesTitle({ first: "Jayton", second: "Kress" })]) clean(s);
  assert.match(t.homeTitle(), /^TX Six-Man Football: /, "the home page's title starts with the site's name");
});
