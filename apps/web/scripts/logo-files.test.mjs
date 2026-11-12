// The stored school logos (ADR 0016), checked with sharp: an edited file has its note, nothing is oversized, the
// tidy and light rules behave, and the audit finds nothing new.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { audit } from "../../../tools/school-identity/audit-logos.mjs";
import { buildStored, IDENTITY, LOGOS, ORIGINALS, STORED_BOX } from "../../../tools/school-identity/fetch-logos.mjs";
import { isLightOnClear, measure } from "../../../tools/school-identity/measure.mjs";

const sharp = createRequire(import.meta.url)("sharp");
const data = JSON.parse(readFileSync(IDENTITY, "utf8"));
const rasters = Object.entries(data.schools).filter(([, s]) => s.logo?.file?.endsWith(".png"));

/** A mark (a red disc) on a solid white box with padding, as a PNG. */
async function boxed(size = 400, disc = 100, background = "#ffffff") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${disc / 2}" fill="#c01020"/></svg>`;
  return sharp({ create: { width: size, height: size, channels: 3, background } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

test("an edited logo has its note: a stored file that is not a plain shrink of its original says what was done", async () => {
  const problems = [];
  for (const [slug, s] of rasters) {
    const { logo } = s;
    const stored = await sharp(readFileSync(new URL(logo.file, LOGOS))).metadata();
    const original = await sharp(readFileSync(new URL(logo.original, ORIGINALS))).metadata();
    const same = Math.abs(stored.width / stored.height - original.width / original.height) < 0.03 * (original.width / original.height);
    if (!same && !logo.edit) problems.push(`${slug}: stored ${stored.width}x${stored.height} vs original ${original.width}x${original.height}, no edit note`);
    if (stored.width > STORED_BOX.width || stored.height > STORED_BOX.height) problems.push(`${slug}: stored ${stored.width}x${stored.height} is over the cap`);
    assert.equal(logo.aspect, Math.round((stored.width / stored.height) * 100) / 100, `${slug}: aspect does not match the stored file`);
  }
  assert.deepEqual(problems, []);
});

test("a mark on a padded solid box is stripped and trimmed, and a hand crop is noted", async () => {
  const built = await buildStored(sharp, await boxed(), "png", {});
  const m = await measure(sharp, built.stored);
  assert.ok(m.fill > 0.9 && !m.solidBackground, "the box is gone and the mark fills its canvas");
  assert.ok(built.width < 150 && built.height < 150);
  assert.match(built.edit, /stripped the solid background.*trimmed padding/);
  const cropped = await buildStored(sharp, await boxed(), "png", { crop: { left: 100, top: 100, width: 200, height: 200 } });
  assert.match(cropped.edit, /cropped by hand/);
  const kept = await buildStored(sharp, await boxed(), "png", { keepBackground: true });
  assert.doesNotMatch(kept.edit ?? "", /stripped/);
});

test("a wide wordmark keeps its height up to the cap, and a small source is never enlarged", async () => {
  const wide = await sharp({ create: { width: 2400, height: 400, channels: 4, background: "#102060" } }).png().toBuffer();
  const big = await buildStored(sharp, wide, "png", { keepBackground: true });
  assert.deepEqual([big.width, big.height], [1200, 200]);
  const tiny = await sharp({ create: { width: 90, height: 60, channels: 4, background: "#102060" } }).png().toBuffer();
  const small = await buildStored(sharp, tiny, "png", { keepBackground: true });
  assert.deepEqual([small.width, small.height], [90, 60]);
});

test("a white mark on a clear background is light; a colored or dark one is not", async () => {
  const mark = async (fill, background = "#0000") => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="30" y="30" width="40" height="40" fill="${fill}"/></svg>`;
    return sharp({ create: { width: 100, height: 100, channels: 4, background } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  };
  assert.equal(await isLightOnClear(sharp, await mark("#ffffff")), true);
  assert.equal(await isLightOnClear(sharp, await mark("#f2ecd8")), true, "pale cream vanishes on white too");
  assert.equal(await isLightOnClear(sharp, await mark("#c01020")), false);
  assert.equal(await isLightOnClear(sharp, await mark("#111111")), false);
});

test("the audit finds nothing but the known gaps: no campus mark for two Founders schools, no larger source for two", async () => {
  const flagged = (await audit(sharp, data)).filter((r) => r.problems.length).map((r) => r.slug).sort();
  assert.deepEqual(flagged, [
    "founders-classical-academy-of-conroe", // the Founders network mark: no campus mark exists on its site or Dave Campbell's
    "immanuel-christian-school-el-paso", // 101x96 is all the school's site offers
    "plainview-classical-academy", // the Founders network mark, as above
    "vernon-northside", // 115x100 on a host whose robots.txt disallows a refetch; Dave Campbell's has no Northside logo
  ]);
});
