// Lists every stored logo that looks wrong (ADR 0016): mark under 60% of its canvas, an opaque box around the mark,
// a blank image, too small or too short to read, byte-identical to another school's file, or a pale mark
// not flagged `light`. Read-only. Usage: node audit-logos.mjs [--json]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { IDENTITY, LOGOS } from "./fetch-logos.mjs";
import { isLightOnClear, measure } from "./measure.mjs";

export const MIN_HEIGHT = 64; // a stored raster shorter than this is too small for the program page crest
export const MIN_FILL = 0.6;
/** Schools of one organization that share one mark on purpose (one logo, several campuses). */
const SHARED_MARKS = [["second-baptist-school-um-cypress", "second-baptist-school-um-memorial", "second-baptist-school-um-north"], ["grayson-christian", "sherman-grayson-christian-school"]];

export async function audit(sharp, data) {
  const rows = [];
  const hashes = new Map();
  for (const [slug, school] of Object.entries(data.schools)) {
    const file = school.logo?.file;
    if (!file) continue;
    const bytes = readFileSync(new URL(file, LOGOS));
    const digest = createHash("sha256").update(bytes).digest("hex");
    hashes.set(digest, [...(hashes.get(digest) ?? []), slug]);
    const problems = [];
    let m = null;
    if (file.endsWith(".svg")) {
      rows.push({ slug, file, problems, svg: true });
      continue;
    }
    const { width, height } = await sharp(bytes).metadata();
    m = await measure(sharp, bytes);
    if (m.empty) problems.push("blank");
    else {
      if (m.fill < MIN_FILL) problems.push(`mark fills ${Math.round(m.fill * 100)}% of the canvas`);
      if (m.solidBackground) problems.push("opaque background box");
      if (height * (m.box.y1 - m.box.y0) < MIN_HEIGHT) problems.push(`mark only ${Math.round(height * (m.box.y1 - m.box.y0))}px tall`);
    }
    if (Math.max(width, height) < 160) problems.push(`low resolution ${width}x${height}`);
    if ((await isLightOnClear(sharp, bytes)) !== Boolean(school.logo.light)) problems.push(`light flag is ${school.logo.light} but the pixels say ${!school.logo.light}`);
    rows.push({ slug, file, width, height, fill: m.fill, problems });
  }
  for (const [, slugs] of hashes) {
    if (slugs.length > 1 && !SHARED_MARKS.some((set) => slugs.every((slug) => set.includes(slug)))) for (const row of rows) if (slugs.includes(row.slug)) row.problems.push(`byte-identical to ${slugs.filter((s) => s !== row.slug).join(", ")}`);
  }
  return rows;
}

async function main() {
  const sharp = createRequire(new URL("apps/web/package.json", new URL("../../", import.meta.url)))("sharp");
  const data = JSON.parse(readFileSync(IDENTITY, "utf8"));
  const rows = await audit(sharp, data);
  const bad = rows.filter((r) => r.problems.length);
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else {
    for (const r of bad) console.log(`${r.slug.padEnd(48)} ${r.width ?? ""}x${r.height ?? ""}  ${r.problems.join("; ")}`);
    console.log(`${bad.length} of ${rows.length} logos flagged`);
  }
  if (bad.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
