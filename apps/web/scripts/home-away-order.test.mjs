// One home side for a playoff game on every page (ADR 0079). The two robot files, games.csv and playoffs.csv, can name
// different home sides for one game (a night read records a final in the order its page gives, the bracket row was written
// earlier), so the site takes a playoff game's home and away from its page order and swaps a result's sides and scores to it.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bracketSlots, fill, pageOrders, ROUND_ORDER, uilSlotRows } from "../lib/bracket-fill.ts";
import { NO_CORRECTIONS } from "../lib/corrections.ts";
import { orderMap, sidesFlipped } from "../lib/page-id.ts";
import { buildSeasonResults } from "../lib/season-results.ts";
import { slugify } from "../lib/slug.ts";

const key = (date, a, b) => [date, ...[slugify(a), slugify(b)].sort()].join("|");

test("a result recorded the other way round from its page takes the page's home and away, scores with it, id unchanged", () => {
  const text = ["division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period",
    "I,season,2030-11-20,Alpha,Gamma,false,22,54,unknown,",
    "I,season,2030-11-20,Delta,Beta,false,7,40,unknown,",
    "I,season,2030-09-04,Alpha,Beta,false,1,0,unknown,"].join("\n");
  const sides = new Map([[key("2030-11-20", "Alpha", "Gamma"), { home: "Gamma", away: "Alpha" }], [key("2030-11-20", "Delta", "Beta"), { home: "Delta", away: "Beta" }]]);
  const { results } = buildSeasonResults(2030, text, NO_CORRECTIONS, new Map(), key, sides);
  const flipped = results.find((r) => r.date === "2030-11-20" && [r.home, r.away].includes("Gamma"));
  assert.deepEqual([flipped.home, flipped.away, flipped.homeScore, flipped.awayScore], ["Gamma", "Alpha", 54, 22]);
  assert.equal(flipped.id, "2030-11-20-gamma-at-alpha", "the id stays as the file wrote it, so keyed lookups still match");
  // Already in the page's order, and a game the page order does not name (a regular-season game): untouched.
  const same = results.find((r) => r.home === "Delta");
  assert.deepEqual([same.home, same.away, same.homeScore, same.awayScore], ["Delta", "Beta", 7, 40]);
  const season = results.find((r) => r.date === "2030-09-04");
  assert.deepEqual([season.home, season.away, season.homeScore, season.awayScore], ["Alpha", "Beta", 1, 0]);
  assert.equal(season.forfeit, true, "a forfeit stays a forfeit when the sides swap");
});

test("a swapped forfeit is still a forfeit", () => {
  const text = ["division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period", "I,season,2030-11-20,Alpha,Gamma,false,0,1,unknown,"].join("\n");
  const sides = new Map([[key("2030-11-20", "Alpha", "Gamma"), { home: "Gamma", away: "Alpha" }]]);
  const [r] = buildSeasonResults(2030, text, NO_CORRECTIONS, new Map(), key, sides).results;
  assert.deepEqual([r.home, r.homeScore, r.awayScore, r.forfeit], ["Gamma", 1, 0, true]);
});

test("the committed season: every playoff game in games.csv takes its page's home, from the data and never a named school", () => {
  const seed = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/seed");
  const text = (f) => readFileSync(path.join(seed, f), "utf8");
  const csv = (f) => {
    const [h, ...l] = text(f).trim().split("\n");
    const cols = h.split(",");
    return l.map((x) => Object.fromEntries(cols.map((c, i) => [c, x.split(",")[i] ?? ""])));
  };
  const slotRows = uilSlotRows(csv("uil-2026-28/bracket-2026.csv"));
  const playoffs = csv("maxpreps-2026/playoffs.csv");
  // The bracket's order for each UIL game it sets, as lib/brackets.ts finds it.
  const orders = [];
  for (const division of new Set(playoffs.filter((r) => r.league === "UIL").map((r) => r.division))) {
    const list = playoffs.filter((r) => r.league === "UIL" && r.division === division)
      .map((r) => ({ ...r, date: r.game_date, confirmed: r.home_score !== "", ...(r.home_score !== "" && { homeScore: +r.home_score, awayScore: +r.away_score }) }));
    const slots = bracketSlots(slotRows, list, { league: "UIL", division });
    orders.push(...pageOrders(slots, fill(slots, list, ROUND_ORDER)));
  }
  const byPair = orderMap(orders);
  // A playoff game's page order: the bracket's when it sets the game, else the playoffs.csv row's.
  const sides = new Map(playoffs.map((r) => [key(r.game_date, r.home, r.away), sidesFlipped(byPair, r) ? { home: r.away, away: r.home } : { home: r.home, away: r.away }]));
  const { results } = buildSeasonResults(2026, text("maxpreps-2026/games.csv"), NO_CORRECTIONS, new Map(), key, sides);
  const raw = new Map(csv("maxpreps-2026/games.csv").map((r) => [key(r.game_date, r.home, r.away), r]));
  let checked = 0;
  for (const r of results) {
    const want = sides.get(key(r.date, r.home, r.away));
    if (!want) continue;
    assert.equal(slugify(r.home), slugify(want.home), `${r.date} ${r.away} at ${r.home}`);
    // The scores went with the teams: each team's score is the one games.csv wrote for it.
    const from = raw.get(key(r.date, r.home, r.away));
    const scoreOf = (team) => Number(slugify(from.home) === slugify(team) ? from.home_score : from.away_score);
    assert.deepEqual([r.homeScore, r.awayScore], [scoreOf(r.home), scoreOf(r.away)]);
    checked += 1;
  }
  assert.ok(checked > 0, "some playoff game is in both files");
});
