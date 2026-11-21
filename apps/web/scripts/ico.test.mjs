// The favicon wrapper (lib/ico.ts): a PNG inside a one-picture .ico.   node --test apps/web/scripts/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { pngToIco } from "../lib/ico.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

test("the header says one icon, 48 by 48, 32 bits, with the PNG's size and its start at byte 22", () => {
  const ico = pngToIco(PNG, 48);
  const v = new DataView(ico.buffer);
  assert.equal(ico.length, 22 + PNG.length);
  assert.deepEqual([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)], [0, 1, 1]);
  assert.deepEqual([ico[6], ico[7], ico[8], ico[9]], [48, 48, 0, 0]);
  assert.deepEqual([v.getUint16(10, true), v.getUint16(12, true), v.getUint32(14, true), v.getUint32(18, true)], [1, 32, PNG.length, 22]);
  assert.deepEqual([...ico.slice(22)], [...PNG]);
});

test("a size an entry cannot hold is refused", () => {
  assert.throws(() => pngToIco(PNG, 0), RangeError);
  assert.throws(() => pngToIco(PNG, 256), RangeError);
});
