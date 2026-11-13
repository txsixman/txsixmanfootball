// The comment count under a game page when "Show more" asks for a page past the end (lib/posts/total.ts).
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { test } from "node:test";
import { pageTotal } from "../lib/posts/total.ts";

const page = (n, total) => ({ comments: Array.from({ length: n }, (_, i) => ({ id: String(i) })), total });

test("a page with comments sets the count the route sent", () => {
  assert.equal(pageTotal(0, 0, page(20, 45)), 45);
  assert.equal(pageTotal(45, 20, page(20, 44)), 44);
});

test("the first page coming back empty means there are no comments", () => {
  assert.equal(pageTotal(12, 0, page(0, 0)), 0);
});

test("an empty page past the end keeps the known count, lowered to what is on screen", () => {
  // 25 known, 20 shown; the last 5 were hidden before "Show more": the route answers { comments: [], total: 0 }.
  assert.equal(pageTotal(25, 20, page(0, 0)), 20);
  // The count already at or below what is shown is kept as it is.
  assert.equal(pageTotal(20, 20, page(0, 0)), 20);
});
