// The weekly digest (tools/email/digest-data.mjs, ADR 0055) runs under plain Node, which cannot load lib/*.ts (they import each
// other without file extensions), so it carries copies of three of the site's rules: a team's rank and ranking move in its group
// (lib/rank-range.ts, lib/ratings.ts movement, lib/rankings.ts), and the chance to win (lib/projection.ts). This runs the site's own
// code and the digest's on the REAL data, for every team and every week of the season, and fails if they ever disagree.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { addDays, chanceText as digestChance, digestData, homeChance } from "../../../tools/email/digest-data.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "../..");
const tmp = mkdtempSync(path.join(tmpdir(), "digest-parity-"));
const entry = path.join(tmp, "entry.ts");
writeFileSync(
  entry,
  [
    `export { loadAlignments, programsFor } from ${JSON.stringify(path.join(WEB, "lib/alignments.ts"))};`,
    `export { placeRows, rankedOrder } from ${JSON.stringify(path.join(WEB, "lib/rank-range.ts"))};`,
    `export { placeTeams } from ${JSON.stringify(path.join(WEB, "lib/rankings.ts"))};`,
    `export { movement } from ${JSON.stringify(path.join(WEB, "lib/ratings.ts"))};`,
    `export { chanceText, project } from ${JSON.stringify(path.join(WEB, "lib/projection.ts"))};`,
  ].join("\n"),
);
const outfile = path.join(tmp, "site.mjs");
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
process.chdir(WEB); // lib/alignments.ts reads the seed files relative to the app
const site = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const SEASON = 2026;
const files = {
  read: (rel) => (existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), "utf8") : ""),
  list: (rel) => readdirSync(path.join(ROOT, rel)),
};
const table = JSON.parse(files.read(`data/ratings/${SEASON}.json`));

test("a team's rank and ranking move in its group are the site's, for every team in every week of the season", async () => {
  const alignments = await site.loadAlignments();
  const first = new Map();
  for (const a of alignments) if (!first.has(a.slug)) first.set(a.slug, a); // the digest takes a school's first alignment
  let compared = 0;
  for (const [index, sunday] of table.weeks.entries()) {
    // The week's rows the way lib/week-rankings.ts weekRows builds them from the trend.
    const rows = table.teams.flatMap((t) =>
      t.trend?.[index] == null ? [] : [{ team: t.team, rating: t.trend[index], was: index > 0 ? (t.trend[index - 1] ?? null) : undefined, rated: t.rated_trend?.[index] ?? 0 }],
    );
    const { placed } = site.placeTeams(rows, alignments);
    const data = digestData({ season: SEASON, today: addDays(sunday, 1), files });
    for (const r of placed) {
      if (first.get(r.school.slug) !== r.school) continue;
      // The group the rankings pages count in: a UIL six-man division, else the organization.
      const division = r.school.league === "UIL" && (r.school.division === "I" || r.school.division === "II");
      const group = placed.filter((o) => o.school.league === r.school.league && (!division || o.school.division === r.school.division));
      const place = site.placeRows(group).get(r.team)?.rank;
      const moved = site.movement(site.rankedOrder([...group]))?.get(r.team);
      const got = data.forTeam(r.school.slug).ranking;
      assert.deepEqual([got?.group, got?.place, got?.moved], [division ? `Division ${r.school.division}` : r.school.league, place, place === undefined ? undefined : moved], `${r.team}, week ending ${sunday}`);
      compared += 1;
    }
  }
  assert.ok(compared > 500, `compared ${compared} team-weeks`);
});

test("the chance to win is the site's projection, home side and away side, and reads the same", () => {
  const names = table.teams.map((t) => t.team);
  let compared = 0;
  for (let i = 0; i < names.length - 7; i += 3) {
    const [home, away] = [names[i], names[i + 7]];
    for (const [neutral, trueNeutral] of [[false, false], [true, false], [true, true]]) {
      const p = site.project(table, home, away, neutral, trueNeutral);
      const mine = homeChance(table, home, away, neutral, trueNeutral);
      assert.equal(p === undefined, mine === undefined);
      if (!p) continue;
      const siteHome = p.favorite === home ? p.winProbability : 1 - p.winProbability;
      assert.ok(Math.abs(siteHome - mine) < 1e-9, `${home} vs ${away}`);
      assert.equal(digestChance(mine), site.chanceText(siteHome));
      assert.equal(digestChance(1 - mine), site.chanceText(1 - siteHome));
      compared += 1;
    }
  }
  assert.ok(compared > 100, `compared ${compared} games`);
  // A table without the calibration falls back to the normal chance, in both.
  const { calibration, ...plain } = table;
  const p = site.project(plain, names[0], names[5], false);
  assert.ok(Math.abs((p.favorite === names[0] ? p.winProbability : 1 - p.winProbability) - homeChance(plain, names[0], names[5], false)) < 1e-9);
});
