// Finding a team, a game or a season by what a fan types (ADR 0090): a town, a mascot, a short name or an abbreviation
// (FWC, CHANT), a misspelling ("White Face", "Whitface"), a school's full name with "ISD", "Academy" or "Christian", two
// teams ("jayton whiteface") or a year ("2024 jayton"). Pure and import-free: the same code runs in the browser, in the
// build (lib/find-index.ts makes its index) and in tests (scripts/find.test.mjs). No name of a source lives here.
import { seriesHref } from "./series";
import { slugify } from "./slug";

/** What a program contributes to a search. `where` has one line per organization listing it, as the Programs page's heading
 * and place read ("UIL Division I · Region 1 · District 1"); `aka` is its other names (spellings, former names). */
type Findable = { slug: string; school: string; where: string[]; mascot?: string; aka?: string[] };

/** A program as it is searched and drawn: the match fields, its seasons as ranges ("2018-2024, 2026") and its crest. */
export type Entry = Findable & {
  seasons: string;
  crest: { logo?: { src: string; aspect: number; light: boolean }; theme: { bg: string; fg: string; stripe: string | null } };
};
/** An `Entry` as it travels to the browser, short: no slug (it is the school's name slugified, as everywhere), the logo as
 * its file under /logos/tiny/ with its aspect and 1 when it is a light mark, the colors only when they are not the default. */
export type WireEntry = Omit<Findable, "slug"> & { seasons: string; logo?: [string, number, 0 | 1]; theme?: [string, string, string] };
/** `pairs` is a bit for every two programs that have a series page, base64, in `entries` order; `years` the seasons with a
 * season page, `titles` the years with a State Championship page. */
export type WireIndex = { entries: WireEntry[]; pairs: string; years: number[]; titles: number[] };

export const DEFAULT_THEME = { bg: "#0a2a5e", fg: "#ffffff", stripe: "#bf1e2e" };

/** The wire form of the entries back to full ones. @public (the tests read it) */
export const decode = (wire: WireEntry[]): Entry[] =>
  wire.map(({ logo, theme, ...e }) => ({
    ...e,
    slug: slugify(e.school),
    crest: {
      ...(logo ? { logo: { src: logo[0].startsWith("/") ? logo[0] : `/logos/tiny/${logo[0]}`, aspect: logo[1], light: logo[2] === 1 } } : {}),
      theme: theme ? { bg: theme[0], fg: theme[1], stripe: theme[2] || null } : DEFAULT_THEME,
    },
  }));

/** One thing the box can open. `kind` says what it is; `entry` is the program, `other` the second team of a game. */
export type Hit =
  | { kind: "team"; href: string; title: string; sub: string; entry: Entry }
  | { kind: "season"; href: string; title: string; sub: string; entry: Entry }
  | { kind: "game"; href: string; title: string; sub: string; entry: Entry; other: Entry }
  | { kind: "year"; href: string; title: string; sub: string };

type Found = {
  hits: Hit[];
  /** Every program that matched, before the list was cut to `LIMIT`. */
  total: number;
  /** When nothing matched: the closest name, for "Did you mean". */
  closest?: Entry;
};

export const LIMIT = 20;
const MIN_YEAR = 1900;

// ---- words ------------------------------------------------------------------------------------------------------------

/** Lowercase, no accents or apostrophes, everything else a space. "St. Mary's" is "st marys". */
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/&/g, " and ").replace(/@/g, " at ").replace(/[^a-z0-9]+/g, " ").trim();

const CANON: Record<string, string> = { ft: "fort", mt: "mount", st: "saint", sch: "school", hs: "high", jr: "junior" };
/** One word as it is compared: the usual short forms spelled out ("ft" is "fort"), a plural's "s" off ("Jaybirds"). */
const word = (w: string) => {
  const c = CANON[w] ?? w;
  return c.length > 3 && c.endsWith("s") && !c.endsWith("ss") ? c.slice(0, -1) : c;
};
const words = (s: string) => norm(s).split(" ").filter(Boolean).map(word);

/** Words that say what kind of school it is or that fans add on their own. A search leaves them out of what must match, and
 * ranks a school that has them above one that does not. */
const SOFT = new Set(["isd", "school", "high", "football", "team", "the", "of", "and", "academy", "christian", "charter", "prep", "preparatory", "classical", "catholic", "homeschool"]);
/** Words between two teams ("jayton vs whiteface", "jayton at whiteface"). */
const VERSUS = new Set(["vs", "v", "versus", "at", "against", "and"]);
/** "vs" is always between two teams; "at" and "and" may be in a name ("The Christian School at Castle Hills"). */
const STRONG = new Set(["vs", "v", "versus", "against"]);
const SKIPPED_IN_INITIALS = new Set(["of", "the", "and", "at"]);

/** Edit distance (@public: the tests read it) counting a swap of two letters as one edit ("jyaton" is one from "jayton"); stops early past `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// ---- the index ---------------------------------------------------------------------------------------------------------

const EXACT = 4;
const PREFIX = 3;
const INSIDE = 2;
const FUZZY = 1;

type Target = { t: string; w: number; /** only an exact word counts (an abbreviation, a league) */ exact?: boolean; prefixFrom?: number };
type Prepared = {
  entry: Entry;
  name: string; // normalized, words joined by one space
  compact: string[]; // normalized names with the spaces taken out: the school's, its other names' and its mascot
  targets: Target[];
  size: number; // words in the name: a shorter name ranks above a longer one on a tie
};

const initials = (ws: string[]) => ws.map((w) => w[0]).join("");

/** Everything a program can be found by, worked out once when the page loads. */
function prepare(entries: Entry[]): Prepared[] {
  return entries.map((entry) => {
    const paren = [...entry.school.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const main = entry.school.replace(/\([^)]*\)/g, " ");
    const nameWords = words(main);
    const targets: Target[] = [];
    const add = (t: string, w: number, more: Partial<Target> = {}) => t && targets.push({ t, w, ...more });
    for (const w of nameWords) add(w, 1);
    for (const p of paren) for (const w of words(p)) add(w, 1);
    // "White Face" typed for Whiteface goes the other way too: two words of a name run together ("Fortworth").
    for (let i = 0; i + 1 < nameWords.length; i++) add(nameWords[i] + nameWords[i + 1], 0.95);
    if (nameWords.length > 1) add(nameWords.join(""), 0.95);
    // Abbreviations: Fort Worth Christian is FWC, Abilene Christian School is ACS and AC. Only an exact word counts.
    const significant = nameWords.filter((w) => !SKIPPED_IN_INITIALS.has(w));
    const trimmed = significant.filter((w) => !SOFT.has(w));
    if (significant.length > 1) add(initials(significant), 0.95, { exact: true });
    if (trimmed.length > 1) add(initials(trimmed), 0.9, { exact: true });
    // A hyphenated TAPPS name is school-town ("Covenant Classical-Fort Worth"): its town's initials first, then the
    // school's ("FWC"), or the school's then the town's ("CCFW").
    if (main.includes("-")) {
      const cut = main.lastIndexOf("-");
      const [school, town] = [words(main.slice(0, cut)).filter((w) => !SKIPPED_IN_INITIALS.has(w)), words(main.slice(cut + 1)).filter((w) => !SKIPPED_IN_INITIALS.has(w))];
      const core = school.filter((w) => !SOFT.has(w));
      if (town.length && school.length) {
        add(initials(town) + initials(core.length ? core : school), 0.85, { exact: true });
        add(initials(school) + initials(town), 0.85, { exact: true });
      }
    }
    const aka = (entry.aka ?? []).flatMap((n) => [words(n), [words(n).join("")]]);
    for (const ws of aka) for (const w of ws) add(w, 0.9);
    const mascotWords = words(entry.mascot ?? "");
    for (const w of mascotWords) add(w, 0.75);
    if (mascotWords.length > 1) add(mascotWords.join(""), 0.75);
    for (const league of new Set(entry.where.map((l) => norm(l).split(" ")[0]))) add(league, 0.6, { exact: true, prefixFrom: 3 });
    return {
      entry,
      name: nameWords.join(" "),
      compact: [nameWords.join(""), ...aka.map((ws) => ws.join("")), mascotWords.join("")].filter(Boolean),
      targets,
      size: nameWords.length,
    };
  });
}

/** How well one typed word matches one target: 0 for not at all. */
function kind(q: string, t: Target): number {
  if (q === t.t) return EXACT;
  if (t.exact) return t.prefixFrom && q.length >= t.prefixFrom && t.t.startsWith(q) ? PREFIX : 0;
  if (t.t.startsWith(q)) return PREFIX;
  if (q.length >= 4 && t.t.includes(q)) return INSIDE;
  if (q.length >= 4) {
    const max = q.length >= 7 ? 2 : 1;
    if (distance(q, t.t, max) <= max) return FUZZY;
    if (q.length >= 5 && t.t.length > q.length && distance(q, t.t.slice(0, q.length), 1) <= 1) return FUZZY;
  }
  return 0;
}

type Match = { p: Prepared; score: number; fuzzy: boolean };

/** `p` against typed words: each hard word must match something; the soft ones only lift the rank. null when one does not. */
function matchWords(p: Prepared, hard: string[], soft: string[], list: string[]): Match | null {
  let sum = 0;
  let fuzzy = false;
  for (const q of hard) {
    let best = 0;
    for (const t of p.targets) {
      const k = kind(q, t) * t.w;
      if (k > best) best = k;
    }
    if (!best) return null;
    if (best <= FUZZY) fuzzy = true;
    sum += best;
  }
  let score = (sum / hard.length) * 10;
  for (const q of soft) score += p.targets.some((t) => !t.exact && t.t === q) ? 3 : -1;
  const joined = list.join("");
  if (p.compact.includes(joined) || p.name === list.join(" ")) score += 100; // the school's own name, or its mascot, said whole
  else if (p.compact.some((c) => c.startsWith(joined))) score += 30;
  return { p, score: score - p.size * 0.2, fuzzy };
}

const bySchool = (a: Match, b: Match) => b.score - a.score || a.p.entry.school.localeCompare(b.p.entry.school);

/** The programs a list of typed words means, best first. Two words typed apart may be one name ("white face"), so the
 * words are also tried run together; the better reading wins for each program. */
function rankWords(index: Prepared[], ws: string[]): Match[] {
  const split = (list: string[]) => {
    const hard = list.filter((w) => !SOFT.has(w));
    // Only soft words ("christian academy"): they are the search.
    return hard.length ? { hard, soft: list.filter((w) => SOFT.has(w)) } : { hard: list, soft: [] as string[] };
  };
  const readings = [ws];
  for (let i = 0; i + 1 < ws.length; i++) readings.push([...ws.slice(0, i), ws[i] + ws[i + 1], ...ws.slice(i + 2)]);
  const best = new Map<string, Match>();
  for (const [r, list] of readings.entries()) {
    const { hard, soft } = split(list);
    for (const p of index) {
      const m = matchWords(p, hard, soft, list);
      if (!m) continue;
      if (r > 0) m.score -= 2; // a run-together reading is a guess
      const seen = best.get(p.entry.slug);
      if (!seen || m.score > seen.score) best.set(p.entry.slug, m);
    }
  }
  const all = [...best.values()];
  // A guess at a misspelling is shown only when nothing matched as typed.
  const clean = all.filter((m) => !m.fuzzy);
  return (clean.length ? clean : all).sort(bySchool);
}

// ---- the answer --------------------------------------------------------------------------------------------------------

const seasonsOf = (text: string): number[] =>
  text ? text.split(",").flatMap((r) => { const [a, b = a] = r.trim().split("-").map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); }) : [];

/** The program's town, where the name has one ("Allen Academy-Bryan" is in Bryan); a UIL school is its own town. */
const townOf = (e: Pick<Findable, "school" | "where">): string => {
  const m = /^[^-]+-\s*([^-()]+)$/.exec(e.school.replace(/\([^)]*\)/g, "").trim());
  return m && e.where.some((w) => w.startsWith("TAPPS")) ? m[1].trim() : "";
};

/** "Jaybirds · UIL Division I · Region 1 · District 1": what tells two schools of one name apart. @public (the tests read it) */
export function describe(e: Pick<Findable, "school" | "where" | "mascot">): string {
  return [townOf(e), e.mascot, e.where.join("; ")].filter(Boolean).join(" · ");
}

const bit = (pairs: string, i: number, j: number): boolean => {
  const [lo, hi] = i < j ? [i, j] : [j, i];
  const n = (hi * (hi - 1)) / 2 + lo;
  const byte = pairs.charCodeAt(n >> 3);
  return Number.isNaN(byte) ? false : ((byte >> (n & 7)) & 1) === 1;
};

/** Reads the base64 `pairs` once into a plain string of bytes (one char per byte) so `bit` is an index, not a decode. */
const unpack = (pairs: string) => atob(pairs);

type Searcher = (query: string) => Found;

/** The searcher for one index. Build it once; call it on every keystroke. */
export function searcher(wire: WireIndex): Searcher {
  const entries = decode(wire.entries);
  const index = prepare(entries);
  const slot = new Map(entries.map((e, i) => [e.slug, i]));
  const bits = unpack(wire.pairs);
  const years = new Set(wire.years);
  const titles = new Set(wire.titles);
  const teamHit = (e: Entry): Hit => ({ kind: "team", href: `/programs/${e.slug}`, title: e.school, sub: describe(e), entry: e });

  return (raw) => {
    const typed = norm(raw).split(" ").filter(Boolean);
    const yearWords = typed.filter((w) => /^\d{4}$/.test(w) && Number(w) >= MIN_YEAR);
    const year = yearWords.length ? Number(yearWords[0]) : undefined;
    const rest = typed.filter((w) => !yearWords.includes(w));
    const between = (set: Set<string>) => rest.findIndex((w, i) => set.has(w) && i > 0 && i < rest.length - 1);
    const versusAt = between(STRONG) > 0 ? between(STRONG) : between(VERSUS);
    const ws = rest.filter((w) => !VERSUS.has(w)).map(word);
    const hits: Hit[] = [];

    const yearHits = (): Hit[] =>
      year === undefined ? [] : [
        ...(years.has(year) ? [{ kind: "year" as const, href: `/seasons/${year}`, title: `${year} season`, sub: "Scores, standings and playoffs, by league" }] : []),
        ...(titles.has(year) ? [{ kind: "year" as const, href: `/championships/${year}`, title: `${year} State Championships`, sub: "The championship games and who played" }] : []),
      ];

    if (!ws.length) return { hits: yearHits(), total: 0 };

    const teams = rankWords(index, ws);
    // Two teams: either said so ("jayton vs whiteface") or no one team fits every word ("jayton whiteface").
    if (ws.length > 1 && (versusAt > 0 || teams.length === 0)) {
      // Split where it was said ("jayton vs whiteface"); failing that, anywhere ("jayton whiteface").
      const said = versusAt > 0 ? [rest.slice(0, versusAt).filter((w) => !VERSUS.has(w)).length] : [];
      const anywhere = ws.map((_, i) => i).slice(1);
      let best: { a: Match; b: Match; score: number } | undefined;
      for (const cuts of [said, anywhere]) {
        for (const cut of cuts) {
          const left = rankWords(index, ws.slice(0, cut))[0];
          const right = rankWords(index, ws.slice(cut))[0];
          if (!left || !right || left.p.entry.slug === right.p.entry.slug) continue;
          const score = left.score + right.score;
          if (!best || score > best.score) best = { a: left, b: right, score };
        }
        if (best) break;
      }
      if (best) {
        const [a, b] = [best.a.p.entry, best.b.p.entry];
        const played = bit(bits, slot.get(a.slug)!, slot.get(b.slug)!);
        hits.push({
          kind: "game",
          href: played ? seriesHref(a.slug, b.slug) : `/matchup?a=${a.slug}&b=${b.slug}`,
          title: `${a.school} vs ${b.school}`,
          sub: played ? "Every game they have played" : "No game between them on record: see how they match up",
          entry: a,
          other: b,
        });
        hits.push(teamHit(a), teamHit(b));
        return { hits, total: 2 };
      }
    }

    const shown = teams.slice(0, LIMIT);
    if (year !== undefined) {
      for (const { p } of shown.slice(0, 5)) {
        if (seasonsOf(p.entry.seasons).includes(year)) {
          hits.push({ kind: "season", href: `/programs/${p.entry.slug}/${year}`, title: `${p.entry.school}, ${year} season`, sub: "Record, rank and every game that year", entry: p.entry });
        }
      }
    }
    hits.push(...shown.map(({ p }) => teamHit(p.entry)));
    if (!teams.length) return { hits: yearHits(), total: 0, closest: closest(index, ws.join("")) };
    return { hits, total: teams.length };
  };
}

/** The name nearest to what was typed, for "Did you mean": up to a third of its letters wrong, and never more than three. */
function closest(index: Prepared[], compact: string): Entry | undefined {
  if (compact.length < 4) return undefined;
  const max = Math.min(3, Math.floor(compact.length / 3));
  let best: { e: Entry; d: number } | undefined;
  for (const p of index) {
    for (const t of [...p.targets.filter((x) => !x.exact).map((x) => x.t), ...p.compact]) {
      if (t.length < 4) continue;
      const d = distance(compact, t, max);
      if (d <= max && (!best || d < best.d)) best = { e: p.entry, d };
    }
  }
  return best?.e;
}
