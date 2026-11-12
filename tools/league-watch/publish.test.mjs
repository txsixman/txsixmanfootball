// publish.mjs: the public copy of a robot-read file keeps every column but source_url and notes, row for row.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { publicCsv, publish } from "./publish.mjs";

const HEADER = "date,home,away,home_score,away_score,source_url,notes";

test("drops source_url and notes, keeps the rest in order", () => {
  const text = `${HEADER}\n2026-09-04,Jayton,Guthrie,52,6,https://example.org/a,read twice\n`;
  assert.equal(publicCsv(text), "date,home,away,home_score,away_score\n2026-09-04,Jayton,Guthrie,52,6\n");
});

test("fails loudly instead of shifting columns", () => {
  assert.throws(() => publicCsv(`${HEADER}\n2026-09-04,"Jayton, TX",Guthrie,52,6,,\n`), /quoted cell/);
  assert.throws(() => publicCsv(`${HEADER}\n2026-09-04,Jayton,Guthrie,52,6,\n`), /line 2 has 6 cells, expected 7/);
  assert.throws(() => publicCsv("date,home,away\n2026-09-04,Jayton,Guthrie\n"), /no source_url column/);
});

test("publishes games and playoffs, and refuses a folder with neither", () => {
  const from = mkdtempSync(path.join(tmpdir(), "publish-from-"));
  const to = path.join(mkdtempSync(path.join(tmpdir(), "publish-to-")), "maxpreps-2026");
  writeFileSync(path.join(from, "games.csv"), `${HEADER}\n2026-09-04,Jayton,Guthrie,52,6,https://example.org/a,\n`);
  writeFileSync(path.join(from, "teams.csv"), "private,never,published\n");
  assert.deepEqual(publish(from, to), ["games.csv"]);
  assert.doesNotMatch(readFileSync(path.join(to, "games.csv"), "utf8"), /example\.org/);
  assert.throws(() => publish(to.replace("maxpreps-2026", "none"), to), /no games\.csv or playoffs\.csv/);
});
