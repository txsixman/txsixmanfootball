// Search (lib/find.ts, lib/find-index.ts, ADR 0090): a table of what fans type and the first thing each should open, run
// against the real index the build makes (every program, mascot, other name, series page and season page), plus the
// rules behind it: exact and prefix names first, a misspelling found, two teams a game, a year a season, a small index.
//   node --test apps/web/scripts/find.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { brotliCompressSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(WEB); // the loaders read ../../data from the working directory, as `next build` runs them
const tmp = mkdtempSync(path.join(tmpdir(), "find-"));
await build({
  entryPoints: [path.join(WEB, "lib/find.ts"), path.join(WEB, "lib/find-index.ts"), path.join(WEB, "lib/series-data.ts")],
  bundle: true, splitting: true, platform: "node", format: "esm", outdir: tmp, logLevel: "error",
});
const load = (name) => import(pathToFileURL(path.join(tmp, `${name}.js`)).href);
const find = await load("find");
const { loadFindIndex, ranges, packPairs } = await load("find-index");
const { loadSeries } = await load("series-data");
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const wire = await loadFindIndex();
const search = find.searcher(wire);
const first = (q) => search(q).hits[0];

// What fans type, and the first thing it opens. `href` is the first result's address.
const TABLE = [
  // a town, a school, its mascot
  ["Jayton", "/programs/jayton"],
  ["jayton", "/programs/jayton"],
  ["  JAYTON  ", "/programs/jayton"],
  ["Jay", "/programs/jayton"],
  ["Jaybirds", "/programs/jayton"],
  ["jaybird", "/programs/jayton"],
  ["Lubbock", "/programs/lubbock-titans"],
  ["Antelopes", "/programs/whiteface"],
  ["Ira", "/programs/ira"],
  // abbreviations
  ["CHANT", "/programs/christian-homeschool-athletes-of-north-texas-chant"],
  ["chant", "/programs/christian-homeschool-athletes-of-north-texas-chant"],
  ["FWC", "/programs/covenant-classical-fort-worth"],
  ["THESA", "/programs/texas-home-educators-sports-association-thesa"],
  ["JCSA", "/programs/johnson-county-sports-association-jcsa"],
  // misspellings and spacing
  ["White Face", "/programs/whiteface"],
  ["Whitface", "/programs/whiteface"],
  ["Whiteface", "/programs/whiteface"],
  ["Jyaton", "/programs/jayton"],
  ["Jaton", "/programs/jayton"],
  ["Lubock", "/programs/lubbock-titans"],
  ["Earth Spring Lake", "/programs/earth-springlake"],
  ["Wellman Union", "/programs/wellman-union"],
  // other names of one school
  ["Welman", "/programs/wellman-union"],
  ["Spring Lake", "/programs/earth-springlake"],
  // school names with ISD, Christian, Academy, Saint and Fort
  ["Whiteface ISD", "/programs/whiteface"],
  ["Jayton ISD", "/programs/jayton"],
  ["Abilene Christian", "/programs/abilene-christian-school"],
  ["abilene christian school", "/programs/abilene-christian-school"],
  ["Sherman Grayson Christian ISD", "/programs/sherman-grayson-christian-school"],
  ["Grayson", "/programs/sherman-grayson-christian-school"],
  ["Kings Academy", "/programs/kings-academy-tyler"],
  ["Grace Academy", "/programs/grace-academy-griffins"],
  ["Faith Academy of Bellville", "/programs/faith-academy-of-bellville"],
  ["St Marys", "/programs/st-marys"],
  ["Saint Mary", "/programs/st-marys"],
  ["Cobras", "/programs/victoria-inc-cobras"],
  // two teams are a game: its series page when they have played, else the matchup page
  ["jayton whiteface", "/matchup?a=jayton&b=whiteface"],
  ["Jayton vs Whiteface", "/matchup?a=jayton&b=whiteface"],
  ["white face jayton", "/matchup?a=whiteface&b=jayton"],
  ["Earth Springlake Whitharral", "/series/earth-springlake/whitharral"],
  ["whitharral at earth springlake", "/series/earth-springlake/whitharral"],
  ["Earth Springlake v Whitharral", "/series/earth-springlake/whitharral"],
  // a year with a team is that team's season; a year alone is the season and its State Championships
  ["2024 jayton", "/programs/jayton/2024"],
  ["jayton 2025", "/programs/jayton/2025"],
  ["2025 whiteface", "/programs/whiteface/2025"],
  ["2024", "/seasons/2024"],
  ["1990", "/championships/1990"],
];

test("what fans type opens the right first result", () => {
  const wrong = TABLE.flatMap(([q, href]) => (first(q)?.href === href ? [] : [`${JSON.stringify(q)}: wanted ${href}, got ${first(q)?.href}`]));
  assert.deepEqual(wrong, []);
});

test("a game is a game result first, with both teams under it; a pair that never met opens the matchup page", () => {
  const { hits } = search("jayton whiteface");
  assert.deepEqual(hits.map((h) => h.kind), ["game", "team", "team"]);
  assert.equal(hits[0].title, "Jayton vs Whiteface");
  assert.match(hits[0].sub, /No game between them/);
  const met = search("Earth Springlake vs Whitharral").hits[0];
  assert.equal(met.sub, "Every game they have played");
});

test("every series page the build makes is a set bit, and a pair with none is not", async () => {
  const series = await loadSeries();
  assert.ok(series.length > 1000, "the series pages");
  const slugs = find.decode(wire.entries).map((e) => e.slug);
  const have = new Set(series.map((s) => `${s.first}|${s.second}`));
  const bytes = atob(wire.pairs);
  const bit = (i, j) => {
    const [lo, hi] = i < j ? [i, j] : [j, i];
    const n = (hi * (hi - 1)) / 2 + lo;
    return (bytes.charCodeAt(n >> 3) >> (n & 7)) & 1;
  };
  let set = 0;
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const expected = have.has(`${slugs[i]}|${slugs[j]}`) || have.has(`${slugs[j]}|${slugs[i]}`);
      if (bit(i, j)) set++;
      assert.equal(bit(i, j) === 1, expected, `${slugs[i]} and ${slugs[j]}`);
    }
  }
  assert.equal(set, series.length);
  // The address a game result opens is the one the page is built at, in whichever order the teams were typed.
  const byHref = new Set(series.map((s) => `/series/${s.first}/${s.second}`));
  for (const s of series.slice(0, 400)) {
    const typed = find.searcher(wire)(`${s.second.replace(/-/g, " ")} vs ${s.first.replace(/-/g, " ")}`).hits[0];
    if (typed.kind === "game") assert.ok(byHref.has(typed.href) || typed.href.startsWith("/matchup"), typed.href);
  }
});

test("an exact name ranks above a name it is the start of, and a prefix above a word inside", () => {
  // "Ira" is a whole name; nothing longer outranks it. "Grace" starts several names; each starts with it, ahead of any that only contain it.
  assert.equal(first("Ira").entry.school, "Ira");
  const grace = search("Grace").hits.map((h) => h.entry.school);
  assert.ok(grace.length >= 3);
  const startsWith = grace.map((s) => s.toLowerCase().startsWith("grace"));
  assert.deepEqual(startsWith, [...startsWith].sort((a, b) => Number(b) - Number(a)), "names that start with it come first");
  // A whole school name beats a school whose name is only a longer one: "Faith Academy of Bellville" over "...Marble Falls".
  assert.equal(first("Faith Academy of Bellville").entry.slug, "faith-academy-of-bellville");
});

test("a typo is guessed at only when nothing matches as typed, and the guess is not offered beside a real match", () => {
  assert.deepEqual(search("Jayton").hits.map((h) => h.entry.slug), ["jayton"]);
  assert.equal(search("Jyaton").hits[0].entry.slug, "jayton");
});

test("a team's line says its league, place and, where there is one, its town and mascot, so same-named schools differ", () => {
  const { hits } = search("Lubbock");
  const subs = hits.map((h) => h.sub);
  assert.ok(subs.some((s) => /TAIAO/.test(s)) && subs.some((s) => /Lubbock · .*TAPPS Division III · District 1/.test(s)), subs.join(" | "));
  assert.match(first("Jayton").sub, /^Jaybirds · UIL Division I · Region \d · District \d$/);
  // A school listed by two organizations names both.
  assert.match(first("Sherman Grayson Christian").sub, /TAIAO.*; .*TCAF/);
  // No two programs read the same line unless they are the same school.
  const lines = new Map();
  for (const e of find.decode(wire.entries)) {
    const line = `${e.school}|${find.describe(e)}`;
    assert.ok(!lines.has(line), line);
    lines.set(line, 1);
  }
});

test("a league name lists its programs, cut to the limit", () => {
  const tcaf = search("TCAF");
  assert.equal(tcaf.total, 9);
  assert.ok(tcaf.hits.every((h) => /TCAF/.test(h.sub)));
  assert.ok(search("UIL").total > 100);
  assert.equal(search("UIL").hits.length, find.LIMIT, "a long list is cut to the limit");
});

test("nothing found: no result, a closest name when one is near, and a year with no page has none", () => {
  const none = search("xyzzy");
  assert.deepEqual([none.hits.length, none.total, none.closest], [0, 0, undefined]);
  assert.equal(search("wxxtxface").closest?.school, "Whiteface");
  assert.equal(search("1066").hits.length, 0);
  assert.equal(search("").hits.length, 0);
  assert.equal(search("   ").hits.length, 0);
  assert.equal(search("!!").hits.length, 0);
});

test("the index is small: bytes sent to the page", () => {
  const json = JSON.stringify(wire);
  const brotli = brotliCompressSync(Buffer.from(json)).length;
  console.log(`search index: ${wire.entries.length} programs, ${json.length} bytes, ${brotli} bytes brotli`);
  assert.ok(json.length < 60_000, `${json.length} bytes`);
  assert.ok(brotli < 12_000, `${brotli} bytes brotli`);
});

test("seasons are written as ranges and the pair bits as the format says", () => {
  assert.equal(ranges([2018, 2019, 2020, 2022]), "2018-2020, 2022");
  assert.equal(ranges([]), "");
  assert.equal(ranges([2021]), "2021");
  const bytes = atob(packPairs([[0, 1], [2, 3]], 4));
  assert.equal(bytes.charCodeAt(0), 0b0010_0001, "(0,1) is bit 0 and (2,3) is bit 5");
});

test("edit distance counts a swap as one edit and stops early", () => {
  assert.equal(find.distance("jayton", "jyaton", 2), 1);
  assert.equal(find.distance("whiteface", "whitface", 2), 1);
  assert.equal(find.distance("abc", "xyz", 1), 2, "past the limit: any number above it");
});

test("the words the page says are plain: no betting word, no source", () => {
  const words = JSON.stringify(wire) + find.describe({ school: "x", where: ["y"], mascot: "z" });
  assert.doesNotMatch(words, /\b(spread|odds|bet|betting|upset|maxpreps|hudl|calpreps|sixmanfootball)\b/i);
});
