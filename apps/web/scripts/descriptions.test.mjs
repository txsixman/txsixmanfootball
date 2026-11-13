// Each page's meta description (lib/descriptions.ts): at most 160 characters, no winner, no score, no betting word, one organization
// at a time. Invented schools only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "descriptions-"));
const outfile = path.join(tmp, "descriptions.mjs");
await build({ entryPoints: [path.join(WEB, "lib/descriptions.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const d = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const BANNED = /\b(spreads?|odds|lines?|bets?|betting|underdogs?|favou?rites?|locks?|won|beat|defeated|winner|victory|unconfirmed)\b|maxpreps|hudl|calpreps|sixmanfootball|80x40/i;
const LONG = "Tyler Heat (Home Education Athletics of Tyler) at Texas Home Educator's Sports Association (THESA) Longview";
const clean = (text) => {
  assert.ok(text.length > 0 && text.length <= 160, `${text.length} characters: ${text}`);
  assert.doesNotMatch(text, BANNED, text);
  assert.doesNotMatch(text, /\s{2,}|\s$|^\s/, `stray spaces: ${text}`);
  return text;
};

test("a program: record, rank in its own group, state titles, place, and a closing line", () => {
  const jayton = { name: "Jayton", group: "UIL Division II", place: "Region 1 · District 4", season: 2026, since: 2021, titles: 0, team: { record: "9-1", rank: d.rankPhrase("#3 in Division II") } };
  assert.equal(clean(d.programDescription(jayton)), "Jayton six-man football: 2026 record 9-1, 3rd in UIL Division II. Region 1, District 4. Schedule, scores, ratings and playoff history since 2021.");
  assert.match(d.programDescription({ ...jayton, titles: 1 }), /: 2026 record 9-1, 3rd in UIL Division II\. 1 UIL state title\. Region 1/);
  assert.match(d.programDescription({ ...jayton, titles: 4 }), /4 UIL state titles\./);
});

test("a program with no game yet, no districts, or a long name still fits and still names itself", () => {
  const bare = { name: "CenTex Chargers", group: "Independent", place: "Independent", season: 2026, since: 2021, titles: 0 };
  assert.equal(clean(d.programDescription(bare)), "CenTex Chargers six-man football in Independent. Schedule, scores, ratings and playoff history since 2021.");
  const long = d.programDescription({ ...bare, name: "Victory Christian Academy-Decatur", group: "TAPPS", place: "Region 1 · District 2", titles: 12, team: { record: "10-0-1", rank: d.rankPhrase("#13 in TAPPS") } });
  assert.match(long, /^Victory Christian Academy-Decatur six-man football: 2026 record 10-0-1, 13th in TAPPS\./);
  assert.ok(long.length <= 160, long);
  assert.ok(clean(d.programDescription({ ...bare, name: LONG, team: { record: "10-0-1", rank: "not yet ranked" } })).startsWith("Tyler Heat"));
});

test("rankPhrase turns the program header's rank text into words, and says UIL for its divisions", () => {
  assert.equal(d.rankPhrase("#1 in Division I"), "1st in UIL Division I");
  assert.equal(d.rankPhrase("#12 in TAPPS"), "12th in TAPPS");
  assert.equal(d.rankPhrase("#22 in TCAF"), "22nd in TCAF");
  assert.equal(d.rankPhrase("Not ranked"), "not yet ranked");
});

test("a game names its teams, date and round, never a score or a winner", () => {
  const base = { away: "Roby", home: "Jayton", date: "Oct 24, 2025", season: 2025, scheduled: false };
  assert.equal(clean(d.gameDescription(base)), "Roby at Jayton, Oct 24, 2025: 2025 season game. Each team's record going in and their earlier meetings.");
  assert.equal(
    clean(d.gameDescription({ ...base, playoff: "UIL DI · Bi-district", scheduled: true })),
    "Roby at Jayton, Oct 24, 2025: 2025 UIL Division I bi-district playoff game. A preview with each team's record and rating.",
  );
  assert.match(d.gameDescription({ ...base, playoff: "TAIAO D1 · Quarterfinal" }), /2025 TAIAO Division 1 quarterfinal playoff game\./);
  assert.match(d.gameDescription({ ...base, playoff: "TAPPS Division II · Semifinal" }), /2025 TAPPS Division II semifinal playoff game\./);
  assert.match(d.gameDescription({ ...base, playoff: "TCAF · State final" }), /2025 TCAF state final playoff game\./);
  assert.doesNotMatch(d.gameDescription({ ...base, date: undefined }), /undefined|, :/);
  assert.match(clean(d.gameDescription({ away: "Cedar Gap", home: "Salt Fork", season: 2026, scheduled: false, sample: true })), /invented schools: Cedar Gap at Salt Fork/);
});

test("a game with very long names drops the round, then the date, before it cuts a name", () => {
  const text = clean(d.gameDescription({ away: LONG, home: "Austin Royals", date: "Nov 14, 2026", season: 2026, playoff: "TAIAO D1 · Quarterfinal", scheduled: true }));
  assert.ok(text.startsWith(LONG), text);
  assert.doesNotMatch(text, /…/);
});

test("every other page kind fits, names its organization and season, and differs from its neighbors", () => {
  const all = [];
  for (const org of ["UIL", "UIL Division I", "UIL Division II", "TAPPS", "TAIAO", "TCAF", "Independent"]) {
    for (const season of [2021, 2026]) {
      all.push(
        d.rankingsDescription({ label: org, season, games: 1210, past: season < 2026 }),
        d.rankingsWeekDescription({ label: org, season, week: 9 }),
        d.standingsDescription({ label: org, season, teams: 79, groups: 16, districtPlay: true }),
        d.standingsDescription({ label: org, season, teams: 46, groups: 6, districtPlay: false }),
        d.playoffsDescription({ league: org, season, brackets: 3, past: season < 2026 }),
        d.bracketDescription({ name: `${org} Division III Large School`, season, latestRound: "Quarterfinal" }),
        d.recordsDescription({ org, first: 2021, latest: season }),
        d.weeksIndexDescription({ org, first: 2021, latest: season }),
        d.weekReviewDescription({ org, season, week: 12, games: 148 }),
        d.seasonDescription({ season, games: 1210, orgs: [org], past: season < 2026 }),
        ...["latest", "season", "week"].map((scope) => d.resultsDescription({ org, season, week: 10, games: 27, scope })),
      );
    }
  }
  all.push(
    d.homeDescription(2026, ["UIL", "TAPPS", "TAIAO", "TCAF", "Independent"]), d.scoresDescription(2026), d.matchupDescription(2026), d.howRankingsDescription(),
    d.programsDescription(280, ["UIL", "TAPPS", "TAIAO", "TCAF", "Independent"]), d.championshipsDescription({ first: 1972, latest: 2025, games: 74 }),
    d.seasonsIndexDescription({ first: 2021, latest: 2026 }),
  );
  all.forEach(clean);
  assert.equal(new Set(all).size, all.length, "two descriptions alike");
  assert.match(d.rankingsDescription({ label: "TAPPS", season: 2024, games: 1163, past: true }), /^TAPPS six-man rankings for 2024, final: .*1,163 games/);
  assert.match(d.standingsDescription({ label: "TAIAO", season: 2026, teams: 46, groups: 6, districtPlay: false }), /46 teams in 6 groups, by division and region/);
});

test("an empty week or season reads plainly", () => {
  assert.equal(d.resultsDescription({ org: "TAPPS", season: 2026, week: 13, games: 0, scope: "latest" }), "Latest TAPPS six-man results: 2026 week 13, no games.");
  assert.equal(d.resultsDescription({ org: "UIL", season: 2026, week: 3, games: 1, scope: "week" }).slice(0, 39), "UIL 2026 week 3 six-man results: 1 game");
  assert.equal(d.recordsDescription({ org: "Independent", first: 2026, latest: 2026 }).slice(0, 44), "Independent six-man records for 2026: most p");
  assert.equal(d.championshipsDescription({ games: 0 }), "Every UIL six-man state championship game. Division I and Division II since 2006, and the programs with the most state titles.");
});

test("a series: meetings since 2021, what the page lists, no score and no winner, and it fits with long names", () => {
  const facts = { first: "Aldine", second: "Brookfield", games: 7, since: 2021, playoff: true, projection: true };
  assert.equal(clean(d.seriesDescription(facts)), "Aldine vs Brookfield six-man football: 7 meetings since 2021. Every score and playoff game, and a projection if they met now.");
  assert.equal(clean(d.seriesDescription({ ...facts, playoff: false })), "Aldine vs Brookfield six-man football: 7 meetings since 2021. Every score, and a projection if they met now.");
  assert.equal(clean(d.seriesDescription({ ...facts, projection: false, games: 3 })), "Aldine vs Brookfield six-man football: 3 meetings since 2021. Every score and playoff game.");
  const long = clean(d.seriesDescription({ ...facts, first: LONG, second: "Another Very Long Academy Name (Christian) Homeschool Association" }));
  assert.ok(long.startsWith("Tyler Heat"), long);
});

test("a season hub: games read, the organizations, and what the page holds; past and current read differently", () => {
  const orgs = ["UIL", "TAPPS", "TAIAO", "TCAF"];
  assert.equal(
    clean(d.seasonDescription({ season: 2025, games: 1230, orgs, past: true })),
    "2025 Texas six-man football season: 1,230 games across UIL, TAPPS, TAIAO and TCAF. State finals, final rankings, team leaders and every week of results.",
  );
  assert.equal(
    clean(d.seasonDescription({ season: 2026, games: 1227, orgs, past: false })),
    "2026 Texas six-man football season: 1,227 games across UIL, TAPPS, TAIAO and TCAF. Rankings so far, team leaders and every week of results.",
  );
  assert.match(clean(d.seasonDescription({ season: 2026, games: 1, orgs: ["Independent"], past: false })), /: 1 game across Independent\./);
  assert.equal(clean(d.seasonsIndexDescription({ first: 2021, latest: 2026 })), "Every Texas six-man football season on this site, 2021 to 2026. Each season's state finals, rankings, team leaders and week-by-week results.");
  assert.equal(clean(d.seasonsIndexDescription({})), "Every Texas six-man football season on this site. Each season's state finals, rankings, team leaders and week-by-week results.");
});

test("a program's season: record and rank, the round it reached, what the page lists; no score and no winner; it fits with a long name", () => {
  const facts = { name: "Jayton", season: 2024, games: 15, record: "13-2", rank: { place: 2, org: "UIL" }, playoff: "the state final" };
  assert.equal(
    clean(d.programSeasonDescription(facts)),
    "Jayton 2024 six-man football: 13-2, 2nd in UIL. Playoffs: reached the state final. Every game, with its date, opponent and a projected margin.",
  );
  assert.equal(clean(d.programSeasonDescription({ ...facts, rank: undefined, playoff: undefined })), "Jayton 2024 six-man football: 13-2. Every game, with its date, opponent and a projected margin.");
  assert.equal(clean(d.programSeasonDescription({ name: "Dell City", season: 2022, games: 1 })), "Dell City 2022 six-man football: 1 game. Every game, with its date, opponent and a projected margin.");
  const long = clean(d.programSeasonDescription({ ...facts, name: LONG }));
  assert.ok(long.startsWith(LONG), long);
  assert.doesNotMatch(long, /…/);
  assert.doesNotMatch(d.programSeasonDescription(facts), /\b(won|beat|winner)\b|\d\s*[-–]\s*\d\d/);
});
