// A State Championship the bracket sets but no site lists yet (lib/championship-sides.ts): each side is the team of the slot that
// holds it, whichever slot the known team sits in. TAIAO Division 3, Nov 21, 2026: Grace Classical Academy (winner of SF2, the
// final's second slot) showed on both sides, and its game link went to a page that did not exist.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { builtGames, fill, ownSlots, pageOrders, ROUND_ORDER } from "../lib/bracket-fill.ts";
import { treeGames } from "../lib/bracket-tree.ts";
import { championshipGameHref, championshipSides } from "../lib/championship-sides.ts";

const rows = [
  ["semifinal", "SF1", "Austin Royals", "Hill Country"], ["semifinal", "SF2", "Grace Classical Academy", "Trinity Christian"],
  ["final", "FINAL", "winner:SF1", "winner:SF2"],
].map(([round, slot, a, b]) => ({ league: "TAIAO", division: "3", round, slot, a, b }));
const slots = ownSlots(rows, { league: "TAIAO", division: "3" });
const game = (home, away, score) => ({ round: "semifinal", date: "2026-11-20", home, away, confirmed: !!score, ...(score ? { homeScore: score[0], awayScore: score[1] } : {}) });
const SF1 = (score) => game("Austin Royals", "Hill Country", score);
const SF2 = (score) => game("Grace Classical Academy", "Trinity Christian", score);

/** What championshipOf builds for the bracket's final from these listed games. */
function final(games) {
  const node = treeGames(slots, games, ROUND_ORDER).find((n) => n.round === "final");
  const filled = fill(slots, games, ROUND_ORDER);
  const built = builtGames(filled).find((g) => g.round === "final");
  const sides = championshipSides(node, built);
  return { sides, href: built ? championshipGameHref(2026, "final", sides, pageOrders(slots, filled)) : undefined };
}

test("the known team in the first slot: it, then the words of the other slot", () => {
  const { sides, href } = final([SF1([40, 20]), SF2()]);
  assert.deepEqual(sides[0], { team: "Austin Royals", text: "Austin Royals" });
  assert.equal(sides[1].team, undefined);
  assert.match(sides[1].text, /^Winner of /);
  assert.equal(href, undefined);
});

test("the known team in the second slot: the other slot's words first, the team second, never the team twice", () => {
  const { sides, href } = final([SF1(), SF2([40, 20])]);
  assert.equal(sides[0].team, undefined);
  assert.match(sides[0].text, /^Winner of /);
  assert.deepEqual(sides[1], { team: "Grace Classical Academy", text: "Grace Classical Academy" });
  assert.notEqual(sides[0].text, sides[1].text);
  assert.equal(href, undefined);
});

test("both known: each slot's team, in slot order, and the game's page at the bracket's order", () => {
  const { sides, href } = final([SF1([40, 20]), SF2([30, 10])]);
  assert.deepEqual(sides.map((s) => s.team), ["Austin Royals", "Grace Classical Academy"]);
  assert.equal(href, "/scores/2026-final-grace-classical-academy-at-austin-royals");
  // The other way round: the second slot's team is the away team.
  assert.deepEqual(final([SF1([10, 40]), SF2([30, 10])]).sides.map((s) => s.team), ["Hill Country", "Grace Classical Academy"]);
});

test("neither known: both slots read as waiting, no team, no game link", () => {
  const { sides, href } = final([SF1(), SF2()]);
  assert.deepEqual(sides.map((s) => s.team), [undefined, undefined]);
  assert.ok(sides.every((s) => /^Winner of /.test(s.text)) && sides[0].text !== sides[1].text);
  assert.equal(href, undefined);
});

test("no tree box: the built game's own sides, the known team first, the other as sideText words it", () => {
  const sides = championshipSides(undefined, { sides: [{ team: "Grace Classical Academy" }, { winnerOf: SF1() }] });
  assert.deepEqual(sides, [{ team: "Grace Classical Academy", text: "Grace Classical Academy" }, { text: "winner of Hill Country–Austin Royals" }]);
  assert.deepEqual(championshipSides(undefined, undefined).map((s) => s.text), ["To be decided", "To be decided"]);
});

test("a game link only for two different known teams the bracket gives a page", () => {
  const orders = [{ round: "final", home: "A", away: "B" }];
  const team = (t) => ({ team: t, text: t });
  assert.equal(championshipGameHref(2026, "final", [team("A"), team("A")], orders), undefined);
  assert.equal(championshipGameHref(2026, "final", [team("A"), { text: "To be decided" }], orders), undefined);
  assert.equal(championshipGameHref(2026, "final", [team("A"), team("C")], orders), undefined);
  assert.equal(championshipGameHref(2026, "final", [team("B"), team("A")], orders), "/scores/2026-final-b-at-a");
});
