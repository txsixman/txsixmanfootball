// The account page's dates (app/account/dates.ts): the site's time zone, a long date, and nothing for a value that is not a date.
//   node --test apps/web/scripts/account-dates.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { longDate } from "../app/account/dates.ts";

test("a long date in America/Chicago, whatever the machine's own zone", () => {
  assert.equal(longDate("2026-12-14T18:00:00Z"), "December 14, 2026");
  assert.equal(longDate("2026-12-15T05:30:00Z"), "December 14, 2026"); // 11:30 pm the day before in Chicago
  assert.equal(longDate("2026-07-01T04:30:00Z"), "June 30, 2026"); // daylight time: 11:30 pm the day before
});

test("Postgres's own timestamp text and a bad value", () => {
  assert.equal(longDate("2026-12-15T12:00:00+00:00"), "December 15, 2026");
  assert.equal(longDate("not a date"), "");
  assert.equal(longDate(""), "");
});
