// The forfeit rule the pages use (lib/forfeit.ts) gives the answers the ratings' rule (services/ratings/rows.py) is tested
// against: one shared table, so the two cannot drift.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { forfeitScore } from "../lib/forfeit.ts";

const { cases } = JSON.parse(readFileSync(new URL("../lib/forfeit-cases.json", import.meta.url), "utf8"));

test("every robot-style score in the shared table is judged as the ratings judge it", () => {
  for (const [home, away, forfeit] of cases) assert.equal(forfeitScore(home, away), forfeit, `${home}-${away}`);
});
