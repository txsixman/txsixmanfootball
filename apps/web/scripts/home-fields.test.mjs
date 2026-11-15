// Home fields (lib/home-fields.ts, ADR 0064): a regular-season game names the home team's own field when it is known for
// that season and the game is not marked neutral. Invented teams and places only.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { homeFieldAddress, parseHomeFields, regularSeasonSite } from "../lib/home-fields.ts";

const HEAD = "program,site_name,site_city,season,site_street,site_state,site_zip";
const FILE = `${HEAD}\nsalt-fork,Mesa Field,Red Bluff,2031,1 Mesa Rd,TX,79528\nowl-creek,Prairie Bowl,Owl Creek,2030,,,\n`;

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
  assert.throws(() => parseHomeFields(`${HEAD}\nSalt Fork,Mesa Field,Red Bluff,2031,,,\n`), /program slug/);
  assert.throws(() => parseHomeFields(`${HEAD}\nsalt-fork,Mesa Field,,2031,,,\n`));
});

test("the named field's street address comes with it, never with another season's or a neutral game (ADR 0066)", () => {
  const fields = parseHomeFields(FILE);
  assert.deepEqual(homeFieldAddress(fields, "Salt Fork", false, 2031), { street: "1 Mesa Rd", city: "Red Bluff", state: "TX", zip: "79528" });
  assert.equal(homeFieldAddress(fields, "Salt Fork", true, 2031), undefined);
  assert.equal(homeFieldAddress(fields, "Salt Fork", false, 2032), undefined);
  assert.equal(homeFieldAddress(fields, "Owl Creek", false, 2030), undefined, "no street, no address");
  assert.throws(() => parseHomeFields(`${HEAD}\nsalt-fork,Mesa Field,Red Bluff,2031,,TX,79528\n`), "a state or ZIP needs a street");
});
