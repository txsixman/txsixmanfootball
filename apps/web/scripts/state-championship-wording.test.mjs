// The last playoff round is the State Championship in every mention on a page: never "state final", "UIL finals" or
// "title game" (owner, Nov 15, 2026). "Final" for a finished game's score stays. Comments are not read.
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRONG = /\bstate finals?\b|\bUIL finals\b|\btitle games?\b/gi;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(tsx|ts)$/.test(e.name) ? [p] : [];
  });
}

export const wrongWords = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .flatMap((line) => line.replace(/\/\/.*$/, "").match(WRONG) ?? []);

test("the wrong names are found, and comments are not read", () => {
  assert.deepEqual(wrongWords('<h2>UIL state finals</h2>\n<p title="the title game">'), ["state finals", "title game"]);
  assert.deepEqual(wrongWords("// UIL's state final archive\n * the state finals\nconst x = 1; // state final"), []);
  assert.deepEqual(wrongWords('"Final: Jayton by 7" · "State Championship"'), []);
});

test("no page calls the last round anything but the State Championship", () => {
  const found = ["app", "lib"].flatMap((d) =>
    files(path.join(WEB, d)).flatMap((f) => wrongWords(readFileSync(f, "utf8")).map((w) => `${path.relative(WEB, f)}: ${w}`)),
  );
  assert.deepEqual(found, []);
});
