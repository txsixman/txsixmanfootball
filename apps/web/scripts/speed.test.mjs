// Phone-speed rules that CI's Lighthouse run cannot see (ADR 0100): what a page sends beyond its HTML, and what it fetches
// in the background while a fan scrolls. Run: node --test apps/web/scripts/speed.test.mjs
//   1. The scores board's props (they travel in the page's data as well as drawing the HTML) stay under a byte budget, on
//      the real games and crests, and carry no field the board never reads.
//   2. A list of links to pages of 5 to 30 KB each (games, brackets, seasons) does not prefetch them as the list scrolls by.
//   3. Nothing ships tailwind-merge, and the layout, the home page's "My teams" and the header keep their heavy code out of
//      the scripts every page loads.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync } from "node:zlib";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(WEB, file), "utf8");
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const br = (v) => brotliCompressSync(Buffer.from(JSON.stringify(v))).length;

/** Every `<Link ...>` opening tag of a file (attributes may hold braces, strings and arrows). */
function linkTags(source) {
  const tags = [];
  for (let i = source.indexOf("<Link"); i >= 0; i = source.indexOf("<Link", i + 5)) {
    let depth = 0, quote = null, j = i + 5;
    for (; j < source.length; j++) {
      const c = source[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(source.slice(i, j + 1));
  }
  return tags;
}

test("the scores board is sent only what it draws, in few bytes", async () => {
  process.chdir(WEB); // the loaders read ../../data from the working directory, as `next build` runs them
  const tmp = mkdtempSync(path.join(tmpdir(), "speed-"));
  try {
    await build({
      entryPoints: [path.join(WEB, "lib/board-wire.ts"), path.join(WEB, "lib/games.ts"), path.join(WEB, "lib/alignments.ts"), path.join(WEB, "lib/identity.ts")],
      bundle: true, splitting: true, platform: "node", format: "esm", outdir: tmp, logLevel: "error",
    });
    const load = (name) => import(pathToFileURL(path.join(tmp, `${name}.js`)).href);
    const { boardGame, boardCrests } = await load("board-wire");
    const { loadGames } = await load("games");
    const { loadAlignments, slugify } = await load("alignments");
    const { loadIdentities, EMPTY } = await load("identity");
    const alignments = await loadAlignments();
    const games = await loadGames(alignments);
    assert.ok(games.length > 20, "the real season's games are loaded");
    const identities = await loadIdentities();
    const crests = Object.fromEntries(games.flatMap((g) => [g.home.name, g.away.name]).map((name) => [name, identities.get(slugify(name)) ?? EMPTY]));

    const wire = games.map(boardGame);
    const slim = boardCrests(crests);
    // No field the board never reads, and no key that is only `undefined` (it travels as "$undefined").
    for (const g of wire) {
      for (const k of ["venue", "address", "projectedMargin", "stream", "quarters"]) assert.ok(!(k in g), `a game carries ${k}`);
      for (const t of [g.home, g.away]) assert.deepEqual(Object.keys(t).filter((k) => !["name", "record", "rank"].includes(k)), [], "a team carries more than its name, record and rank");
      for (const [k, v] of Object.entries(g)) assert.notEqual(v, undefined, `${k} is undefined`);
    }
    for (const c of Object.values(slim)) assert.deepEqual(Object.keys(c).sort(), ["logo", "theme"]);
    // What the board draws is unchanged by the trimming: names, records, scores, states.
    wire.forEach((g, i) => {
      for (const k of ["id", "date", "league", "state", "status", "homeScore", "awayScore", "verification", "projected", "kickoff", "endReason", "sources"]) assert.equal(g[k], games[i][k]);
      assert.equal(g.home.name, games[i].home.name);
      assert.equal(g.away.record, games[i].away.record);
    });

    // Per game and per crest, so a bigger season does not fail it: before (Nov 16) a game was about 650 bytes and a crest about 300.
    const perGame = bytes(wire) / wire.length;
    const perCrest = bytes(slim) / Object.keys(slim).length;
    console.log(`board props: ${wire.length} games ${bytes(wire)} B (${br(wire)} B brotli, ${perGame.toFixed(0)}/game), ${Object.keys(slim).length} crests ${bytes(slim)} B (${br(slim)} B brotli, ${perCrest.toFixed(0)}/crest)`);
    assert.ok(perGame < 470, `a game is ${perGame.toFixed(0)} bytes on the wire (budget 470)`);
    assert.ok(perCrest < 190, `a crest is ${perCrest.toFixed(0)} bytes on the wire (budget 190)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Link tags that go to a page of several KB and sit in a list: each must say prefetch={false}. Next prefetches a link's whole page
// when it scrolls into view, so a scrolled list of 40 games fetched 40 x 5 to 7 KB in the background (ADR 0100). A short list a fan
// taps through at once (the home page's games, tonight's board) keeps its prefetch, and is not in this table.
const NOT_PREFETCHED = [
  ["app/programs/[slug]/page.tsx", "href={r.href}"],
  ["app/programs/[slug]/page.tsx", "href={m.href}"],
  ["app/playoffs/tree/board.tsx", "href={box.href}"],
  ["app/playoffs/tree/rounds.tsx", "href={box.href}"],
  ["app/scores/board.tsx", "href={`/scores/${g.id}`}"],
  ["app/scores/game-extras.tsx", "href={m.href}"],
  ["app/results/view.tsx", "href={g.href}"],
  ["app/series/[first]/[second]/page.tsx", "href={r.href}"],
  ["app/playoffs/view.tsx", "href={bracketHref(b.name)}"],
  ["app/playoffs/view.tsx", "#whos-left`}"],
  ["app/playoffs/this-round/page.tsx", "href={bracketHref(b.name)}"],
  ["app/seasons/view.tsx", "href={`/seasons/${h.season}`}"],
  ["app/championships/shared.tsx", "href={`/championships/${f.season}`}"],
  ["app/championships/shared.tsx", "href={c.href}"],
];

test("long lists of links do not prefetch their pages", () => {
  for (const [file, snippet] of NOT_PREFETCHED) {
    const tags = linkTags(read(file)).filter((t) => t.includes(snippet));
    assert.ok(tags.length > 0, `${file} has no <Link> with ${snippet}: update this table with the code`);
    for (const t of tags) assert.match(t, /prefetch=\{false\}/, `${file}: ${t.replace(/\s+/g, " ").slice(0, 120)}`);
  }
});

function* sources(dir) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(ts|tsx)$/.test(e)) yield p;
  }
}

test("tailwind-merge stays out of the scripts every page loads", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["tailwind-merge"], undefined, "tailwind-merge is a dependency again");
  for (const dir of ["app", "components", "lib"]) {
    for (const file of sources(path.join(WEB, dir))) assert.ok(!/tailwind-merge|twMerge/.test(readFileSync(file, "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), `${path.relative(WEB, file)} uses tailwind-merge`);
  }
});

test("the layout, the header and the home page load their heavy code late", () => {
  const layout = read("app/layout.tsx");
  assert.ok(!/from "@vercel\//.test(layout), "the layout imports Vercel's scripts again: they load in the first scripts of every page (vercel-insights.tsx waits for idle)");
  assert.match(read("app/vercel-insights.tsx"), /requestIdleCallback/);
  const myTeams = read("app/my-teams/block.tsx");
  for (const heavy of ["./alerts-toggle", "../scores/live-game", "../programs/crest"]) assert.ok(!myTeams.includes(`from "${heavy}"`), `my-teams/block.tsx imports ${heavy} statically: it is loaded for every visitor to the home page, follower or not (view.tsx loads late)`);
  assert.match(myTeams, /dynamic\(\(\) => import\(".\/view"\)/);
});

// Repeated markup is named once (ADR 0105). A row of a long list repeats its class text in the page's HTML and again in the page's
// data, so the rows' looks live in app/globals.css as `@utility` names, under the "Repeated markup" comment. Each name must still be
// used (a dead one is dead CSS), and no source may spell out a named list again beside its name: that is how a page grows back.
test("repeated row styles are named once and used", () => {
  const css = read("app/globals.css");
  const section = css.slice(css.indexOf("/* Repeated markup"));
  const named = [...section.matchAll(/@utility ([a-z0-9-]+) \{\n  @apply ([^;]+);\n\}/g)].map((m) => ({ name: m[1], list: m[2] }));
  assert.ok(named.length >= 60, `only ${named.length} named styles: the repeated markup went back into the pages`);
  const files = [];
  for (const dir of ["app", "components"]) for (const file of sources(path.join(WEB, dir))) if (file.endsWith(".tsx")) files.push([path.relative(WEB, file), readFileSync(file, "utf8")]);
  const usage = (name) => new RegExp(`["\`\\s]${name}["\`\\s]`);
  for (const { name, list } of named) {
    assert.ok(files.some(([, text]) => usage(name).test(text)), `.${name} is in globals.css and used nowhere`);
    // The scores board and tonight's board (app/scores) are left as they were: their first paint is ADR 0103's, and e2e reads their classes.
    for (const [file, text] of files.filter(([file]) => !file.startsWith("app/scores/"))) assert.ok(!text.includes(`"${list}"`), `${file} spells out the classes of .${name}: use the name`);
  }
});

// The heaviest page's markup, counted on the source: a long list's row no longer carries a class text that a name covers. The byte
// budgets of the built pages are in e2e/page-bytes.spec.ts (CI's page tests).
test("the shared crest and board row use their names", () => {
  assert.match(read("app/programs/crest.tsx"), /crest-box/);
  assert.match(read("app/programs/crest.tsx"), /crest-badge/);
  assert.match(read("app/ui.tsx"), /crest-slot/);
  assert.match(read("app/ui.tsx"), /brd-row/);
});
