// A game the bracket sets keeps one page from the day both teams are known (ADR 0079): its id before any listing, once a
// listing holds it and once results-watch records its final are the same, whichever way round the listing or the final
// writes the two teams, so its comment thread (keyed by the page id) carries over and no second page appears.
//   node --test apps/web/scripts/
// Invented teams first; the last test runs the committed season's own bracket files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bracketSlots, builtGames, fill, pageOrders, ROUND_ORDER, uilSlotRows } from "../lib/bracket-fill.ts";
import { listingId, orderMap, pageId } from "../lib/page-id.ts";

const SEASON = 2026;
// A UIL-like region: two bi-district games feed one area game (G17 = winner G1 v winner G2), whose first side is G1's.
const SLOTS = [
  { league: "UIL", division: "I", round: "bi-district", slot: "G1", a: "Alpha", b: "Beta" },
  { league: "UIL", division: "I", round: "bi-district", slot: "G2", a: "Gamma", b: "Delta" },
  { league: "UIL", division: "I", round: "area", slot: "G17", a: "winner:G1", b: "winner:G2" },
];
const final = (round, home, away, homeScore, awayScore, date = "2026-11-13") => ({ round, date, home, away, homeScore, awayScore, confirmed: true });
const listed = (round, home, away, date = "2026-11-20") => ({ round, date, home, away, confirmed: false });
const FIRST = [final("bi-district", "Alpha", "Beta", 50, 20), final("bi-district", "Delta", "Gamma", 14, 60)];

/** The id the site gives a game, from the season's games as listed so far (lib/games.ts playoffIdOf, pure here). */
function idsOf(games) {
  const slots = bracketSlots(SLOTS, games, { league: "UIL", division: "I" });
  const filled = fill(slots, games, ROUND_ORDER);
  const orders = orderMap(pageOrders(slots, filled));
  return { orders, filled, idOf: (r) => pageId(SEASON, orders, r) };
}

test("before any listing: the game the bracket sets has its page at the bracket's order, home its slot's first side", () => {
  const { filled, orders } = idsOf(FIRST);
  const built = builtGames(filled);
  assert.deepEqual(built.map((b) => b.sides), [[{ team: "Alpha" }, { team: "Gamma" }]]);
  const [o] = orders.values();
  assert.deepEqual(o, { round: "area", home: "Alpha", away: "Gamma" });
  assert.equal(pageId(SEASON, orders, o), "2026-area-gamma-at-alpha");
});

test("a listing and then a recorded final the other way round keep the same id; the listing's own address redirects to it", () => {
  const before = idsOf(FIRST).idOf({ round: "area", home: "Alpha", away: "Gamma" });
  // The listing names Gamma home, and results-watch records the final the same way round.
  const listing = listed("area", "Gamma", "Alpha");
  const scored = final("area", "Gamma", "Alpha", 28, 42, "2026-11-20");
  for (const games of [[...FIRST, listing], [...FIRST, scored]]) {
    const { idOf, filled } = idsOf(games);
    const row = games.at(-1);
    assert.equal(idOf(row), before, `${row.home} v ${row.away}`);
    assert.notEqual(listingId(SEASON, row), before, "the listing's own order is the alias that redirects");
    assert.equal(builtGames(filled).length, 0, "a listed game is no longer one the bracket sets: one page, not two");
  }
});

test("a listing in the bracket's order has the same id and no alias", () => {
  const row = listed("area", "Alpha", "Gamma");
  const { idOf } = idsOf([...FIRST, row]);
  assert.equal(idOf(row), "2026-area-gamma-at-alpha");
  assert.equal(listingId(SEASON, row), idOf(row));
});

test("a listed game whose feeding final is not yet confirmed takes each side's team from the listing, so the id holds", () => {
  const unconfirmed = [final("bi-district", "Alpha", "Beta", 50, 20), { ...final("bi-district", "Delta", "Gamma", 14, 60), confirmed: false }];
  const row = listed("area", "Gamma", "Alpha");
  assert.equal(idsOf([...unconfirmed, row]).idOf(row), "2026-area-gamma-at-alpha");
});

test("a first-round game keeps its listing's order", () => {
  const row = FIRST[1];
  assert.equal(idsOf(FIRST).idOf(row), listingId(SEASON, row));
  assert.equal(idsOf(FIRST).idOf(row), "2026-bi-district-gamma-at-delta");
});

test("the committed season: every game the bracket sets keeps its id when a listing or final reverses its teams", () => {
  const seed = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/seed");
  const csv = (f) => {
    const [h, ...l] = readFileSync(path.join(seed, f), "utf8").trim().split("\n");
    const cols = h.split(",");
    return l.map((x) => Object.fromEntries(cols.map((c, i) => [c, x.split(",")[i] ?? ""])));
  };
  const slotRows = uilSlotRows(csv("uil-2026-28/bracket-2026.csv"));
  const games = csv("maxpreps-2026/playoffs.csv")
    .filter((r) => r.league === "UIL")
    .map((r) => ({ ...r, date: r.game_date, confirmed: r.home_score !== "", ...(r.home_score !== "" && { homeScore: +r.home_score, awayScore: +r.away_score }) }));
  let checked = 0;
  for (const division of ["I", "II"]) {
    // Played games only: a listing not yet played is exactly what this test adds, so the bracket sets every pairing still to come.
    const list = games.filter((g) => g.division === division && g.confirmed);
    const slots = bracketSlots(slotRows, list, { league: "UIL", division });
    const orders = orderMap(pageOrders(slots, fill(slots, list, ROUND_ORDER)));
    for (const { sides: [a, b], round } of builtGames(fill(slots, list, ROUND_ORDER))) {
      if (!("team" in a) || !("team" in b)) continue;
      const id = pageId(SEASON, orders, { round, home: a.team, away: b.team });
      // The same pairing listed, in either order, with its final recorded.
      for (const [home, away] of [[a.team, b.team], [b.team, a.team]]) {
        const row = { round, date: "2026-11-20", home, away, homeScore: 40, awayScore: 30, confirmed: true };
        const now = [...list, row];
        const s2 = bracketSlots(slotRows, now, { league: "UIL", division });
        assert.equal(pageId(SEASON, orderMap(pageOrders(s2, fill(s2, now, ROUND_ORDER))), row), id, `${division} ${round} ${away} at ${home}`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 10, `checked ${checked} pairings`);
});
