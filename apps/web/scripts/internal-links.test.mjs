// Every address written as plain text in a page's source (a link's href, a section list, a nav) leads to a route that exists.
// Built from the folders of `app/` (pages, route handlers, dynamic segments), the files in `public/` and the redirects in
// next.config.ts: no server, no live crawl. An address built from data (`/programs/${slug}`) is checked where its data is
// (the e2e specs and the live link crawl); this catches the typed ones, the ones that rot when a folder is renamed.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** The route patterns `app/` defines: one entry of segments per page or route handler. */
function routes() {
  const app = path.join(web, "app");
  const found = [];
  for (const file of walk(app)) {
    const name = path.basename(file);
    if (!/^(page|route)\.(tsx|ts|jsx|js)$/.test(name)) {
      // Metadata files (icon.tsx, opengraph-image.tsx, apple-icon.tsx, manifest.ts, robots.ts) answer at their own name.
      const m = name.match(/^(icon|apple-icon|opengraph-image|twitter-image|manifest|robots|sitemap)\.(tsx|ts|js)$/);
      if (!m) continue;
      const dir = path.relative(app, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
      found.push([...dir, m[1] === "manifest" ? "manifest.webmanifest" : m[1] === "robots" ? "robots.txt" : m[1]]);
      continue;
    }
    found.push(path.relative(app, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s)));
  }
  return found;
}

/** Does `segments` (the address split on "/") match a route pattern? [x] is one segment, [...x] one or more, [[...x]] none or more. */
function matches(pattern, segments) {
  const [head, ...rest] = pattern;
  if (head === undefined) return segments.length === 0;
  if (/^\[\[\.\.\..+\]\]$/.test(head)) return true;
  if (/^\[\.\.\..+\]$/.test(head)) return segments.length >= 1;
  if (segments.length === 0) return false;
  if (/^\[.+\]$/.test(head) || head === segments[0]) return matches(rest, segments.slice(1));
  return false;
}

/** The addresses next.config.ts redirects from (as patterns), and the files in public/. */
function configured() {
  const config = readFileSync(path.join(web, "next.config.ts"), "utf8");
  const sources = [...config.matchAll(/source:\s*"(\/[^"]*)"/g)].map((m) => m[1]).filter((s) => !s.includes("(.*)") && !s.includes("(?!"));
  const redirects = sources.map((s) => s.replace(/\/:[a-zA-Z]+\*$/, "/[[...rest]]").replace(/:[a-zA-Z]+/g, "[x]").split("/").filter(Boolean));
  const dynamic = [...config.matchAll(/source:\s*`(\/[^`]*)`/g)].map((m) => m[1]).filter((s) => !s.includes("(.*)"));
  return { redirects: [...redirects, ...dynamic.map((s) => s.replace(/\$\{[^}]*\}/g, "[x]").replace(/:[a-zA-Z]+(\([^)]*\))?/g, "[x]").split("/").filter(Boolean))] };
}

const TEXT = /\.(tsx|ts)$/;
/** Plain-text internal addresses in the source: `href="/x"`, `href: "/x"`, `href='/x'`, `href={"/x"}`, with no `${}` and no query or hash. */
function literals(source) {
  const out = [];
  for (const line of source.split("\n")) {
    if (/^\s*(\/\/|\/?\*)/.test(line)) continue;
    for (const m of line.matchAll(/\bhref(?:=\{?|:\s*)(["'`])(\/[^"'`$\s{}]*)\1/g)) out.push(m[2]);
  }
  return out.map((h) => h.split(/[?#]/)[0]).filter((h) => h.length > 0);
}

const known = () => {
  const patterns = [...routes(), ...configured().redirects];
  const publicDir = path.join(web, "public");
  return (href) => {
    const segments = href.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    if (patterns.some((p) => matches(p, segments))) return true;
    const file = path.join(publicDir, ...segments);
    return segments.length > 0 && existsSync(file) && statSync(file).isFile();
  };
};

test("a route pattern is matched the way Next reads it", () => {
  assert.ok(matches(["programs", "[slug]"], ["programs", "jayton"]));
  assert.ok(!matches(["programs", "[slug]"], ["programs"]));
  assert.ok(!matches(["programs", "[slug]"], ["programs", "a", "b"]));
  assert.ok(matches(["results", "[[...path]]"], ["results"]));
  assert.ok(matches(["results", "[[...path]]"], ["results", "2025", "9"]));
  assert.ok(matches(["a", "[...x]"], ["a", "b", "c"]) && !matches(["a", "[...x]"], ["a"]));
  assert.ok(matches([], []) && !matches([], ["x"]));
});

test("plain-text addresses are found, and comments and built addresses are not", () => {
  assert.deepEqual(literals('<Link href="/scores?x=1">a</Link> <a href="/rankings#top">'), ["/scores", "/rankings"]);
  assert.deepEqual(literals('{ href: "/playoffs", label: "x" }, href={`/programs/${slug}`}, href="https://a.b/c", href="/a/b"'), ["/playoffs", "/a/b"]);
  assert.deepEqual(literals('// href="/nowhere"\n * href="/nowhere"'), []);
});

test("the site's routes include the sections the header lists", () => {
  const has = known();
  for (const h of ["/", "/scores", "/playoffs", "/programs", "/rankings", "/results", "/standings", "/championships", "/records", "/search", "/matchup", "/seasons", "/welcome", "/privacy", "/terms", "/programs/jayton", "/results/2025/9/tapps", "/sitemap.xml", "/robots.txt", "/ratings", "/champions"]) {
    assert.ok(has(h), h);
  }
  assert.ok(!has("/no-such-section") && !has("/scores/a/b/c"));
});

test("every address written out in a page's source has a route", () => {
  const has = known();
  const missing = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walk(path.join(web, dir))) {
      if (!TEXT.test(file)) continue;
      for (const href of literals(readFileSync(file, "utf8"))) if (!has(href)) missing.push(`${path.relative(web, file)}: ${href}`);
    }
  }
  assert.deepEqual(missing, []);
});
