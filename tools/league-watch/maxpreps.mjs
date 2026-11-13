// Reads 2026 six-man game results from MaxPreps team schedule pages (ADR 0008). Facts only: date, teams, score.
// Starts from a few seed teams and follows opponents that are in our alignments, so it walks the six-man network.
// Polite: robots.txt allows /<state>/<city>/<team>/football/schedule/, one request every 2.5 s, each page read once.
//
//   node tools/league-watch/maxpreps.mjs [--season 2027]
// writes maxpreps-<season>/games.csv, teams.csv (every team page found, the next run's seeds) and coverage.txt in
// $PRIVATE_DATA (the private data repo; data/seed without it). tools/league-watch/publish.mjs copies the facts here.
//   node tools/league-watch/maxpreps.mjs --due data/seed/maxpreps-2026/playoffs.csv
// prints how many bracket games of tonight, or of the 3 game nights before it (ADR 0030), have no score yet
// (results-watch.yml reads only when it is not 0).
//   node tools/league-watch/maxpreps.mjs --canary
// reads one seed team's schedule page and fails if MaxPreps changed its shape (maxpreps-canary.yml, before game nights).
//   node tools/league-watch/maxpreps.mjs --tonight
// (playoff game days, ADRs 0015, 0019 and 0030) reads only the pages of teams whose bracket game today, or on one of the 3
// game nights before it, has no score yet, one page a game, and fills those finals into playoffs.csv and games.csv; every
// other row and file is left as it was.
//   node tools/league-watch/maxpreps.mjs --tonight --live-out <file>
// also writes the games of tonight that show a score but no final yet (live scores, ADR 0021) to <file> as JSON, for
// packages/db/live.mjs; the repo's files never change for a live score.
// The season defaults to the one under way: August to January belongs to the year it started. A past season is read
// from the same team pages with the season segment in the path (--season 2025 reads .../football/25-26/schedule/).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argSeason = process.argv.indexOf("--season");
const today = new Date();
/** The season under way: August to January belongs to the year it started. */
const DEFAULT_SEASON = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
export const SEASON = argSeason > 0 ? Number(process.argv[argSeason + 1]) : DEFAULT_SEASON;
// The reader's folders (games with their source pages, teams.csv, outside.csv, coverage.txt) live in the private data
// repo, checked out at PRIVATE_DATA (results-watch.yml); publish.mjs copies the facts into data/seed afterwards.
const RESULTS = process.env.PRIVATE_DATA ? path.resolve(process.env.PRIVATE_DATA) : path.join(ROOT, "data/seed");
const OUT = path.join(RESULTS, `maxpreps-${SEASON}`);
const SEASON_START = `${SEASON}-08-01`;
const SEASON_END = `${SEASON + 1}-01-31`;
const DELAY_MS = 2500;
const USER_AGENT = "project-80x40-results-reader/1.0 (six-man scores; one request per 2.5 s)";
// The only paths this reader may request. MaxPreps' robots.txt disallows /team/, /school/, /scores/ and /contest/ (and
// /*/schedule/all-time/); it does not disallow team schedule pages, current (.../football/schedule/) or past season
// (.../football/25-26/schedule/ for the 2025 season, read Nov 11, 2026).
export const ALLOWED = /^https:\/\/www\.maxpreps\.com\/tx\/[^/?#]+\/[^/?#]+\/football\/(?:\d{2}-\d{2}\/)?schedule\/$/; // a few slugs carry a dash "–"
const CURRENT_SEASON = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;

/** MaxPreps' season segment: 2025 -> "25-26". */
export const seasonSegment = (season) => `${String(season).slice(-2)}-${String(season + 1).slice(-2)}`;

/** A team's schedule page for a season. The season under way has no segment; past seasons do. */
export const scheduleUrl = (teamUrl, season, current = CURRENT_SEASON) =>
  season === current ? `${teamUrl}schedule/` : `${teamUrl}${seasonSegment(season)}/schedule/`;

// Used when no teams.csv exists yet for this season or the one before.
const SEEDS = ["https://www.maxpreps.com/tx/odonnell/odonnell-eagles/football/"];
// MaxPreps team page -> our alignment name, for schools no automatic rule matches. Filled from coverage.txt, with the
// team pages listed in MaxPreps' football team sitemap. A list means one team we list under several names (a school in
// two leagues): games go to the first. Every alias page is also a starting page, so a school whose opponents are all
// outside our alignments is still read.
export const ALIASES = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "maxpreps-aliases.json"), "utf8"));

/** Our schools whose MaxPreps page an alias names: each matches its own page only, never another school's page by name. */
const pinnedOf = (aliases) => new Set(Object.values(aliases).flat().map(slugify));
let PINNED; // built on first use: slugify is declared below

/** Our slug for a MaxPreps team, or null: an alias, then its name ("Jayton"), then city and name ("Lenorah Grady"). A
 * name that belongs to a pinned school is not matched by name (Community Christian in Orange is not ours in Mineral Wells). */
export function match(team, bySlug, aliases = ALIASES) {
  if (team.state !== "TX") return null;
  const alias = [aliases[team.url]].flat()[0];
  const pinned = aliases === ALIASES ? (PINNED ??= pinnedOf(ALIASES)) : pinnedOf(aliases);
  const byName = [team.name, `${team.city} ${team.name}`].map(slugify).filter((s) => !pinned.has(s));
  return [...(alias ? [slugify(alias)] : []), ...byName].find((s) => bySlug.has(s)) ?? null;
}
export const COLUMNS = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";

/** Twin of `slugify` in apps/web/lib/alignments.ts and packages/db/seed.mjs. */
export const slugify = (name) => name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Positions in MaxPreps' contest arrays (pageProps.contests), checked against a live page on Nov 10, 2026.
// A contest is [teams, ...]; a team is [..., result 5, score 6, ..., homeAway 11 (0 home, 1 away), ..., url 13, name 14,
// ..., contestId 26]. contest[3] is true when deleted, contest[4] when it has a result, contest[11] is the start time,
// contest[18] the game page. Narrative text (contest[29]) is never read.
const T = { result: 5, score: 6, homeAway: 11, url: 13, name: 14, city: 15, state: 16, contestId: 26 };
const C = { deleted: 3, hasResult: 4, start: 11, gameUrl: 18 };
// The contest index that holds the period of a game under way ("Q3", 3, "Half" ...). NOT KNOWN: nobody has seen a real
// in-progress page yet. Each tonight run's summary lists the fields of such a contest (inProgressShape, "contest 4=false
// 12=...") from which to read the index; set it here then (and add the mapping in `periodText`). Until it is a number the
// period of a live game is null and pages show the score alone. Never guess it.
export const PERIOD_INDEX = null;

/** A live game's period as short plain text, from the contest array, or null (no index set, nothing there, or not short text). */
export function periodText(contest, index = PERIOD_INDEX) {
  if (index === null) return null;
  const v = contest[index];
  const text = typeof v === "number" ? `Q${v}` : typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9 ]{1,12}$/.test(text) ? text : null;
}

/** A team's page without any schedule path: past-season pages link their teams as .../football/25-26/schedule/. */
export const teamPage = (url) => url.replace(/(?:\d{2}-\d{2}\/)?schedule\/$/, "");

/**
 * Which football the team played that season by its page: "6", "11", or null when the page does not say. MaxPreps names the
 * team's division once per page ("stateDivisionName"): "Division 1A 6 Man 2", "Division TAPPS II 6 Man" are six-man;
 * "Division 2A-2", "Division 5A", "Division TAPPS III", "Division TCAF 11" are 11-man; blank, TAIAO, "TCAF 1" and
 * "TCAL II" say neither. Many schools on today's six-man lists played 11-man in earlier seasons, sometimes each other.
 */
export function footballOf(html) {
  const name = html.match(/"stateDivisionName":"([^"]*)"/)?.[1] ?? "";
  if (/\b6 ?-?Man\b/i.test(name)) return { kind: "6", name };
  return /\b[2-6]A\b|\bTAPPS\b|\b11\b/.test(name) ? { kind: "11", name } : { kind: null, name };
}

/** An 11-man game: one team's page says 11-man that season and neither says six-man (a six-man school plays six-man). */
export const isElevenMan = (g, football) => {
  const kinds = [football.get(g.home.url)?.kind, football.get(g.away.url)?.kind];
  return kinds.includes("11") && !kinds.includes("6");
};

/**
 * Games on one schedule page. Throws if the page no longer has the shape this reader knows. A past season's page may list
 * a played game against a team MaxPreps has since removed (no name or page): with `onUnnamed`, such a game is skipped and
 * reported to it instead of throwing; without it (the season under way), it throws as a new shape.
 */
export function parseSchedule(html, { onUnnamed } = {}) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NEXT_DATA__ on the page");
  const props = JSON.parse(m[1])?.props?.pageProps;
  const contests = props?.contests;
  if (!Array.isArray(contests)) throw new Error("no contests array on the page");
  // Playoff games are listed again in pageProps.tournaments with their league's bracket name.
  const brackets = new Map(
    (props.tournaments ?? []).filter((t) => t?.isTournamentPlayOff).map((t) => [t.contestId, bracketOf(t.tournamentName, t.bracketName)]),
  );
  const games = [];
  for (const c of contests) {
    if (!Array.isArray(c?.[0]) || c[0].length !== 2) throw new Error("a contest without exactly two teams");
    if (c[C.deleted] === true) continue;
    const date = String(c[C.start] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`a contest without a date: ${c[C.start]}`);
    const teams = c[0].map((t) => ({
      name: String(t[T.name] ?? ""),
      url: teamPage(String(t[T.url] ?? "")),
      city: String(t[T.city] ?? ""),
      state: String(t[T.state] ?? ""),
      homeAway: t[T.homeAway],
      score: typeof t[T.score] === "number" ? t[T.score] : null,
    }));
    if (teams.some((t) => !t.name || !t.url)) {
      // An opponent not yet named (an open date, a "TBA") with no result is not a game; a played one is a new shape.
      if (c[C.hasResult] !== true) continue;
      if (onUnnamed) {
        onUnnamed(date);
        continue;
      }
      throw new Error("a played game with a team without a name or page");
    }
    const home = teams.find((t) => t.homeAway === 0) ?? teams[0];
    const away = teams.find((t) => t !== home);
    // A 0-0 "result" is a placeholder or a cancelled game, never a score (a forfeit is written 1-0 or 2-0): the game stays
    // unplayed, so it is in no rating, record or streak (DECISIONS.md, Nov 13, 2026).
    if (c[C.hasResult] === true && home.score === 0 && away.score === 0) home.score = away.score = null;
    games.push({
      id: String(c[0][0][T.contestId] ?? `${date}-${home.url}-${away.url}`),
      date,
      home,
      away,
      played: c[C.hasResult] === true && home.score !== null && away.score !== null,
      // Both teams have a score but the game has no result yet: it is under way (ADR 0021). `played` is unchanged.
      live: c[C.hasResult] !== true && home.score !== null && away.score !== null,
      period: periodText(c),
      bracket: brackets.get(String(c[0][0][T.contestId])) ?? null,
      gameUrl: typeof c[C.gameUrl] === "string" ? c[C.gameUrl] : null,
    });
  }
  return games;
}

/** Every school in our alignments, by slug: the only teams whose games are kept. */
export function loadAlignments() {
  const bySlug = new Map();
  for (const dir of ["uil-2026-28", "tapps-2026-28", "private-2026"]) {
    const [header, ...lines] = readFileSync(path.join(ROOT, "data/seed", dir, "alignments.csv"), "utf8").trim().split("\n");
    const cols = header.split(",");
    for (const line of lines) {
      const r = Object.fromEntries(cols.map((c, i) => [c, line.split(",")[i] ?? ""]));
      bySlug.set(slugify(r.school), r);
    }
  }
  return bySlug;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MAXPREPS_CACHE=<dir> keeps pages between local runs, so working on the matching does not reread MaxPreps.
const CACHE = process.env.MAXPREPS_CACHE;

/** Three tries, 10 s then 30 s apart, for a dropped connection, a timeout or a server error; a 4xx fails at once. A
 * retry is logged, so a run that needed one says so. */
export async function withRetries(url, attempt, waits = [10_000, 30_000]) {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (e.final || i >= waits.length) throw e;
      console.warn(`retrying ${url} in ${waits[i] / 1000} s: ${e.message}`);
      await sleep(waits[i]);
    }
  }
}

async function fetchSchedule(teamUrl) {
  const url = scheduleUrl(teamUrl, SEASON);
  if (!ALLOWED.test(url)) throw new Error(`refusing a path robots.txt or ADR 0008 does not allow: ${url}`);
  const cached = CACHE && path.join(CACHE, `${slugify(url)}.html`);
  if (cached && existsSync(cached)) return { url, html: readFileSync(cached, "utf8"), cached: true };
  const html = await withRetries(url, async () => {
    // A redirect is never followed: it may lead off the one path this reader may read (a few past-season pages send
    // readers to a help page). The page is skipped and logged, like a 404.
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (res.status >= 300 && res.status < 400) {
      console.warn(`skipping ${url}: redirected to ${res.headers.get("location")}`);
      return null;
    }
    if (res.status === 404) return null;
    if (res.status >= 500) throw new Error(`${url}: HTTP ${res.status}`); // retried
    if (!res.ok) throw Object.assign(new Error(`${url}: HTTP ${res.status}`), { final: true });
    return res.text();
  });
  if (html === null) return null;
  if (cached) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, html);
  }
  return { url, html };
}

/**
 * Our league and division for a MaxPreps playoff bracket, or null for one we do not cover (11-man, other states).
 * "2026 Football 6-Man 1A D2" -> UIL II; "TAPPS 6 Man III Large School" -> TAPPS "III Large School";
 * "Division II" (TAIAO) -> TAIAO 2; TCAF -> TCAF Six-Man.
 */
export function bracketOf(tournament = "", bracket = "") {
  const t = tournament.trim();
  const b = bracket.trim();
  const roman = { I: "1", II: "2", III: "3", IV: "4" };
  let m;
  if (/\bUIL\b/.test(t) && (m = b.match(/6-Man 1A D([12])$/))) return { league: "UIL", division: m[1] === "1" ? "I" : "II" };
  if (/\bTAPPS\b/.test(t) && (m = b.match(/6 Man (I{1,3}|IV)\b(.*)$/))) return { league: "TAPPS", division: `${m[1]}${m[2]}`.trim() };
  if (/\bTAIAO\b/.test(t) && (m = b.match(/^Division (I{1,3})$/))) return { league: "TAIAO", division: roman[m[1]] };
  if (/\bTCAF\b/.test(t)) return { league: "TCAF", division: "Six-Man" };
  return null;
}

const weekOf = (date) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
};

/**
 * Round names, counted back from the final: a bracket's size is set by its first week (n games, so about 2n teams and
 * ceil(log2(2n)) rounds). UIL calls its rounds bi-district, area, regional, (quarterfinal), semifinal, state; other
 * leagues get round-1, ..., quarterfinal, semifinal, final.
 */
export function roundName(league, index, rounds) {
  const fromEnd = rounds - 1 - index;
  if (fromEnd === 0) return league === "UIL" ? "state" : "final";
  if (fromEnd === 1) return "semifinal";
  if (league === "UIL") return ["bi-district", "area", "regional"][index] ?? "quarterfinal";
  return fromEnd === 2 ? "quarterfinal" : `round-${index + 1}`;
}

export function playoffsCsv(games, bySlug) {
  const weeks = new Map();
  for (const g of games) {
    const key = `${g.bracket.league}|${g.bracket.division}`;
    weeks.set(key, [...new Set([...(weeks.get(key) ?? []), weekOf(g.date)])].sort());
  }
  const rows = games
    .map((g) => {
      const key = `${g.bracket.league}|${g.bracket.division}`;
      const list = weeks.get(key);
      const firstWeek = games.filter((x) => `${x.bracket.league}|${x.bracket.division}` === key && weekOf(x.date) === list[0]).length;
      const rounds = Math.max(list.length, Math.ceil(Math.log2(2 * firstWeek)));
      const round = roundName(g.bracket.league, list.indexOf(weekOf(g.date)), rounds);
      return [
        g.bracket.league, g.bracket.division, round, g.date, bySlug.get(g.home.slug).school, bySlug.get(g.away.slug).school,
        "", g.played ? g.home.score : "", g.played ? g.away.score : "", g.played ? "unknown" : "", "", g.gameUrl ?? g.source, "",
      ];
    })
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]) || a[4].localeCompare(b[4]));
  return [`league,${COLUMNS}`, ...rows.map((r) => r.join(","))].join("\n") + "\n";
}

/**
 * MaxPreps sometimes lists one game twice under two contest ids. Copies that agree on the score are one game (a copy
 * with a bracket wins); copies that disagree are all dropped and returned as conflicts, for coverage.txt. A game whose
 * two sides are the same school of ours (two schools of one name matched to one) is never written: it is returned in
 * selfGames, named, so the run says so before anything reaches the private repo or the database.
 */
export function dedupe(games) {
  const groups = new Map();
  const selfGames = [];
  for (const g of games) {
    if (g.home.slug === g.away.slug) {
      selfGames.push(`${g.date} ${g.home.name} (${g.home.city}) vs ${g.away.name} (${g.away.city}), both matched to ${g.home.slug}`);
      continue;
    }
    const key = [g.date, ...[g.home.slug, g.away.slug].sort()].join("|");
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  const kept = [];
  const conflicts = [];
  for (const [key, copies] of groups) {
    const score = (g) => (g.played ? [[g.home.slug, g.home.score], [g.away.slug, g.away.score]].sort().join(";") : "unplayed");
    const played = copies.filter((g) => g.played);
    const scores = new Set(played.map(score));
    if (scores.size > 1) {
      conflicts.push(`${key.replaceAll("|", " ")}: ${[...scores].join(" vs ")}`);
      continue;
    }
    const pool = played.length ? played : copies;
    kept.push(pool.find((g) => g.bracket) ?? pool[0]);
  }
  return { kept, conflicts, selfGames };
}

export const OUTSIDE_COLUMNS = "game_date,team,opponent,opponent_url,team_is_home,team_score,opponent_score,source_url";

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));

/**
 * Played games between one of our schools and one outside our alignments (out of state, no longer six-man, a program we
 * do not list), one row each: the ratings keep the opponent as a hidden team, so a season whose alignments have since
 * changed does not lose a fifth of its games. Never a "non varsity opponent" placeholder. A game listed twice (same day,
 * same two teams) with the same score is one; with different scores it is left out and counted.
 */
export function outsideCsv(games, bySlug) {
  const groups = new Map();
  for (const g of games) {
    if (g.home.url.includes("/pseudo/") || g.away.url.includes("/pseudo/")) continue;
    const ours = g.home.slug ? g.home : g.away;
    const theirs = ours === g.home ? g.away : g.home;
    const key = [g.date, ours.slug, theirs.url].join("|");
    groups.set(key, [...(groups.get(key) ?? []), { g, ours, theirs }]);
  }
  const rows = [];
  let conflicts = 0;
  for (const copies of groups.values()) {
    if (new Set(copies.map(({ ours, theirs }) => `${ours.score}-${theirs.score}`)).size > 1) {
      conflicts++;
      continue;
    }
    const { g, ours, theirs } = copies[0];
    rows.push([g.date, bySlug.get(ours.slug).school, theirs.name, theirs.url, ours === g.home, ours.score, theirs.score, g.gameUrl ?? g.source]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]));
  return { csv: [OUTSIDE_COLUMNS, ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n", count: rows.length, conflicts };
}

export function toCsv(games, bySlug) {
  const rows = games
    .filter((g) => g.played)
    .sort((a, b) => a.date.localeCompare(b.date) || a.home.slug.localeCompare(b.home.slug))
    .map((g) => {
      const home = bySlug.get(g.home.slug);
      // MaxPreps does not say which games are playoffs; "season" covers both until a bracket source exists.
      return [
        home.division, "season", g.date, home.school, bySlug.get(g.away.slug).school, "false",
        g.home.score, g.away.score, "unknown", "", g.gameUrl ?? g.source, "",
      ].join(",");
    });
  return [COLUMNS, ...rows].join("\n") + "\n";
}

async function main() {
  const bySlug = loadAlignments();
  // Team pages are the same every season, so a season with no teams.csv of its own starts from a neighbour's.
  const known = [OUT, ...[SEASON - 1, SEASON + 1].map((y) => path.join(RESULTS, `maxpreps-${y}`))].map((d) => path.join(d, "teams.csv")).find(existsSync);
  const fromLastRun = known ? readFileSync(known, "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[1]) : [];
  const queue = [...new Set([...fromLastRun, ...SEEDS, ...Object.keys(ALIASES)])];
  const seen = new Set(queue);
  const games = new Map();
  const reached = new Set();
  const teamPages = new Map(); // our slug -> MaxPreps team page
  const readPages = new Set();
  const outside = new Map(); // opponents not in our alignments, with how many games
  const outsideGames = new Map(); // played games of one of our schools against one that is not, for the ratings
  let pages = 0;
  // A past season (read with --season) skips a played game whose other team MaxPreps no longer lists, and counts it.
  let unnamed = 0;
  const past = SEASON < DEFAULT_SEASON ? { onUnnamed: () => unnamed++ } : {};
  // A past season also leaves out 11-man games (footballOf, isElevenMan).
  const football = new Map(); // team page -> what its page says it played that season

  while (queue.length) {
    const teamUrl = queue.shift();
    const page = await fetchSchedule(teamUrl);
    pages++;
    if (page) readPages.add(teamUrl);
    if (page && SEASON < DEFAULT_SEASON) football.set(teamPage(page.url), footballOf(page.html));
    if (page) {
      for (const g of parseSchedule(page.html, past)) {
        if (g.date < SEASON_START || g.date > SEASON_END) continue;
        for (const t of [g.home, g.away]) {
          t.slug = match(t, bySlug);
          if (!t.slug) {
            const label = `${t.name} (${t.city}, ${t.state}) ${t.url}`;
            outside.set(label, (outside.get(label) ?? 0) + 1);
            continue;
          }
          for (const name of [ALIASES[t.url] ?? t.slug].flat()) reached.add(slugify(name));
          teamPages.set(t.slug, t.url);
          if (!seen.has(t.url)) {
            seen.add(t.url);
            queue.push(t.url);
          }
        }
        const both = g.home.slug && g.away.slug;
        if (!both && (g.home.slug || g.away.slug) && g.played && !outsideGames.has(g.id)) outsideGames.set(g.id, { ...g, source: page.url });
        if (both && !games.has(g.id)) games.set(g.id, { ...g, source: page.url });
        // A playoff game is kept once it has a bracket, even if the first page that listed it had none.
        if (both && g.bracket) games.set(g.id, { ...games.get(g.id), bracket: g.bracket });
      }
    }
    process.stdout.write(`\r${pages} pages, ${games.size} games, ${queue.length} queued   `);
    if (queue.length && !page?.cached) await sleep(DELAY_MS);
  }

  // A school whose alias page was read but has no games this season most likely fielded no team (or MaxPreps has none).
  // 11-man games are not six-man results: drop them, and list a school left with no six-man game as 11-man that season.
  const elevenGames = [...games.values()].filter((g) => g.played && isElevenMan(g, football)).length;
  for (const [id, g] of games) if (isElevenMan(g, football)) games.delete(id);
  for (const [id, g] of outsideGames) if (isElevenMan(g, football)) outsideGames.delete(id);
  const slugOfPage = new Map([...teamPages].map(([slug, url]) => [url, slug]));
  const namesOf = (url) => [ALIASES[url] ?? slugOfPage.get(url) ?? []].flat().map(slugify);
  const sixManPages = new Set([...games.values(), ...outsideGames.values()].flatMap((g) => [g.home.url, g.away.url]));
  const elevenPages = [...football].filter(([url, f]) => f.kind === "11" && !sixManPages.has(url));
  const elevenSlugs = new Set(elevenPages.flatMap(([url]) => namesOf(url)));
  for (const s of elevenSlugs) reached.delete(s);
  const readNames = new Set([...readPages].flatMap((url) => [ALIASES[url] ?? []].flat().map(slugify)));
  const missing = [...bySlug.entries()]
    .filter(([slug]) => !reached.has(slug))
    .map(([slug, r]) => `${r.league} ${r.division}: ${r.school}${elevenSlugs.has(slug) ? " (11-man this season)" : readNames.has(slug) ? ` (MaxPreps page read: no ${SEASON} games)` : ""}`);
  mkdirSync(OUT, { recursive: true });
  const { kept, conflicts, selfGames } = dedupe([...games.values()]);
  // A row with the same school on both sides breaks the database (a game needs two team-seasons): name it loudly.
  for (const s of selfGames) console.log(`::warning::left out, the same school on both sides: ${s}`);
  writeFileSync(path.join(OUT, "games.csv"), toCsv(kept, bySlug));
  writeFileSync(path.join(OUT, "playoffs.csv"), playoffsCsv(kept.filter((g) => g.bracket), bySlug));
  const outsideRows = outsideCsv([...outsideGames.values()], bySlug);
  writeFileSync(path.join(OUT, "outside.csv"), outsideRows.csv);
  writeFileSync(
    path.join(OUT, "teams.csv"),
    ["slug,maxpreps_url", ...[...teamPages.entries()].sort().map(([slug, url]) => `${slug},${url}`)].join("\n") + "\n",
  );
  writeFileSync(
    path.join(OUT, "coverage.txt"),
    [
      `Season ${SEASON}, read ${new Date().toISOString().slice(0, 10)} from ${pages} MaxPreps schedule pages (ADR 0008).`,
      `${kept.filter((g) => g.played).length} played games between schools in our alignments.`,
      `${outsideRows.count} played games against opponents outside them, in outside.csv (the ratings' hidden teams; ${outsideRows.conflicts} listed twice with different scores, left out).`,
      ...(elevenGames ? [`${elevenGames} played 11-man games between schools in our alignments left out (and their games against others). Schools with no six-man game this season, their page's division: ${elevenPages.map(([url, f]) => `${namesOf(url)[0] ?? url} (${f.name})`).sort().join("; ")}.`] : []),
      ...(unnamed ? [`${unnamed} played game sides skipped: the other team is no longer listed on MaxPreps (no name or page).`] : []),
      `${reached.size} of ${bySlug.size} schools reached. Not reached (${missing.length}):`,
      ...missing.sort(),
      "",
      `Listed twice with different scores, so left out (${conflicts.length}):`,
      ...conflicts.sort(),
      "",
      `The same school on both sides, so left out (${selfGames.length}; fix the match or an alias):`,
      ...selfGames.sort(),
      "",
      `${outside.size} opponents outside our alignments (${[...outside.values()].reduce((a, b) => a + b, 0)} game sides skipped; for a past season these include schools no longer six-man or no longer listed), most games first:`,
      ...[...outside.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([n, k]) => `${k}  ${n}`),
    ].join("\n") + "\n",
  );
  console.log(`\nWrote ${OUT}/games.csv; ${missing.length} schools not reached (coverage.txt)`);
}

/** Today's date where the games are played ("2026-11-13", Central time), whatever the runner's clock zone. */
export const centralDate = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);

/** The game night a run belongs to: until 6 AM Central it is still the night before, so the midnight run (and a run
 * GitHub starts late) reads that night's games (Thursday's, Friday's or Saturday's), not the next day's. */
export const gameNight = (now = new Date()) => centralDate(new Date(now.getTime() - 6 * 3600_000));

const parseRows = (text) => {
  const [header, ...lines] = text.trimEnd().split("\n");
  const cols = header.split(",");
  return { header, cols, rows: lines.map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(",")[i] ?? ""]))) };
};
const rowLine = (cols, r) => cols.map((c) => r[c]).join(",");
const pairKey = (date, a, b) => [date, ...[slugify(a), slugify(b)].sort()].join("|");

/** Bracket rows (playoffs.csv) dated `date` that have no score yet: tonight's games still to read. */
export function tonightsGames(playoffsText, date) {
  return parseRows(playoffsText).rows.filter((r) => r.game_date === date && r.home_score === "");
}

/** How many earlier game nights a game-day read catches up on (ADR 0030): a final MaxPreps posts after that night's last read. */
export const CATCH_UP_NIGHTS = 3;

/**
 * Bracket rows with no score yet that a game-day read looks for (ADR 0030): tonight's, and those of the last
 * `nights` game nights before it (the latest dates before `date` that have any bracket row). A game postponed past them
 * leaves the list; the morning read and the next full read still find it.
 */
export function dueGames(playoffsText, date, nights = CATCH_UP_NIGHTS) {
  const rows = parseRows(playoffsText).rows;
  const earlier = [...new Set(rows.map((r) => r.game_date).filter((d) => d && d < date))].sort().slice(-nights);
  const dates = new Set([date, ...(nights > 0 ? earlier : [])]);
  return rows.filter((r) => dates.has(r.game_date) && r.home_score === "");
}

/**
 * Tonight's finals into the season's files. A bracket row with no score takes the final for the same date and teams
 * (scores in the row's own home and away order); games.csv gains each such game once, in toCsv's order. Nothing else
 * changes, so a night read never drops what the last full read found.
 */
export function mergeTonight({ playoffsText, gamesText, finals, bySlug }) {
  const byPair = new Map(finals.filter((g) => g.played).map((g) => [pairKey(g.date, g.home.slug, g.away.slug), g]));
  const p = parseRows(playoffsText);
  const filled = [];
  for (const r of p.rows) {
    const g = r.home_score === "" && byPair.get(pairKey(r.game_date, r.home, r.away));
    if (!g) continue;
    const homeFirst = g.home.slug === slugify(r.home);
    Object.assign(r, {
      home_score: homeFirst ? g.home.score : g.away.score,
      away_score: homeFirst ? g.away.score : g.home.score,
      end_reason: "unknown",
      source_url: g.gameUrl ?? r.source_url,
    });
    filled.push(g);
  }
  const games = parseRows(gamesText);
  const have = new Set(games.rows.map((r) => pairKey(r.game_date, r.home, r.away)));
  const added = filled.filter((g) => !have.has(pairKey(g.date, g.home.slug, g.away.slug)));
  const newRows = toCsv(added, bySlug).trimEnd().split("\n").slice(1).map((l) => parseRows(`${games.header}\n${l}`).rows[0]);
  const all = [...games.rows, ...newRows].sort((a, b) => a.game_date.localeCompare(b.game_date) || slugify(a.home).localeCompare(slugify(b.home)));
  return {
    playoffs: [p.header, ...p.rows.map((r) => rowLine(p.cols, r))].join("\n") + "\n",
    games: [games.header, ...all.map((r) => rowLine(games.cols, r))].join("\n") + "\n",
    filled: filled.length,
  };
}

/**
 * The games under way tonight, as the rows live.mjs writes (ADR 0021): games of `date` that parseSchedule marked live, whose
 * two teams are in our alignments (slugs set) and that are one of tonight's still-unscored bracket games (`due`). One row
 * a game, the key the site uses (`gameKey` in lib/games.ts: date, then both slugs sorted). Scores outside 0 to 200 are
 * skipped, never written; so is a 0-0 with no period (while PERIOD_INDEX is null that is every 0-0): a game not yet
 * started may list 0-0, and "Live 0-0" before kickoff would be wrong. A 0-0 shows once its period is known.
 */
export function liveRows(games, date, due, readAt = new Date()) {
  const dueKeys = new Set(due.map((r) => pairKey(r.game_date, r.home, r.away)));
  const rows = new Map();
  for (const g of games) {
    if (!g.live || g.date !== date || !g.home.slug || !g.away.slug) continue;
    const key = pairKey(g.date, g.home.slug, g.away.slug);
    if (!dueKeys.has(key) || rows.has(key)) continue;
    if (![g.home.score, g.away.score].every((n) => Number.isInteger(n) && n >= 0 && n <= 200)) continue;
    if (g.home.score === 0 && g.away.score === 0 && !g.period) continue;
    rows.set(key, { game_key: key, home: g.home.slug, away: g.away.slug, home_score: g.home.score, away_score: g.away.score, period: g.period ?? null, read_at: readAt.toISOString() });
  }
  return [...rows.values()].sort((a, b) => a.game_key.localeCompare(b.game_key));
}

/**
 * How a page shows a game under way: contests of `date` with a score but no result yet, as their numeric and boolean
 * fields and short strings ("4=false 7=3 ..."), the teams' numeric and boolean fields after. Logged only, to learn where
 * the period and status live before live scores are built (ADR 0019). Never names, links, places or narrative.
 */
export function inProgressShape(html, date) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const contests = (m && JSON.parse(m[1])?.props?.pageProps?.contests) || [];
  const scalar = (v) => typeof v === "number" || typeof v === "boolean";
  const fields = (arr, ok) => arr.flatMap((v, i) => (ok(v, i) ? [`${i}=${v}`] : [])).join(" ");
  return contests
    .filter((c) => Array.isArray(c?.[0]) && String(c[C.start] ?? "").startsWith(date) && c[C.hasResult] !== true && c[0].some((t) => typeof t?.[T.score] === "number"))
    .map((c) => [
      `contest ${fields(c, (v, i) => i > 0 && i !== 29 && (scalar(v) || (typeof v === "string" && v.length <= 24 && !v.includes("/"))))}`,
      ...c[0].map((t, n) => `team ${n} ${fields(Array.isArray(t) ? t : [], scalar)}`),
    ].join(" | "));
}

async function tonight() {
  const date = gameNight();
  const [playoffsFile, gamesFile] = ["playoffs.csv", "games.csv"].map((f) => path.join(OUT, f));
  // Tonight's unscored bracket games and those of the last few game nights (ADR 0030). Live scores stay tonight's only.
  const due = dueGames(readFileSync(playoffsFile, "utf8"), date);
  const dates = new Set(due.map((r) => r.game_date));
  const earlier = due.filter((r) => r.game_date !== date).length;
  const liveOut = process.argv.includes("--live-out") ? process.argv[process.argv.indexOf("--live-out") + 1] : null;
  if (process.argv.includes("--live-out") && (!liveOut || liveOut.startsWith("--"))) throw new Error("--live-out needs a file");
  if (!due.length) {
    // Nothing is due, so nothing is live: an empty list clears any live row the database still holds.
    if (liveOut) writeFileSync(liveOut, "[]\n");
    return console.log(`No bracket game without a score on ${date} or the ${CATCH_UP_NIGHTS} game nights before it: nothing read.`);
  }
  const bySlug = loadAlignments();
  const pageOf = new Map(readFileSync(path.join(OUT, "teams.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(",")));
  // One page a game: either team's schedule lists it.
  const urls = [...new Set(due.map((r) => pageOf.get(slugify(r.home)) ?? pageOf.get(slugify(r.away))).filter(Boolean))];
  const finals = [];
  const live = [];
  const underway = [];
  for (const [i, teamUrl] of urls.entries()) {
    const page = await fetchSchedule(teamUrl);
    if (page) underway.push(...inProgressShape(page.html, date));
    for (const g of page ? parseSchedule(page.html) : []) {
      if (!dates.has(g.date) || !(g.played || g.live)) continue;
      for (const t of [g.home, g.away]) t.slug = match(t, bySlug);
      if (g.home.slug && g.away.slug) (g.played ? finals : live).push(g);
    }
    if (i < urls.length - 1 && !page?.cached) await sleep(DELAY_MS);
  }
  const merged = mergeTonight({ playoffsText: readFileSync(playoffsFile, "utf8"), gamesText: readFileSync(gamesFile, "utf8"), finals, bySlug });
  writeFileSync(playoffsFile, merged.playoffs);
  writeFileSync(gamesFile, merged.games);
  // Games that went final in this very read are no longer live (a bracket row now has their score).
  const stillDue = tonightsGames(merged.playoffs, date);
  const liveNow = liveRows(live, date, stillDue);
  if (liveOut) writeFileSync(liveOut, `${JSON.stringify(liveNow, null, 2)}\n`);
  console.log(`${date}: ${due.length} bracket games without a score (${earlier} from earlier nights), ${urls.length} pages read, ${merged.filled} finals filled in, ${liveNow.length} under way.`);
  const note = underway.length
    ? [`Games showing a score before the final (${underway.length}):`, ...new Set(underway)].join("\n")
    : "No game on these pages showed a score before its final.";
  console.log(note);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${note.replaceAll("\n", "  \n")}\n`, { flag: "a" });
}

/**
 * What is wrong with one schedule page's games, for the canary: nothing (an empty list) on a healthy page. Once the
 * season is a month old, a seed team must have played games with both scores; every game falls inside the season.
 */
export function canaryProblems(games, season, today = new Date()) {
  const problems = [];
  if (games.length === 0) return ["no games on the page"];
  const start = `${season}-08-01`;
  const end = `${season + 1}-01-31`;
  const outside = games.filter((g) => g.date < start || g.date > end);
  if (outside.length) problems.push(`${outside.length} game(s) dated outside the season (${outside[0].date})`);
  const monthIn = new Date(`${season}-09-15T00:00:00Z`);
  if (today >= monthIn && !games.some((g) => g.played)) problems.push("no played game with both scores after mid-September");
  if (games.some((g) => !g.home.name || !g.away.name)) problems.push("a game without both team names");
  return problems;
}

/** `--canary`: one seed page, read and checked. Exits 1, so the workflow fails and its owner is emailed, on any problem. */
async function canary() {
  const page = await fetchSchedule(SEEDS[0]);
  if (!page) throw new Error(`${scheduleUrl(SEEDS[0], SEASON)}: no page (404 or redirect)`);
  const games = parseSchedule(page.html); // throws on a page shape this reader does not know
  const problems = canaryProblems(games, SEASON);
  const note = problems.length
    ? [`MaxPreps canary: ${problems.length} problem(s) on ${page.url}`, ...problems].join("\n")
    : `MaxPreps canary: ${games.length} games, ${games.filter((g) => g.played).length} played, shape as expected.`;
  console.log(note);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${note.replaceAll("\n", "  \n")}\n`, { flag: "a" });
  if (problems.length) process.exitCode = 1;
}

/** `--due <playoffs.csv>`: how many bracket games of tonight and the last few game nights have no score yet (dueGames).
 * The workflow reads only when it is not 0. */
function due() {
  const file = process.argv[process.argv.indexOf("--due") + 1];
  console.log(dueGames(readFileSync(file, "utf8"), gameNight()).length);
}

/** A read writes its captures under RESULTS. In CI that must be the private data repo: without PRIVATE_DATA they would land
 * in data/seed, and a robot commit could publish them (ADR 0029). A local run without it still writes to data/seed. */
export function requirePrivateData(env = process.env) {
  if (env.CI === "true" && !env.PRIVATE_DATA) {
    throw new Error("PRIVATE_DATA is not set: in CI a read writes its captures (source pages, teams.csv, outside.csv, coverage.txt) only to the private data repo's checkout, so set PRIVATE_DATA to it (ADR 0029).");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv.includes("--due") ? due : process.argv.includes("--canary") ? canary : process.argv.includes("--tonight") ? tonight : main;
  try {
    if (mode === main || mode === tonight) requirePrivateData(); // --due and --canary write no capture
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  await mode();
}
