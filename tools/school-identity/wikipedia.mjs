// Fills missing school colors and mascots from English Wikipedia's article infobox, through the MediaWiki API
// (ADR 0006: Wikipedia text for facts only, never its images). Writes candidate rows for merge.mjs to fill gaps.
// Usage: node wikipedia.mjs <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IDENTITY } from "./fetch-logos.mjs";
import { knownSchools } from "./merge.mjs";

const API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "Project80x40-school-facts/1.0 (private research build)";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// One request a second, and Wikipedia's own Retry-After on a 429, so a full run stays polite.
async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params })}`;
  for (let attempt = 1; ; attempt += 1) {
    await pause(1000);
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt === 5) throw new Error(`Wikipedia API ${res.status}`);
    await pause(1000 * Math.min(60, Number(res.headers.get("retry-after")) || 5 * attempt));
  }
}

/** Strips refs, templates' wrappers, links and HTML from an infobox value. */
const WRAPPERS = /^(?:nowrap|small|nobr|ubl|unbulleted list|plainlist|plain list|hlist|flatlist|bulleted list|ublist)$/i;

export function plain(value) {
  let text = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[\s\S]*?<\/ref>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/^\s*\*+/gm, ", ")
    .replace(/\n/g, " ")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\{\{\s*(?:color ?box|colorbox|legend inline)[^}]*\}\}/gi, " ");
  // Wrapper and list templates keep their contents; any other template is dropped. Innermost first.
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/\{\{([^{}|]*)((?:\|[^{}]*)?)\}\}/g, (_, name, args) =>
      WRAPPERS.test(name.trim()) ? args.split("|").filter(Boolean).join(", ") : " ",
    );
  }
  return text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/'''?/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/(?:\s*,)+/g, ",")
    .replace(/,(?=\S)/g, ", ")
    .trim();
}

/** A value Wikipedia cites to MaxPreps is MaxPreps's compilation (ADR 0002), so it is skipped, not used. */
export function infoboxField(text, names) {
  // An article can hold two infoboxes (district and high school); the first value not cited to MaxPreps wins.
  const raw = fieldValues(text, names).find((v) => !/maxpreps/i.test(v) && plain(v));
  return raw ? plain(raw) : null;
}

function fieldValues(text, names) {
  const wikitext = text.replace(/<!--[\s\S]*?-->/g, "");
  return names.flatMap((name) =>
    [...wikitext.matchAll(new RegExp(`\\|\\s*${name}\\s*=`, "gi"))].map((m) => fieldValue(wikitext, m.index + m[0].length)),
  );
}

/** The value runs to the next "|" or "}}" outside any nested template or link, so multi-line lists stay whole. */
function fieldValue(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const two = text.slice(i, i + 2);
    if (two === "{{" || two === "[[") { depth += 1; i += 1; continue; }
    if (two === "}}" || two === "]]") {
      if (depth === 0) return text.slice(from, i);
      depth -= 1; i += 1; continue;
    }
    if (text[i] === "|" && depth === 0) return text.slice(from, i);
  }
  return text.slice(from);
}

/** "Maroon, White & Gold" -> ["maroon", "white", "gold"]. */
export const splitColors = (text) =>
  text
    .toLowerCase()
    .replace(/[()]/g, " ")
    .split(/,|\band\b|&|\/|;/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The search terms for a school name: TAPPS prints "School-City", UIL prints the town. */
function queries(school, league) {
  const base = school.replace(/\s*\(.*\)$/, "");
  const [name, city] = base.split(/-(?=[^-]+$)/);
  if (league === "UIL") return [`${base} Independent School District Texas`, `${base} High School Texas`];
  return [city ? `${name} ${city} Texas` : `${base} Texas school`];
}

const SCHOOL_WORD = /^(?:high|independent|consolidated|collegiate|common|junior|junior-senior|school|academy|isd|cisd|\()/i;

/** "Morgan High School" is named for Morgan; "Morgan Mill ISD" and any college are not. */
export function namedFor(title, name) {
  if (!title.toLowerCase().startsWith(name.toLowerCase()) || /universit|college/i.test(title)) return false;
  const rest = title.slice(name.length).trim();
  return /school|academy|district|isd\b/i.test(title) && (rest === "" || SCHOOL_WORD.test(rest));
}

async function article(school, league) {
  for (const q of queries(school, league)) {
    const hits = (await api({ action: "query", list: "search", srsearch: q, srlimit: "3" })).query.search;
    // TAPPS names are "School-City"; a UIL name such as Grandfalls-Royalty is one name.
    const base = school.replace(/\s*\(.*\)$/, "");
    const [name, city] = league === "UIL" ? [base, null] : base.split(/-(?=[^-]+$)/).map((s) => s.trim());
    for (const hit of hits) {
      // The article must be named for the school (not merely mention it) and be a school or district, never a college.
      if (!namedFor(hit.title, name)) continue;
      const page = await api({ action: "parse", page: hit.title, prop: "wikitext", section: "0", redirects: "1" });
      const text = page.parse?.wikitext ?? "";
      if (!/Texas/.test(text) || !/\{\{\s*Infobox/i.test(text)) continue;
      if (city && !text.toLowerCase().includes(city.toLowerCase())) continue;
      return { title: page.parse.title, text };
    }
  }
  return null;
}

const COLOR_FIELDS = ["colors", "colours", "school_colors", "school_colours", "athletics_colors"];
const MASCOT_FIELDS = ["mascot", "nickname", "athletics_nickname", "team_name"];

/**
 * Does the cited article still support the fact? The infobox field wins when present; otherwise each word of the
 * fact must appear in the article's text. Either way, a value or paragraph citing MaxPreps does not count (ADR 0002).
 */
export function supports(text, fields, words) {
  const wikitext = text.replace(/<!--[\s\S]*?-->/g, "");
  if (infoboxField(wikitext, fields)) return true;
  const paragraphs = wikitext.split(/\n\s*\n/);
  return words.every((w) => {
    const stem = w.toLowerCase().replace(/e?s$/, "");
    const found = paragraphs.filter((p) => plain(p).toLowerCase().includes(stem));
    return found.length > 0 && found.some((p) => !/maxpreps/i.test(p));
  });
}

/** --audit: re-reads every cited Wikipedia article and drops a fact it no longer supports. */
async function audit() {
  const data = JSON.parse(readFileSync(IDENTITY, "utf8"));
  const pages = new Map();
  const dropped = [];
  for (const [slug, s] of Object.entries(data.schools)) {
    for (const [key, source, fields] of [["colors", "colorsSource", COLOR_FIELDS], ["mascot", "mascotSource", MASCOT_FIELDS]]) {
      const url = s[source];
      if (!url?.startsWith("https://en.wikipedia.org/wiki/")) continue;
      const title = decodeURIComponent(url.slice(30).split("#")[0]).replace(/_/g, " ");
      if (!pages.has(title)) pages.set(title, (await api({ action: "parse", page: title, prop: "wikitext", redirects: "1" })).parse?.wikitext ?? "");
      const words = key === "colors" ? s.colors : [s.mascot];
      if (supports(pages.get(title), fields, words)) continue;
      s[key] = key === "colors" ? [] : null;
      s[source] = null;
      s.notes = `${s.notes ?? ""} Wikipedia ${key} dropped by audit: not on the cited page, or cited to MaxPreps.`.trim();
      dropped.push(`${slug} ${key}`);
    }
  }
  writeFileSync(IDENTITY, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`audit: ${dropped.length} Wikipedia facts dropped`);
  for (const d of dropped) console.log(`  ${d}`);
}

async function main() {
  if (process.argv[2] === "--audit") return audit();
  const out = process.argv[2];
  if (!out) throw new Error("usage: node wikipedia.mjs <out.json> | --audit");
  const data = JSON.parse(readFileSync(IDENTITY, "utf8"));
  const leagues = new Map();
  for (const dir of ["uil-2026-28", "tapps-2026-28", "private-2026"]) {
    const [, ...lines] = readFileSync(new URL(`../../data/seed/${dir}/alignments.csv`, import.meta.url), "utf8").trim().split("\n");
    for (const line of lines) leagues.set(line.split(",")[4], line.split(",")[0]);
  }
  const rows = [];
  let looked = 0;
  for (const [slug, school] of knownSchools()) {
    const have = data.schools[slug];
    if (have?.colors?.length && have?.mascot) continue;
    looked += 1;
    try {
      const found = await article(school, leagues.get(school));
      if (!found) continue;
      const source = `https://en.wikipedia.org/wiki/${encodeURIComponent(found.title.replace(/ /g, "_"))}`;
      const colors = infoboxField(found.text, COLOR_FIELDS);
      const mascot = infoboxField(found.text, MASCOT_FIELDS);
      if (!colors && !mascot) continue;
      rows.push({
        school,
        colors: colors ? splitColors(colors) : [],
        colorsSource: colors ? source : null,
        mascot: mascot ? mascot.replace(/^the\s+/i, "").split(/[,;/]/)[0].trim() : null,
        mascotSource: mascot ? source : null,
      });
    } catch (error) {
      console.log(`  ${school}: ${error.message}`);
    }
  }
  writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`looked up ${looked} schools with gaps; found facts for ${rows.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
