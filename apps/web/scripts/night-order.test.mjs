// Tonight's board order (lib/night-order.ts): under way, then not started, then finished, each in the round's order.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { nightOrder } from "../lib/night-order.ts";

const g = (id, state) => ({ id, state });

test("a round lists games under way first, then those not started, then finals and forfeits, keeping the round's order", () => {
  const round = [g("a", "final"), g("b", "later"), g("c", "forfeit"), g("d", "later"), g("e", "later")];
  assert.deepEqual(nightOrder(round, () => false).map((x) => x.id), ["b", "d", "e", "a", "c"]);
  assert.deepEqual(nightOrder(round, (x) => x.id === "e").map((x) => x.id), ["e", "b", "d", "a", "c"]);
  // A final is never live, whatever the live rows say (a final shows no live line).
  assert.deepEqual(nightOrder(round, () => true).map((x) => x.id), ["b", "d", "e", "a", "c"]);
  assert.deepEqual(nightOrder([], () => true), []);
});
