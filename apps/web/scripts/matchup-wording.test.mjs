// A game is written "Away vs Home" on every public page (ADR 0037). "at" would say where it is played, and a playoff
// game's home team is only the bracket's designation; the site, when known, is its own line. The admin pages keep "at".
//   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const WEB = path.join(import.meta.dirname, "..");
const AT = /\}\s+at\s+\$?\{/; // `${away} at ${home}` or {away} at {home}

function* sources(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "admin" && e.name !== "node_modules") yield* sources(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

test("no public page writes a game as one team at the other", () => {
  const files = [...sources(path.join(WEB, "app")), ...sources(path.join(WEB, "lib")), ...sources(path.join(WEB, "components"))];
  assert.ok(files.length > 100, `only ${files.length} source files read`);
  const found = files.flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .map((line, i) => (AT.test(line) && !/^\s*(\/\/|\*)/.test(line) ? `${path.relative(WEB, f)}:${i + 1}` : null))
      .filter(Boolean),
  );
  assert.deepEqual(found, []);
});
