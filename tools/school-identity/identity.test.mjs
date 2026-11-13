import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { copyName, IDENTITY, LARGE, LOGOS, ORIGINALS, SMALL, sourceProblem, TINY } from "./fetch-logos.mjs";
import { knownSchools } from "./merge.mjs";

const table = JSON.parse(readFileSync(new URL("../../data/seed/schools/colors.json", import.meta.url), "utf8"));
const data = existsSync(IDENTITY) ? JSON.parse(readFileSync(IDENTITY, "utf8")) : { removed: [], schools: {} };
const entries = Object.entries(data.schools);

test("every school in identity.json is a seeded school", () => {
  const known = knownSchools();
  for (const [slug] of entries) assert.ok(known.has(slug), `unknown school ${slug}`);
});

test("every color is in the reviewed table and every fact has a source", () => {
  for (const [slug, s] of entries) {
    for (const c of s.colors) assert.ok(table[c], `${slug}: color "${c}" is not in colors.json`);
    if (s.colors.length) assert.match(s.colorsSource ?? "", /^https?:\/\//, `${slug}: colors without a source`);
    if (s.mascot) assert.match(s.mascotSource ?? "", /^https?:\/\//, `${slug}: mascot without a source`);
  }
});

test("every logo came from an allowed source, exists on disk, and removed schools have none", () => {
  const removed = new Set(data.removed ?? []);
  for (const [slug, s] of entries) {
    if (!s.logo) continue;
    assert.equal(sourceProblem(s), null, `${slug}: ${sourceProblem(s)}`);
    if (s.logo.file) {
      assert.ok(!removed.has(slug), `${slug} is removed but still has a logo file`);
      assert.ok(existsSync(new URL(s.logo.file, LOGOS)), `${slug}: ${s.logo.file} is missing`);
      if (s.logo.file.endsWith(".png")) {
        for (const [dir, name] of [[SMALL, "small"], [TINY, "tiny"], [LARGE, "large"]]) {
          assert.ok(existsSync(new URL(copyName(s.logo.file), dir)), `${slug}: ${name}/${copyName(s.logo.file)} is missing; run fetch-logos.mjs`);
        }
      }
      assert.match(s.logo.retrievedOn ?? "", /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test("every stored logo keeps its untouched original, and an edit or crop is written down (ADR 0016)", () => {
  const removed = new Set(data.removed ?? []);
  for (const [slug, s] of entries) {
    const logo = s.logo;
    if (!logo?.file) {
      assert.ok(!logo?.original && !logo?.edit, `${slug}: an original or edit note without a stored file`);
      continue;
    }
    assert.ok(logo.original, `${slug}: no original recorded`);
    const path = new URL(logo.original, ORIGINALS);
    assert.ok(existsSync(path), `${slug}: ${logo.original} is missing from logo-originals/`);
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), logo.sha256, `${slug}: the original is not the file its sha256 names`);
    if (logo.crop) assert.ok(logo.edit, `${slug}: a crop needs an edit note`);
    if (logo.edit) assert.ok(logo.edit.length >= 10, `${slug}: edit note too short`);
    assert.ok(!removed.has(slug), `${slug} is removed but still has an original`);
  }
});
