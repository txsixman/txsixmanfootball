// Structured data (lib/json-ld.ts): valid schema.org types and nesting, ISO 8601 dates, absolute URLs, nothing empty, no
// score that names a winner, no source named.   node --test apps/web/scripts/json-ld.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "json-ld-"));
const outfile = path.join(tmp, "json-ld.mjs");
await build({ entryPoints: [path.join(WEB, "lib/json-ld.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "error" });
const ld = await import(pathToFileURL(outfile).href);
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const SITE = "https://txsixmanfootball.com";
const team = (name) => ({ name, mascot: "", initials: "XX", color: "#000", record: "" });
const game = (over = {}) => ({
  id: "x", date: "2026-11-13", league: "UIL", home: team("Jayton"), away: team("Kress"), homeScore: 75, awayScore: 6,
  state: "final", status: "Final", verification: "confirmed", venue: "Jayton (home)", ...over,
});
const url = `${SITE}/scores/x`;
const BANNED = /maxpreps|hudl|calpreps|(?<!tx)sixmanfootball\.com|dave campbell|\b(odds|spreads?|bets?|betting|underdogs?|favou?rites?)\b|undefined|\bwinner\b/i;
/** Every value in a block: a string, never empty, never the word "undefined"; every url-like key is absolute on the site. */
function walk(node, key = "") {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, key));
  if (node && typeof node === "object") return Object.entries(node).forEach(([k, v]) => walk(v, k));
  assert.notEqual(node, undefined, key);
  assert.notEqual(node, null, key);
  if (typeof node === "string") {
    assert.ok(node.trim().length > 0, `${key} is empty`);
    assert.doesNotMatch(node, BANNED, `${key}: ${node}`);
    if (["url", "item", "logo"].includes(key)) assert.match(node, new RegExp(`^${SITE}/`), `${key} is not absolute: ${node}`);
    if (key === "startDate") assert.match(node, /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/, `${key} is not ISO 8601: ${node}`);
  }
}
const valid = (data) => {
  walk(data);
  assert.equal(data["@context"], "https://schema.org");
  return data;
};

test("a game at a team's own field names home and away teams as SportsTeam, the site as a Place and a date", () => {
  const e = valid(ld.gameJsonLd(game(), { url, home: { slug: "jayton" }, away: { slug: "kress" } }));
  assert.equal(e["@type"], "SportsEvent");
  assert.equal(e.startDate, "2026-11-13");
  assert.equal(e.eventAttendanceMode, "https://schema.org/OfflineEventAttendanceMode");
  assert.deepEqual(e.homeTeam, { "@type": "SportsTeam", name: "Jayton", sport: "Six-man football", url: `${SITE}/programs/jayton` });
  assert.deepEqual(e.awayTeam, { "@type": "SportsTeam", name: "Kress", sport: "Six-man football", url: `${SITE}/programs/kress` });
  assert.deepEqual(e.location, { "@type": "Place", name: "Jayton home field" });
  assert.equal(e.competitor, undefined);
});

test("a game with a kickoff uses the full UTC time, and a bracket game's site is its place", () => {
  const e = valid(ld.gameJsonLd(game({ state: "scheduled", homeScore: null, awayScore: null, verification: "none", kickoff: "2026-11-14T00:30:00Z", venue: "Findlay Field, Menard" }), { url }));
  assert.equal(e.startDate, "2026-11-14T00:30:00Z");
  assert.equal(e.eventStatus, "https://schema.org/EventScheduled");
  assert.deepEqual(e.location, { "@type": "Place", name: "Findlay Field, Menard" });
  assert.equal(e.homeTeam, undefined);
  assert.deepEqual(e.competitor.map((t) => t.name), ["Kress", "Jayton"]);
  assert.ok(e.competitor.every((t) => t["@type"] === "SportsTeam"));
  assert.equal(e.description, undefined);
});

test("a site not listed is left out, never guessed", () => {
  for (const venue of ["Site not listed", "Site not listed yet", "Neutral site or not listed"]) {
    const e = valid(ld.gameJsonLd(game({ venue }), { url }));
    assert.equal("location" in e, false, venue);
  }
});

test("only a confirmed, played final carries its score; a forfeit, a dispute and an unplayed game carry none", () => {
  assert.equal(ld.gameJsonLd(game(), { url }).description, "Final: Kress 6, Jayton 75.");
  for (const over of [
    { endReason: "Forfeit", homeScore: null, awayScore: null },
    { verification: "disputed" },
    { verification: "unconfirmed" },
    { state: "scheduled", homeScore: null, awayScore: null, verification: "none" },
    { state: "postponed", homeScore: null, awayScore: null, verification: "none" },
  ]) {
    const e = valid(ld.gameJsonLd(game(over), { url }));
    assert.equal("description" in e, false, JSON.stringify(over));
    assert.doesNotMatch(JSON.stringify(e), /\b75\b|\b6\b/);
  }
  assert.equal(ld.gameJsonLd(game({ state: "postponed", homeScore: null, awayScore: null }), { url }).eventStatus, "https://schema.org/EventPostponed");
});

test("a game with no date has no startDate", () => {
  assert.equal("startDate" in ld.gameJsonLd(game({ date: undefined }), { url }), false);
});

test("a program is a SportsTeam with an absolute logo and a league it belongs to, or neither", () => {
  const p = valid(ld.programJsonLd({ name: "Jayton", slug: "jayton", league: "UIL", logo: "/logos/jayton.png" }));
  assert.equal(p["@type"], "SportsTeam");
  assert.equal(p.url, `${SITE}/programs/jayton`);
  assert.equal(p.logo, `${SITE}/logos/jayton.png`);
  assert.deepEqual(p.memberOf, { "@type": "SportsOrganization", name: "UIL" });
  const bare = valid(ld.programJsonLd({ name: "CenTex Chargers", slug: "centex-chargers" }));
  assert.equal("logo" in bare, false);
  assert.equal("memberOf" in bare, false);
  assert.equal("sameAs" in bare, false);
});

test("a trail is a BreadcrumbList of positioned, absolute items", () => {
  const b = valid(ld.breadcrumbList([{ name: "Home", href: "/" }, { name: "UIL playoffs", href: "/playoffs" }, { name: "Division I", href: "/playoffs/bracket/uil-division-i" }]));
  assert.equal(b["@type"], "BreadcrumbList");
  assert.deepEqual(b.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.equal(b.itemListElement[2].item, `${SITE}/playoffs/bracket/uil-division-i`);
});

test("the home page names the site", () => {
  const w = valid(ld.websiteJsonLd());
  assert.equal(w["@type"], "WebSite");
  assert.equal(w.name, "TX Six-Man Football");
  assert.equal(w.url, `${SITE}/`);
});

test("a bracket's games are an ItemList of SportsEvent, each with its page, its day and two competing teams, and no score", () => {
  const list = valid(ld.bracketGamesList("UIL Division I games", [
    { away: "Kress", home: "Jayton", date: "2026-11-13", url: `${SITE}/scores/2026-bi-district-kress-at-jayton` },
    { away: "Borden County", home: "Water Valley", date: "2026-11-20", kickoff: "2026-11-21T01:00:00Z", url: `${SITE}/scores/2026-area-borden-county-at-water-valley` },
  ]));
  assert.equal(list["@type"], "ItemList");
  assert.deepEqual(list.itemListElement.map((i) => i.position), [1, 2]);
  const [a, b] = list.itemListElement.map((i) => i.item);
  assert.equal(a["@type"], "SportsEvent");
  assert.equal(a.url, `${SITE}/scores/2026-bi-district-kress-at-jayton`);
  assert.equal(a.startDate, "2026-11-13");
  assert.equal(b.startDate, "2026-11-21T01:00:00Z");
  assert.deepEqual(a.competitor.map((t) => [t["@type"], t.name]), [["SportsTeam", "Kress"], ["SportsTeam", "Jayton"]]);
  for (const e of [a, b]) {
    assert.equal("location" in e, false);
    assert.equal("description" in e, false);
    assert.equal("homeTeam" in e, false);
  }
  assert.doesNotMatch(JSON.stringify(list), /"description"|Final:|Score/);
});

test("a list of pages is positioned and absolute", () => {
  const l = valid(ld.rankedList("UIL playoff brackets", [{ name: "UIL Division I", href: "/playoffs/bracket/uil-division-i" }]));
  assert.equal(l.itemListElement[0].url, `${SITE}/playoffs/bracket/uil-division-i`);
});

test("the script text drops empty values and cannot close the tag", () => {
  const text = ld.jsonLdText({ name: "</script><b>x", empty: "", none: null, nested: { also: "" }, ok: "yes" });
  assert.doesNotMatch(text, /<\/script>/);
  assert.deepEqual(JSON.parse(text), { name: "</script><b>x", nested: {}, ok: "yes" });
});
