// Game sites (lib/kickoffs.ts, ADR 0041): read from data/seed/game-details/<season>.csv with the kickoff times, matched by
// date and both teams in either order. A page says "<name>, <city>", the name alone with no city, and "Site not listed yet"
// with none; a missing file means nothing is known. Invented teams and places only.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The loader reads ../../data/seed/game-details from the web app's folder, so run it from a scratch tree of the same shape.
const root = mkdtempSync(path.join(tmpdir(), "game-sites-"));
mkdirSync(path.join(root, "apps/web"), { recursive: true });
mkdirSync(path.join(root, "data/seed/game-details"), { recursive: true });
writeFileSync(
  path.join(root, "data/seed/game-details/2031.csv"),
  [
    "date,home,away,kickoff_utc,site_name,site_city",
    "2031-11-14,Salt Fork,Cedar Gap,2031-11-15T01:00:00Z,Mesa Field,Red Bluff",
    "2031-11-14,Dry Wash,Owl Creek,,Prairie Bowl,",
    "2031-11-14,Lone Elm,Big Draw,2031-11-15T00:30:00Z,,",
  ].join("\n") + "\n",
);
// UIL's own bracket lists a kickoff and site for one area game (ADR 0047); the details file has none for it.
mkdirSync(path.join(root, "data/seed/uil-2030-32"), { recursive: true });
writeFileSync(
  path.join(root, "data/seed/uil-2030-32/bracket-2031.csv"),
  [
    "division,region,round,slot,a,a_seed,b,b_seed,kickoff_utc,site_name,site_city",
    "I,1,bi-district,G1,Salt Fork,W1,Cedar Gap,R2,,,",
    "I,1,bi-district,G2,Dry Wash,W3,Owl Creek,R4,,,",
    "I,1,bi-district,G3,Lone Elm,W2,Big Draw,R1,,,",
    "I,1,bi-district,G4,Kite Hill,W4,Sand Bend,R3,,,",
    "I,1,area,G17,winner:G1,,winner:G2,,2031-11-22T00:00:00Z,Mesa Field,Red Bluff",
    "I,1,area,G18,winner:G3,,winner:G4,,2031-11-23T00:00:00Z,Prairie Bowl,",
  ].join("\n") + "\n",
);
mkdirSync(path.join(root, "data/seed/maxpreps-2031"), { recursive: true });
writeFileSync(
  path.join(root, "data/seed/maxpreps-2031/playoffs.csv"),
  [
    "league,division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period",
    "UIL,I,area,2031-11-21,Owl Creek,Salt Fork,,,,,",
    // The bracket's kickoff is on Nov 22 (Central) but this listing says Nov 21: the listing's date stands, the site is used.
    "UIL,I,area,2031-11-21,Big Draw,Kite Hill,,,,,",
  ].join("\n") + "\n",
);
process.chdir(path.join(root, "apps/web"));
const { NO_SITE, kickoffOf, loadKickoffs, loadSites, siteOf } = await import("../lib/kickoffs.ts");

test("a game's site reads '<name>, <city>', whichever team is home", async () => {
  const sites = await loadSites(2031);
  assert.equal(siteOf(sites, "2031-11-14", "Salt Fork", "Cedar Gap"), "Mesa Field, Red Bluff");
  assert.equal(siteOf(sites, "2031-11-14", "Cedar Gap", "Salt Fork"), "Mesa Field, Red Bluff");
});

test("a site with no city is its name alone; a game with none says it is not listed yet", async () => {
  const sites = await loadSites(2031);
  assert.equal(siteOf(sites, "2031-11-14", "Dry Wash", "Owl Creek"), "Prairie Bowl");
  assert.equal(siteOf(sites, "2031-11-14", "Lone Elm", "Big Draw"), NO_SITE);
  assert.equal(NO_SITE, "Site not listed yet");
});

test("the kickoff and the site are read from the same row, each on its own", async () => {
  const kickoffs = await loadKickoffs(2031);
  assert.equal(kickoffOf(kickoffs, "2031-11-14", "Lone Elm", "Big Draw"), "2031-11-15T00:30:00Z");
  assert.equal(kickoffOf(kickoffs, "2031-11-14", "Dry Wash", "Owl Creek"), undefined);
});

test("no file: no site is known", async () => {
  const sites = await loadSites(2030);
  assert.equal(sites.size, 0);
  assert.equal(siteOf(sites, "2030-11-14", "Salt Fork", "Cedar Gap"), NO_SITE);
});

test("a kickoff and site from the league's own bracket fill a listed game the details file has nothing for (ADR 0047)", async () => {
  const [kickoffs, sites] = await Promise.all([loadKickoffs(2031), loadSites(2031)]);
  assert.equal(kickoffOf(kickoffs, "2031-11-21", "Owl Creek", "Salt Fork"), "2031-11-22T00:00:00Z");
  assert.equal(siteOf(sites, "2031-11-21", "Salt Fork", "Owl Creek"), "Mesa Field, Red Bluff");
  assert.equal(kickoffOf(kickoffs, "2031-11-21", "Big Draw", "Kite Hill"), undefined);
  assert.equal(siteOf(sites, "2031-11-21", "Big Draw", "Kite Hill"), "Prairie Bowl");
  // A kept detail is never overwritten.
  assert.equal(siteOf(sites, "2031-11-14", "Salt Fork", "Cedar Gap"), "Mesa Field, Red Bluff");
});
