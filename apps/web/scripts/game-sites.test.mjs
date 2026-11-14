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
