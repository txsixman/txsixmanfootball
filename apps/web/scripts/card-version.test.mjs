// A share card's address carries a version of what the card says (lib/card-version.ts).   node --test apps/web/scripts/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardVersion, versioned } from "../lib/card-version.ts";

const card = { text: { alt: "Final score, A 14 B 8" }, scores: [14, 8] };

test("the version is eight hex characters, and the same content gives the same one", () => {
  assert.match(cardVersion(card), /^[0-9a-f]{8}$/);
  assert.equal(cardVersion(card), cardVersion(structuredClone(card)));
  assert.equal(versioned("/scores/x/card", card), `/scores/x/card?v=${cardVersion(card)}`);
});

test("any change to what the card says changes the version", () => {
  const seen = new Set([cardVersion(card)]);
  for (const changed of [{ ...card, scores: [14, 9] }, { ...card, text: { alt: "Final score, A 14 B 8." } }, { ...card, banner: "State Champion" }]) seen.add(cardVersion(changed));
  assert.equal(seen.size, 4);
});
