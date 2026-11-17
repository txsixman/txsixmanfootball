// A State Championship's share card: its title, its size, and when it names a champion.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { championBanner, stateCardTitle } from "../app/scores/[id]/card/state-card.ts";

test("the title names the season, the bracket and the State Championship", () => {
  assert.equal(stateCardTitle(2026, "Northvale League"), "2026 Northvale League State Championship");
  assert.equal(stateCardTitle(2026, "Eastfield Division I"), "2026 Eastfield Division I State Championship");
});

test("a recorded final names its champion; an unplayed or disputed game names none", () => {
  assert.equal(championBanner({ champion: "Pinecrest Academy" }), "Pinecrest Academy · State Champion");
  assert.equal(championBanner(undefined), undefined);
});

test("the wording never says anything but State Championship", () => {
  const text = [stateCardTitle(2026, "Northvale League"), championBanner({ champion: "Pinecrest Academy" })].join(" ");
  assert.doesNotMatch(text, /final round|title game|championship game|state final/i);
});
