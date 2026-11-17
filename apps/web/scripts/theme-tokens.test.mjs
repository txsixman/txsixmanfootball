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

// WCAG 1.4.11: the edge of a text field is the only thing that shows where it is, so it needs 3:1 against the surface it sits on.
const css = readFileSync(path.join(web, "app/globals.css"), "utf8");
const pair = (token) => {
  const m = css.match(new RegExp(`--color-${token}:\\s*light-dark\\((#[0-9a-fA-F]{6}),\\s*(#[0-9a-fA-F]{6})\\)`));
  assert.ok(m, `--color-${token} is a light-dark pair`);
  return { light: m[1], dark: m[2] };
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("contrast is measured the way WCAG does", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.ok(contrast("#cdd6e8", "#ffffff") < 3, "the hairline color is too faint for a field's edge");
});

test("a text field's edge has 3:1 against the page and the panel, in light and dark", () => {
  const field = pair("field");
  for (const surface of ["page", "panel"]) {
    const s = pair(surface);
    for (const theme of ["light", "dark"]) assert.ok(contrast(field[theme], s[theme]) >= 3, `${theme} field on ${surface}`);
  }
  assert.match(css, /--color-input:\s*var\(--color-field\)/, "shadcn's Input border is the field edge");
});

test("a text field is drawn with the field edge, never the hairline", () => {
  for (const f of ["components/ui/input.tsx", "app/posts/post-parts.tsx", "app/scores/board.tsx"]) {
    const text = readFileSync(path.join(web, f), "utf8");
    assert.match(text, /border-(field|input)\b/, f);
  }
  assert.doesNotMatch(readFileSync(path.join(web, "components/ui/input.tsx"), "utf8"), /border-line/);
});

test("reduced motion: transitions, animations and smooth scrolling are switched off", () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  for (const rule of [/transition-duration:\s*0\.01ms !important/, /animation-duration:\s*0\.01ms !important/, /scroll-behavior:\s*auto !important/]) assert.match(block, rule);
});
