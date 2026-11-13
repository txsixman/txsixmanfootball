// The Site freshness verdict (site-freshness.mjs): when production counts as having the newest data, how the gap is
// measured, and when it fails.   node --test .github/scripts/*.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMIT_MINUTES, hasCommit, judge, readMarker } from "./site-freshness.mjs";

const DATA = "a".repeat(40);
const PROD = "b".repeat(40);
const NOW = Date.parse("2026-11-13T12:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();

test("production that has the data commit is fresh, however old the commit", () => {
  for (const status of ["identical", "behind"]) {
    const v = judge({ dataSha: DATA, prodSha: PROD, status, behindSince: ago(600), now: NOW });
    assert.equal(v.state, "fresh", status);
    assert.equal(v.gapMinutes, 0);
    assert.match(v.line, /bbbbbbb\) has the newest data commit \(aaaaaaa\)/);
  }
});

test("production without the data commit: deploying within the limit, stale past it, measured from behindSince", () => {
  for (const status of ["ahead", "diverged"]) {
    assert.equal(judge({ dataSha: DATA, prodSha: PROD, status, behindSince: ago(12), now: NOW }).state, "deploying", status);
    assert.equal(judge({ dataSha: DATA, prodSha: PROD, status, behindSince: ago(LIMIT_MINUTES), now: NOW }).state, "deploying", status);
    const stale = judge({ dataSha: DATA, prodSha: PROD, status, behindSince: ago(LIMIT_MINUTES + 1), now: NOW });
    assert.equal(stale.state, "stale", status);
    assert.equal(stale.gapMinutes, LIMIT_MINUTES + 1);
  }
  // Last night's case: about 10 hours behind.
  const night = judge({ dataSha: DATA, prodSha: PROD, status: "ahead", behindSince: ago(600), now: NOW });
  assert.equal(night.state, "stale");
  assert.equal(night.line, "Production (bbbbbbb) lacks data commit aaaaaaa: behind for 600 min, more than the 30 allowed.");
});

test("no marker, or a commit GitHub does not know, counts as lacking the data", () => {
  const none = judge({ dataSha: DATA, prodSha: null, status: null, behindSince: ago(45), now: NOW });
  assert.deepEqual([none.state, none.gapMinutes], ["stale", 45]);
  assert.match(none.line, /^Production shows no build marker: behind for 45 min/);
  const unknown = judge({ dataSha: DATA, prodSha: PROD, status: null, behindSince: ago(5), now: NOW });
  assert.equal(unknown.state, "deploying");
  assert.match(unknown.line, /^Production's commit bbbbbbb is not on GitHub/);
});

test("a clock a little ahead of GitHub's never makes a negative gap; a bad date fails loudly", () => {
  assert.equal(judge({ dataSha: DATA, prodSha: PROD, status: "ahead", behindSince: ago(-2), now: NOW }).gapMinutes, 0);
  assert.throws(() => judge({ dataSha: DATA, prodSha: PROD, status: "ahead", behindSince: "soon", now: NOW }), /not a date/);
});

test("after a push: only identical or behind means production has it", () => {
  assert.equal(hasCommit(PROD, "identical"), true);
  assert.equal(hasCommit(PROD, "behind"), true);
  for (const status of ["ahead", "diverged", null]) assert.equal(hasCommit(PROD, status), false, String(status));
  assert.equal(hasCommit(null, "identical"), false);
});

test("the marker: a full lowercase commit id, or nothing", () => {
  assert.equal(readMarker({ sha: DATA, builtAt: "2026-11-13T00:00:00Z" }), DATA);
  for (const body of [null, "x", {}, { sha: null }, { sha: "abc1234" }, { sha: DATA.toUpperCase() }, { sha: `${DATA}\n` }, [DATA]]) {
    assert.equal(readMarker(body), null, JSON.stringify(body));
  }
});
