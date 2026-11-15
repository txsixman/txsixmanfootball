// A past season's game page address never carries its round (ADR 0069): a past bracket's rounds may be named again from
// the whole bracket, and every page a played playoff game had before must still be at the same address. Only the season
// under way gives a playoff game a round-bearing page (`<season>-<round>-<away>-at-<home>`, lib/games.ts playoffGameId).
// The rendered links of past bracket, season and team pages are checked in e2e/past-playoff-links.spec.ts (it needs the
// pages built, which these script tests cannot do).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NO_CORRECTIONS } from "../lib/corrections.ts";
import { buildSeasonResults } from "../lib/season-results.ts";
import { CURRENT_SEASON } from "../lib/season.ts";
import { slugify } from "../lib/slug.ts";

const seed = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/seed");
const key = (date, home, away) => [date, ...[slugify(home), slugify(away)].sort()].join("|");
const rows = (file) => {
  const [header, ...lines] = readFileSync(file, "utf8").trim().split("\n");
  const cols = header.split(",");
  return lines.map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(",")[i]])));
};
const past = readdirSync(seed).flatMap((d) => /^maxpreps-(\d{4})$/.exec(d)?.[1] ?? []).map(Number).filter((s) => s < CURRENT_SEASON);

test("a past playoff game's page is <date>-<away>-at-<home> whatever its round, so a renamed round moves no page", () => {
  let checked = 0;
  for (const season of past) {
    const dir = path.join(seed, `maxpreps-${season}`);
    if (!existsSync(path.join(dir, "playoffs.csv"))) continue;
    const text = readFileSync(path.join(dir, "games.csv"), "utf8");
    // What loadSeasonResults passes for a past season: no playoff pages, so the page comes from games.csv alone.
    const pages = new Map(buildSeasonResults(season, text, NO_CORRECTIONS, new Map(), key).results.map((r) => [key(r.date, r.home, r.away), r.href]));
    for (const r of rows(path.join(dir, "playoffs.csv")).filter((r) => r.home_score !== "")) {
      const href = pages.get(key(r.game_date, r.home, r.away));
      if (!href) continue; // a game against a school outside our alignments has no page of its own
      assert.doesNotMatch(href, new RegExp(`-${r.round}-`), `${season} ${r.league} ${r.division}: a page names its round`);
      assert.match(href, new RegExp(`^/scores/${r.game_date}-`), `${season} ${r.league} ${r.division}: not a date page`);
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} past playoff pages checked`);
});
