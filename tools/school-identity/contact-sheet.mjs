// One PNG with every stored logo at list size, each on white and on navy (#0a2a5e), so a bad one stands out.
// Usage: node contact-sheet.mjs [--out file.png] [--only slug,slug] [--from n --count n] [--cols n] [--box 160x64] [--originals]
//   --originals  draw the untouched originals instead of the stored files
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { IDENTITY, LOGOS, ORIGINALS } from "./fetch-logos.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function main() {
  const sharp = createRequire(new URL("../../apps/web/package.json", import.meta.url))("sharp");
  const data = JSON.parse(readFileSync(IDENTITY, "utf8"));
  const only = arg("only") ? new Set(arg("only").split(",")) : null;
  const originals = process.argv.includes("--originals");
  let list = Object.entries(data.schools).filter(([slug, s]) => s.logo?.file && (!only || only.has(slug)));
  list = list.slice(Number(arg("from", 0)), arg("count") ? Number(arg("from", 0)) + Number(arg("count")) : undefined);
  const [bw, bh] = arg("box", "160x64").split("x").map(Number);
  const cols = Number(arg("cols", 4));
  const pad = 6, label = 14, cellW = bw * 2 + pad * 3, cellH = bh + label + pad * 2;
  const rows = Math.ceil(list.length / cols);
  const composites = [];
  for (const [i, [slug, s]] of list.entries()) {
    const x = (i % cols) * (cellW + 4), y = Math.floor(i / cols) * (cellH + 4);
    const file = originals ? new URL(s.logo.original, ORIGINALS) : new URL(s.logo.file, LOGOS);
    const logo = await sharp(readFileSync(file), { density: 144 }).resize(bw, bh, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
    composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellW}" height="${cellH}"><rect width="${bw + pad * 1.5}" height="${cellH}" fill="#fff"/><rect x="${bw + pad * 1.5}" width="${cellW - bw - pad * 1.5}" height="${cellH}" fill="#0a2a5e"/><text x="3" y="${cellH - 3}" font-size="10" font-family="Helvetica,Arial,sans-serif" fill="#888">${esc(slug).slice(0, 44)}</text></svg>`), left: x, top: y });
    const top = y + pad + Math.round((bh - (await sharp(logo).metadata()).height) / 2);
    for (const k of [0, 1]) composites.push({ input: logo, left: x + pad + k * (bw + pad), top });
  }
  const sheet = sharp({ create: { width: cols * (cellW + 4), height: rows * (cellH + 4), channels: 3, background: "#888" } });
  const out = arg("out", `${process.env.TMPDIR ?? "/tmp"}/logos-contact.png`);
  writeFileSync(out, await sheet.composite(composites).png().toBuffer());
  console.log(`${list.length} logos on ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
