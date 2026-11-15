// Home fields (lib/home-fields.ts, ADR 0061): a regular-season game names the home team's own field when it is known for
// that season and the game is not marked neutral. Invented teams and places only.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHomeFields, regularSeasonSite } from "../lib/home-fields.ts";

const FILE = "program,site_name,site_city,season\nsalt-fork,Mesa Field,Red Bluff,2031\nowl-creek,Prairie Bowl,Owl Creek,2030\n";

test("a known field for the game's season names the field, by name and city, as the home site", () => {
  assert.equal(regularSeasonSite(parseHomeFields(FILE), "Salt Fork", false, 2031), "Mesa Field, Red Bluff (home)");
});

test("no field, another season's field, or a neutral game falls back as before", () => {
  const fields = parseHomeFields(FILE);
  assert.equal(regularSeasonSite(fields, "Cedar Gap", false, 2031), "Cedar Gap (home)");
  assert.equal(regularSeasonSite(fields, "Owl Creek", false, 2031), "Owl Creek (home)", "a 2030 field is not used for 2031");
  assert.equal(regularSeasonSite(fields, "Salt Fork", true, 2031), "Neutral site");
  assert.equal(parseHomeFields("").size, 0);
});

test("a bad row fails the read, never shows", () => {
  assert.throws(() => parseHomeFields("program,site_name,site_city,season\nSalt Fork,Mesa Field,Red Bluff,2031\n"), /program slug/);
  assert.throws(() => parseHomeFields("program,site_name,site_city,season\nsalt-fork,Mesa Field,,2031\n"));
});
