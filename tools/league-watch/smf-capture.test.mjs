import assert from "node:assert/strict";
import { test } from "node:test";
import { capturePaths } from "./smf-capture.mjs";

test("a capture is a short list of plain site paths", () => {
  assert.deepEqual(capturePaths("# scores\n/scores/\n\n/schedule/?week=12  # this week\n"), ["/scores/", "/schedule/?week=12"]);
  assert.throws(() => capturePaths("https://www.sixmanfootball.com/scores/"), /not a plain site path/);
  assert.throws(() => capturePaths("/a\n/b\n/c\n/d\n/e\n/f\n/g\n"), /at most 6/);
});
