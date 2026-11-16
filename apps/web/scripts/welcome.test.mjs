// The landing page's words (lib/welcome.ts, ADR 0084), its title and description, and the first-visit script for the home
// page's "New here?" link: from the data, plain words, no winner, betting word or source.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "welcome-"));
const entry = path.join(tmp, "entry.ts");
writeFileSync(
  entry,
  ["welcome", "titles", "descriptions"].map((m) => `export * from ${JSON.stringify(path.join(WEB, "lib", `${m}.ts`))};`).join("\n"),
);
const outfile = path.join(tmp, "welcome.mjs");
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const w = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const BANNED = /\b(spreads?|odds|lines?|bets?|betting|picks?|underdogs?|favou?rites?|locks?|won|beat|defeated|winner|victory)\b|maxpreps|hudl|calpreps|sixmanfootball|dave campbell|brady|schulz|dcs2/i;
const clean = (text) => {
  assert.doesNotMatch(text, BANNED, text);
  assert.doesNotMatch(text, /\bfinals?\b/i, `the last round is the State Championship: ${text}`);
  assert.doesNotMatch(text, /\s{2,}|\s$|^\s|,,|\.\./, `stray spacing or punctuation: ${text}`);
  return text;
};

test("the live line: this round's games and tonight's, from the data", () => {
  assert.equal(
    clean(w.roundLine({ season: 2026, round: 46, leagues: ["UIL", "TAPPS", "TAIAO", "TCAF"], tonight: { title: "Friday, Nov 20", count: 12 }, seasonGames: 1200 })),
    "2026 playoffs this round: 46 games in UIL, TAPPS, TAIAO and TCAF. Tonight, Friday, Nov 20: 12 games.",
  );
  assert.equal(clean(w.roundLine({ season: 2026, round: 1, leagues: ["UIL"], tonight: { title: "Monday, Nov 16", count: 0 }, seasonGames: 0 })), "2026 playoffs this round: 1 game in UIL.");
});

test("out of the playoffs, tonight's games, else the season's count", () => {
  assert.equal(clean(w.roundLine({ season: 2026, round: 0, leagues: [], tonight: { title: "Friday, Sep 4", count: 1 }, seasonGames: 300 })), "Tonight, Friday, Sep 4: 1 game.");
  assert.equal(clean(w.roundLine({ season: 2027, round: 0, leagues: [], seasonGames: 1234 })), "2027 season: 1,234 games on record so far.");
});

test("brackets are named league by league, UIL by division, a league with none left out", () => {
  const brackets = [
    { name: "UIL Division I", league: "UIL" },
    { name: "UIL Division II", league: "UIL" },
    { name: "TAPPS Division I", league: "TAPPS" },
    { name: "TAPPS Division II", league: "TAPPS" },
    { name: "TCAF", league: "TCAF" },
  ];
  assert.equal(clean(w.bracketWords(brackets, ["UIL", "TAPPS", "TAIAO", "TCAF"])), "UIL Division I and II, TAPPS and TCAF");
  assert.equal(w.bracketWords([{ name: "UIL Division I", league: "UIL" }], ["UIL"]), "UIL");
  assert.equal(w.bracketWords([], ["UIL"]), "");
});

test("the numbers come from the facts, with thousands separated", () => {
  const n = w.welcomeNumbers({ programs: 279, games: 9876, seasons: 9, firstSeason: 2018, latestSeason: 2026, finals: 89, firstFinal: 1938, orgs: ["UIL", "TAPPS", "independents"] });
  assert.deepEqual(n.map((x) => x.value), ["279", "9,876", "9", "89"]);
  assert.equal(n[0].label, "programs in UIL, TAPPS and independents");
  assert.equal(n[1].label, "games with scores, 2018 to 2026");
  assert.equal(n[3].label, "UIL State Championship games since 1938");
  for (const x of n) clean(x.label);
});

test("title and description: at most 60 and 160 characters, plain words", () => {
  assert.ok(clean(w.welcomeTitle()).length <= 60);
  const d = clean(w.welcomeDescription(279, ["UIL", "TAPPS", "TAIAO", "TCAF", "independents"]));
  assert.ok(d.length <= 160, d);
  assert.match(d, /^Every Texas six-man football team and game, free: 279 programs in UIL, TAPPS, TAIAO, TCAF and independents\./);
});

/** Runs the home page's inline script against a stand-in for localStorage; says whether the page was marked returning. */
function firstVisit(store, { broken = false } = {}) {
  const attrs = {};
  const localStorage = {
    getItem: (k) => {
      if (broken) throw new Error("blocked");
      return k in store ? store[k] : null;
    },
    setItem: (k, v) => (store[k] = String(v)),
  };
  vm.runInNewContext(w.NEW_HERE_SCRIPT, { localStorage, document: { documentElement: { setAttribute: (k, v) => (attrs[k] = v) } }, JSON, Array });
  return { returning: "data-returning" in attrs, store };
}

test("the New here link: a first visit sees it once, a returning, following or signed-in browser never", () => {
  const fresh = firstVisit({});
  assert.equal(fresh.returning, false, "a first visit shows it");
  assert.equal(fresh.store[w.WELCOME_SEEN], "1", "and marks the browser seen");
  assert.equal(firstVisit(fresh.store).returning, true, "the next visit does not show it");
  assert.equal(firstVisit({ "followed-programs": JSON.stringify(["jayton"]) }).returning, true, "a browser following a team");
  assert.equal(firstVisit({ "followed-programs": "[]" }).returning, false, "an empty follow list is a first visit");
  assert.equal(firstVisit({ "account-hint": "1" }).returning, true, "a browser that was signed in");
  assert.equal(firstVisit({ "followed-programs": "not json" }).returning, false, "unreadable storage shows the link");
  assert.equal(firstVisit({}, { broken: true }).returning, false, "blocked storage shows the link");
});
