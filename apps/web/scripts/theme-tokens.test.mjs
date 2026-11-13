// Every color on a page comes from a theme token, so it changes with light and dark (ADR 0035, app/globals.css). A fill
// behind white text is bg-band or bg-alert, which stay dark in both themes; a light surface is bg-page or bg-panel.
// bg-white would stay white in dark mode, and bg-navy, bg-red and bg-ink turn light there, under text that stays white.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXED = /\b(?:bg|from|via|to)-(?:white|black|navy|red|ink)(?![\w-])|\btext-black(?![\w-])|\b(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/g;
// Drawn images, not pages: share cards and icons are rendered once, in the site's light colors.
const IMAGES = /(?:opengraph-image|apple-icon|icon|page-card|mark|card\/route)\.tsx$/;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(tsx|ts|css)$/.test(e.name) && !IMAGES.test(p) ? [p] : [];
  });
}

export function fixedColors(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line))
    .flatMap((line) => line.match(FIXED) ?? []);
}

test("a fixed color class is found, and comments are not read", () => {
  assert.deepEqual(fixedColors('<p className="bg-white px-2 text-[#0a2a5e]">'), ["bg-white", "text-[#0a2a5e]"]);
  assert.deepEqual(fixedColors('<p className="hover:bg-navy text-black bg-[#fff]">'), ["bg-navy", "text-black", "bg-[#fff]"]);
  assert.deepEqual(fixedColors('<p className="bg-page bg-band bg-alert text-white bg-red-fill">'), []);
  assert.deepEqual(fixedColors("// bg-white is refused here"), []);
});

test("no page uses a color that ignores the theme", () => {
  const found = ["app", "components"].flatMap((d) =>
    files(path.join(web, d)).flatMap((f) => fixedColors(readFileSync(f, "utf8")).map((c) => `${path.relative(web, f)}: ${c}`)),
  );
  assert.deepEqual(found, []);
});
