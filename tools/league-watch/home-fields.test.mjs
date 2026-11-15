// Invented programs and places only: no test reads the feed or the private repo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOME_FIELD_COLUMNS, homeFields, mergeHomeFields } from "./home-fields.mjs";

const v = (home, site_name, site_city, phase = "regular") => ({ game_date: "2026-09-04", home, away: "x", phase, venue_id: "1", site_name, site_city });

test("a program's home field is where most of its regular-season home games were, with 2 or more there", () => {
  const rows = [v("lark", "Owl Field", "Wrenville"), v("lark", "Owl Field", "Wrenville"), v("lark", "Owl Field", "Wrenville"), v("lark", "Neutral Bowl", "Finch")];
  assert.deepEqual(homeFields(rows, 2026), [{ program: "lark", site_name: "Owl Field", site_city: "Wrenville", season: "2026" }]);
});

test("one home game, a split, or a tie gives no field", () => {
  const rows = [
    v("one", "Owl Field", "Wrenville"),
    v("split", "A Field", "Ay"), v("split", "A Field", "Ay"), v("split", "B Field", "Bee"), v("split", "C Field", "Cee"),
    v("tie", "A Field", "Ay"), v("tie", "A Field", "Ay"), v("tie", "B Field", "Bee"), v("tie", "B Field", "Bee"),
  ];
  assert.deepEqual(homeFields(rows, 2026), []);
});

test("playoff games and venues with no name or city do not count", () => {
  const rows = [v("lark", "Owl Field", "Wrenville", "playoff"), v("lark", "Owl Field", "Wrenville", "playoff"), v("lark", "", ""), v("lark", "Owl Field", "")];
  assert.deepEqual(homeFields(rows, 2026), []);
});

test("a new season replaces a program's field; programs it does not give stay", () => {
  const kept = `${HOME_FIELD_COLUMNS.join(",")}\nlark,Old Field,Wrenville,2025\nwren,Wren Field,Wrenville,2025\n`;
  const out = mergeHomeFields(kept, [{ program: "lark", site_name: "Owl Field", site_city: "Wrenville", season: "2026" }]);
  assert.equal(out, `${HOME_FIELD_COLUMNS.join(",")}\nlark,Owl Field,Wrenville,2026\nwren,Wren Field,Wrenville,2025\n`);
  assert.throws(() => mergeHomeFields("a,b\n", []), /expected program/);
});

test("a rerun for the same season keeps a kept row, so a hand fix stays", () => {
  const kept = `${HOME_FIELD_COLUMNS.join(",")}\nlark,Fixed Field,Wrenville,2026\n`;
  assert.equal(mergeHomeFields(kept, [{ program: "lark", site_name: "Owl Field", site_city: "Wrenville", season: "2026" }]), kept);
});
