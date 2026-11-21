// One phrase for a game ended by a big lead (lib/mercy.ts), in game notes and in the archive's own notes.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveNote, MERCY_RULE, ruleEnd } from "../lib/mercy.ts";

test("a game note says the 45-point rule with the halftime or quarter it ended in", () => {
  assert.equal(MERCY_RULE, "45-point rule");
  assert.equal(ruleEnd("mercy_half"), "45-point rule, halftime");
  assert.equal(ruleEnd("mercy_2h", "3"), "45-point rule, Q3");
  assert.equal(ruleEnd("mercy_2h"), "45-point rule, second half");
});

test("the archive's mercy-rule notes read the same way, and other notes are left alone", () => {
  assert.equal(archiveNote("Mercy Rule 3Q"), "45-point rule, Q3");
  assert.equal(archiveNote("Mercy Rule-Halftime"), "45-point rule, halftime");
  assert.equal(archiveNote("Mercy Rule-9:45 3rd Quarter"), "45-point rule, Q3 9:45");
  assert.equal(archiveNote("Mercy Rule"), "45-point rule");
  assert.equal(archiveNote(""), "");
  assert.equal(archiveNote("OT"), "OT");
  assert.equal(archiveNote("Forfeit"), "Forfeit");
});
