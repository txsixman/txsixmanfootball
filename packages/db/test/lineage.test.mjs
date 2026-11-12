import assert from "node:assert/strict";
import { test } from "node:test";
import { LINEAGE_COLUMNS, parseLineage } from "../lineage.mjs";

// Invented schools only.
const csv = (...rows) => [LINEAGE_COLUMNS, ...rows].join("\n");

test("a lineage row needs a known event, a season and a cited source", () => {
  const [row] = parseLineage(csv("Dry Wash,Cedar Gap,consolidation,1990,https://x.test/a,merged"));
  assert.deepEqual([row.predecessor, row.successor, row.season], ["Dry Wash", "Cedar Gap", 1990]);
  assert.throws(() => parseLineage(csv("Dry Wash,Cedar Gap,merger,1990,https://x.test/a,")), /unknown event/);
  assert.throws(() => parseLineage(csv("Dry Wash,Cedar Gap,consolidation,1990,,")), /cites no source/);
  assert.throws(() => parseLineage(csv("Dry Wash,Cedar Gap,consolidation,1990,https://x.test/a,a, b")), /no commas/);
});
