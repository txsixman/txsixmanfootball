// The embeddable scoreboard's page (lib/embed-html.ts, ADR 0023): escaping, the theme script, the CSP and the document.   node --test apps/web/scripts/
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { EMBED_HEIGHT, THEME_SCRIPT, embedCsp, embedSnippet, escapeHtml, renderEmbed } from "../lib/embed-html.ts";

const view = (over = {}) => ({
  slug: "jayton",
  school: "Jayton",
  season: 2026,
  crest: { kind: "badge", text: "J", bg: "#111111", fg: "#ffffff", stripe: null },
  band: { bg: "#111111", fg: "#ffffff", stripe: "#c99700" },
  record: "9-1",
  recent: [{ status: "Thu 11/5", home: true, opponent: "Spur", score: "60-0" }],
  next: { status: "Fri 11/13", home: false, opponent: "Kress", score: null, note: "Projected: Jayton by 45+" },
  ...over,
});

/** Runs the theme script against an address and returns the data-theme it set (null when it set none). */
function themeFor(search) {
  let set = null;
  const document = { documentElement: { setAttribute: (k, v) => k === "data-theme" && (set = v) } };
  new Function("location", "document", THEME_SCRIPT)({ search }, document);
  return set;
}

test("escapeHtml turns every character that could open a tag or leave an attribute into text", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script> & 'y'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
  assert.equal(escapeHtml("St. Paul's"), "St. Paul&#39;s");
});

test("the theme script accepts light, dark and auto, and ignores everything else", () => {
  for (const t of ["light", "dark", "auto"]) assert.equal(themeFor(`?theme=${t}`), t);
  assert.equal(themeFor("?x=1&theme=dark"), "dark");
  for (const bad of ["", "?theme=", "?theme=x", "?theme=DARK", "?theme=<script>", "?theme=dark%22", "?theme=light,dark", "?other=dark"]) assert.equal(themeFor(bad), null, bad);
  assert.doesNotMatch(THEME_SCRIPT, /<\/script/i);
});

test("the CSP allows only the theme script's own hash, and the pieces the brief names", () => {
  const csp = embedCsp();
  assert.ok(csp.includes(`script-src 'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'`));
  for (const part of ["default-src 'none'", "img-src 'self'", "style-src 'unsafe-inline'", "base-uri 'none'", "form-action 'none'", "frame-ancestors *"]) assert.ok(csp.includes(part), part);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
});

test("the page carries the theme script once, noindex, and the absolute link that opens in a new tab", () => {
  const html = renderEmbed(view());
  assert.equal([...html.matchAll(/<script/g)].length, 1);
  assert.ok(html.includes(`<script>${THEME_SCRIPT}</script>`));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.includes('<a href="https://txsixmanfootball.com/programs/jayton" target="_blank" rel="noopener">Full schedule on TX Six-Man Football</a>'));
  assert.doesNotMatch(html, /<script[^>]*src=|<link|<iframe|onerror=|onclick=/i);
});

test("a name with markup in it, in any field, comes out as text", () => {
  const evil = `</title><img src=x onerror=alert(1)>"`;
  const html = renderEmbed(
    view({
      school: evil,
      record: evil,
      recent: [{ status: evil, home: true, opponent: evil, score: evil }],
      next: { status: evil, home: false, opponent: evil, score: null, note: evil },
      crest: { kind: "logo", src: `/logos/"><script>x</script>.webp`, width: 48, height: 48, tile: "red;background:url(x)" },
      band: { bg: "red", fg: "url(x)", stripe: "#12345" },
    }),
  );
  assert.doesNotMatch(html, /<img src=x|<script>x|onerror=alert\(1\)>/);
  assert.equal([...html.matchAll(/<script/g)].length, 1);
  assert.doesNotMatch(html, /url\(x\)|background:red;/); // a color is a plain hex color or the default
});

test("a forfeit shows the word, an unplayed game shows no score, and no row names a winner", () => {
  const html = renderEmbed(view({ recent: [{ status: "Fri 9/4", home: false, opponent: "Avalon", score: "Forfeit" }] }));
  assert.ok(html.includes('<b class="s">Forfeit</b>'));
  assert.doesNotMatch(html, /\b(1-0|2-0)\b/);
  assert.doesNotMatch(html, /\b(won|beat|defeated|winner)\b/i);
  assert.ok(html.includes("Scores are not confirmed here."));
});

test("a program with no games says so and shows no unconfirmed-score note", () => {
  const html = renderEmbed(view({ record: null, recent: [], next: null }));
  assert.ok(html.includes("No 2026 games on record yet."));
  assert.doesNotMatch(html, /not confirmed|record</);
});

test("the snippet is the iframe a school pastes: the address, an escaped title, the height", () => {
  assert.equal(
    embedSnippet("jayton", `Jay "ton" & Co`),
    `<iframe src="https://txsixmanfootball.com/embed/programs/jayton" title="Jay &quot;ton&quot; &amp; Co scores" width="100%" height="${EMBED_HEIGHT}" style="border:0" loading="lazy"></iframe>`,
  );
});

test("a next game dated before tonight is headed as waiting on its score, never as still to play", () => {
  assert.match(renderEmbed(view()), /<h2 id="n">Next game<\/h2>/);
  const waiting = renderEmbed(view({ nextWaiting: true }));
  assert.match(waiting, /<h2 id="n">Score not in yet<\/h2>/);
  assert.ok(!waiting.includes("Next game"));
});

test("a playoff game reads vs, never at: its home team is the bracket's designation, not where it is played (ADR 0037)", () => {
  const away = (playoff) => renderEmbed(view({ next: { status: "Fri 11/13", home: false, opponent: "Kress", score: null, ...(playoff && { playoff: true }) } }));
  assert.match(away(false), /<span>at Kress<\/span>/);
  assert.match(away(true), /<span>vs Kress<\/span>/);
});
