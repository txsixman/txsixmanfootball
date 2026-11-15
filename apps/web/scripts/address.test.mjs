// Site addresses (lib/address.ts, ADR 0066): the line a game page shows under its site, and the Directions link, a maps
// search with no key. Invented places only.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { addressFrom, addressLine, directionsUrl } from "../lib/address.ts";

test("an address reads street, city, state and ZIP, the file's ' - ' back as a comma, blank parts left out", () => {
  assert.equal(addressLine({ street: "1200 FM 1188 - Gate #2", city: "Red Bluff", state: "TX", zip: "79528" }), "1200 FM 1188, Gate #2, Red Bluff, TX 79528");
  assert.equal(addressLine({ street: "1 Mesa Rd", city: "", state: "TX", zip: "" }), "1 Mesa Rd, TX");
});

test("no street is no address", () => {
  assert.equal(addressFrom({ site_street: "", site_city: "Red Bluff", site_state: "TX", site_zip: "79528" }), undefined);
  assert.deepEqual(addressFrom({ site_street: "1 Mesa Rd", site_city: "Red Bluff", site_state: "TX", site_zip: "79528" }), { street: "1 Mesa Rd", city: "Red Bluff", state: "TX", zip: "79528" });
});

test("Directions is a maps search for the field's name at its address, with no key", () => {
  const url = directionsUrl("Mesa Field, Red Bluff (home)", { street: "1 Mesa Rd", city: "Red Bluff", state: "TX", zip: "79528" });
  assert.equal(url, "https://www.google.com/maps/search/?api=1&query=Mesa%20Field%2C%201%20Mesa%20Rd%2C%20Red%20Bluff%2C%20TX%2079528");
  assert.doesNotMatch(url, /key=|embed/);
});
