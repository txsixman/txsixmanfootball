// The post-deploy smoke verdicts (smoke.mjs): which links it follows, and when a page or the build marker fails.
//   node --test .github/scripts/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { FOLLOW, PAGES, markerProblem, pageProblems, pickLink } from "./smoke.mjs";

const SHA = "c".repeat(40);
const follow = (what) => FOLLOW.find((f) => f.what === what).pattern;

test("the game-night pages, /weeks and /build.json are all checked", () => {
  for (const p of ["/", "/scores", "/scores/tonight", "/playoffs", "/rankings", "/weeks"]) assert.ok(PAGES.includes(p), p);
  assert.ok(PAGES.some((p) => p.startsWith("/programs/")));
  assert.deepEqual(FOLLOW.map((f) => f.what), ["a bracket", "a game page"]);
});

test("a bracket and a game page are taken from the site's own links", () => {
  const playoffs = ["/scores", "/playoffs/2025", "/playoffs/bracket/uil-division-i", "/playoffs/bracket/tapps"];
  assert.equal(pickLink(playoffs, follow("a bracket")), "/playoffs/bracket/uil-division-i");
  const program = ["/programs/kress", "/scores/2026-bi-district-kress-at-jayton", "/scores/2026-09-10-paducah-at-jayton"];
  assert.equal(pickLink(program, follow("a game page")), "/scores/2026-09-10-paducah-at-jayton");
  assert.equal(pickLink(["/", "/rankings"], follow("a game page")), null);
  assert.equal(pickLink(["https://evil.example/playoffs/bracket/x"], follow("a bracket")), null);
});

test("a page passes only with 200, a heading and no console error", () => {
  assert.deepEqual(pageProblems({ status: 200, heading: true, errors: [] }), []);
  assert.deepEqual(pageProblems({ status: 404, heading: true, errors: [] }), ["answered 404"]);
  assert.deepEqual(pageProblems({ status: null, heading: false, errors: [] }), ["answered nothing", "no main heading"]);
  assert.deepEqual(pageProblems({ status: 200, heading: true, errors: ["boom"] }), ["console: boom"]);
  const many = pageProblems({ status: 200, heading: true, errors: ["a", "b", "c", "d", "e"] });
  assert.equal(many.length, 4);
  assert.equal(many[3], "and 2 more console errors");
});

test("the marker must name the deployed commit; on a scheduled run any commit will do", () => {
  assert.equal(markerProblem(SHA, SHA), null);
  assert.equal(markerProblem(SHA, null), null);
  assert.equal(markerProblem(null, null), "/build.json shows no commit");
  assert.equal(markerProblem("d".repeat(40), SHA), "/build.json names ddddddd, not the deployed ccccccc");
});
