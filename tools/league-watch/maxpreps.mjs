// Reads 2026 six-man game results from MaxPreps team schedule pages (ADR 0008). Facts only: date, teams, score.
// Starts from a few seed teams and follows opponents that are in our alignments, so it walks the six-man network.
// Polite: robots.txt allows /<state>/<city>/<team>/football/schedule/, one request every 2.5 s, each page read once.
//
//   node tools/league-watch/maxpreps.mjs [--season 2027]
// writes maxpreps-<season>/games.csv, teams.csv (every team page found, the next run's seeds) and coverage.txt in
// $PRIVATE_DATA (the private data repo; data/seed without it). tools/league-watch/publish.mjs copies the facts here.
// A read merges into the stored files and never deletes or blanks a stored score (store.mjs, ADR 0031); a past season read
// in full is marked complete (season.json) and not read again without --reread.
// A read is targeted (only the team pages the store is missing, targetPages) except a season's first read, a past season,
// Mondays (the weekly audit) and --full, which walk every team page from the seeds.
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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { duplicateRows } from "../../apps/web/lib/duplicate-game.ts";
import { CHANGES_FILE, changeLines, countsLine, mergeStored, movedDate, MOVES_FILE, parseCsv, PENDING_FILE, pendingCsv, readMoves, readPending, rowKey } from "./store.mjs";

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
const USER_AGENT = "txsixmanfootball-results-reader/1.0 (+https://txsixmanfootball.com; contact@txsixmanfootball.com)";
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

/**
 * One of our schools' team page when opponents' schedules link it to more than one page (the source sometimes links an
 * opponent to another school of the same name: 2018 to 2021 West Texas schedules link "Wilson" to a Dallas 11-man page).
 * The page whose own page says six-man that season wins, then any page that does not say 11-man, then the last seen
 * (as before). `football` is empty in the season under way, so there the last seen stands.
 */
export function pickTeamPage(urls, football) {
  const kind = (u) => football.get(u)?.kind;
  return urls.find((u) => kind(u) === "6") ?? urls.findLast((u) => kind(u) !== "11") ?? urls.at(-1);
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
  if (/\bTAPPS\b/.test(t) && (m = b.match(/6[ -]Man (?:Division )?(I{1,3}|IV)\b(.*)$/))) return { league: "TAPPS", division: `${m[1]}${m[2]}`.trim() };
  if (/\bTAIAO\b/.test(t) && (m = b.match(/^Division (I{1,3}|[1-3])$/))) return { league: "TAIAO", division: roman[m[1]] ?? m[1] };
  // TCAF's 2018 to 2021 seasons had two six-man divisions ("6 Man I", "6-Man II"); `part` keeps which, for
  // splitTcafDivisions. The stored division stays "Six-Man" until a whole season can be split.
  if (/\bTCAF\b/.test(t)) {
    const part = b.match(/^6[ -]Man (I{1,2})$/)?.[1];
    return part ? { league: "TCAF", division: "Six-Man", part } : { league: "TCAF", division: "Six-Man" };
  }
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

/** The leagues whose past brackets keep a game against a school outside our alignments (ADR 0069). */
export const UNLISTED_BRACKET_LEAGUES = new Set(["TAPPS", "TAIAO", "TCAF"]);

/**
 * A past season's private-league bracket games between one of our schools and one outside our alignments (ADR 0069): a
 * school that has since closed, left six-man or left the league, read from our school's own schedule page. Each is kept
 * once (the same date, our school and their page), its other side named as the source names it, plus its city when that
 * name is one of our schools' or another unlisted team's (two pages, one name), so it never reads as a listed school.
 * Commas and quotes are dropped from a name (the files are plain comma-joined cells). Copies that disagree on the score
 * are left out and counted. Returns the games in playoffsCsv's shape (`label` names the unlisted side) and the conflicts.
 */
export function unlistedBracketGames(found, bySlug) {
  const clean = (s) => s.replace(/[",]/g, " ").replace(/\s+/g, " ").trim();
  const pages = new Map(); // unlisted page -> its team
  for (const g of found) {
    const theirs = g.home.slug ? g.away : g.home;
    pages.set(theirs.url, theirs);
  }
  const byName = Map.groupBy([...pages.values()], (t) => slugify(clean(t.name)));
  const label = new Map(
    [...pages.values()].map((t) => {
      const plain = clean(t.name);
      const clash = bySlug.has(slugify(plain)) || byName.get(slugify(plain)).length > 1;
      return [t.url, clash ? `${plain} (${clean(t.city)})` : plain];
    }),
  );
  const groups = Map.groupBy(found, (g) => {
    const ours = g.home.slug ? g.home : g.away;
    return [g.date, ours.slug, (ours === g.home ? g.away : g.home).url].join("|");
  });
  const games = [];
  let conflicts = 0;
  for (const copies of groups.values()) {
    const played = copies.filter((g) => g.played);
    if (new Set(played.map((g) => [`${g.home.url}:${g.home.score}`, `${g.away.url}:${g.away.score}`].sort().join("|"))).size > 1) {
      conflicts++;
      continue;
    }
    const g = played[0] ?? copies[0];
    const side = (t) => (t.slug ? t : { ...t, slug: slugify(label.get(t.url)), label: label.get(t.url) });
    games.push({ ...g, home: side(g.home), away: side(g.away) });
  }
  return { games, conflicts };
}

/** Each game's round from its whole bracket (`{ league, division, date }` each), in the order given (roundName). */
export function roundsFor(list) {
  const key = (x) => `${x.league}|${x.division}`;
  const weeks = new Map();
  for (const x of list) weeks.set(key(x), [...new Set([...(weeks.get(key(x)) ?? []), weekOf(x.date)])].sort());
  return list.map((x) => {
    const own = weeks.get(key(x));
    const inWeek = (w) => list.filter((y) => key(y) === key(x) && weekOf(y.date) === w).length;
    // A round holds at most 2^k games k rounds before the final. The first week's count sets how many rounds came before
    // it, for every league. In TAPPS and TAIAO a last week with more than one game is semifinals, not a final (a past
    // bracket whose State Championship no listed page shows, ADR 0069). TCAF's two-division seasons play two State
    // Championship games in one week under one bracket, so TCAF's last week is not checked.
    const need = (j) => j + Math.ceil(Math.log2(2 * inWeek(own[j])));
    const last = ["TAPPS", "TAIAO"].includes(x.league) ? [need(own.length - 1)] : [];
    return roundName(x.league, own.indexOf(weekOf(x.date)), Math.max(own.length, need(0), ...last));
  });
}

/**
 * A past season read in full (`--reread`) names every stored TAPPS, TAIAO and TCAF playoffs.csv row's round again from its whole stored bracket
 * (ADR 0069). A round is this reader's own inference from the game weeks, never a fact the source gives, and an earlier
 * read that saw part of a bracket named it a week off (a "final" a week before the real one). Only the round changes:
 * teams, scores, dates and sources stand. Returns the text and how many rows changed round.
 */
export function relabelRounds(text) {
  const { header, cols, rows } = parseCsv(text, "playoffs.csv");
  if (!rows.length) return { text, relabeled: 0, changes: [], partial: [] };
  const rounds = roundsFor(rows.map((r) => ({ league: r.league, division: r.division, date: r.game_date })));
  const bracketOfRow = (r) => `${r.league} ${r.division}`;
  // Only a consistent bracket is named again: one final, in its last week, and no round with more games than it can hold
  // (2^k games k rounds before the final). A round with fewer games is a game no listed school's page shows, which leaves
  // the structure as it is. Any other bracket keeps its stored names and is reported.
  const partial = [];
  for (const [bracket, idx] of Map.groupBy(rows.map((_, i) => i).filter((i) => UNLISTED_BRACKET_LEAGUES.has(rows[i].league)), (i) => bracketOfRow(rows[i]))) {
    const count = (round) => idx.filter((i) => rounds[i] === round).length;
    // With a final in its last week, a bracket has one round a week, so a round's place from the end is its week's.
    const weeks = [...new Set(idx.map((i) => weekOf(rows[i].game_date)))].sort();
    const fits = count("final") === 1 &&
      weeks.every((w, j) => idx.filter((i) => weekOf(rows[i].game_date) === w).length <= 2 ** (weeks.length - 1 - j));
    if (!fits) partial.push(bracket);
  }
  const changes = new Map(); // "league division from → to" -> games
  let relabeled = 0;
  const out = rows.map((r, i) => {
    // UIL's past brackets are out of scope, and a partial bracket keeps its stored names: their rounds stand.
    const round = UNLISTED_BRACKET_LEAGUES.has(r.league) && !partial.includes(bracketOfRow(r)) ? rounds[i] : r.round;
    if (r.round !== round) {
      relabeled++;
      const k = `${bracketOfRow(r)}: ${r.round} → ${round}`;
      changes.set(k, (changes.get(k) ?? 0) + 1);
    }
    return cols.map((c) => (c === "round" ? round : r[c])).join(",");
  });
  return { text: [header, ...out].join("\n") + "\n", relabeled, changes: [...changes].map(([k, n]) => `${k} (${n})`), partial };
}

/**
 * A past TCAF season with two six-man divisions (ADR 0070), split from its one stored "Six-Man" bracket. `parts` maps a
 * game (rowKey) to the division its own bracket names ("I" or "II"). The season is split only when it is whole: both
 * divisions named, every stored TCAF row's game named by this read, and each division alone a consistent bracket (one
 * State Championship game, no week holding more games than its round can). Otherwise every row stays "Six-Man" and the
 * reason is returned. Only the division changes; rounds are then named again per division (relabelRounds).
 */
export function splitTcafDivisions(text, parts) {
  const { header, cols, rows } = parseCsv(text, "playoffs.csv");
  // A row split by an earlier read keeps its division; only "Six-Man" rows take one from this read.
  const tcaf = rows.filter((r) => r.league === "TCAF" && r.division === "Six-Man");
  const named = new Set(parts.values());
  if (!tcaf.length || !(named.has("I") && named.has("II"))) return { text, split: null, kept: null };
  const unnamed = tcaf.filter((r) => !parts.has(rowKey(r))).length;
  if (unnamed) return { text, split: null, kept: `${unnamed} of ${tcaf.length} games with no division named` };
  const divisionOf = (r) => (r.division === "Six-Man" ? parts.get(rowKey(r)) : r.division);
  const all = rows.filter((r) => r.league === "TCAF");
  for (const d of ["I", "II"]) {
    const list = all.filter((r) => divisionOf(r) === d);
    const rounds = roundsFor(list.map((r) => ({ league: "TCAF", division: d, date: r.game_date })));
    const weeks = [...new Set(list.map((r) => weekOf(r.game_date)))].sort();
    const fits = rounds.filter((x) => x === "final").length === 1 &&
      weeks.every((w, j) => list.filter((r) => weekOf(r.game_date) === w).length <= 2 ** (weeks.length - 1 - j));
    if (!fits) return { text, split: null, kept: `division ${d} is not a whole bracket (${list.length} games)` };
  }
  const out = rows.map((r) => cols.map((c) => (c === "division" && r.league === "TCAF" && r.division === "Six-Man" ? divisionOf(r) : r[c])).join(","));
  const count = (d) => tcaf.filter((r) => divisionOf(r) === d).length;
  return { text: [header, ...out].join("\n") + "\n", split: `I (${count("I")}) and II (${count("II")})`, kept: null };
}

/**
 * A past bracket game the source lists twice, a day or two apart with the same score (one copy on each team's page), is
 * one game (ADR 0069). A fresh playoffs.csv row is left out when another fresh or stored row of the same bracket has the
 * same two teams and score within two days, later (a fresh pair keeps its later copy, as data/corrections does) or
 * stored (a stored row stands, ADR 0031). Two copies under one round would also load as one database game whose date
 * flips on every load. Returns the fresh text and how many rows were left out.
 */
export function withoutNearCopies(fresh, storedText) {
  const { header, rows } = parseCsv(fresh, "playoffs.csv");
  if (!rows.length) return { text: fresh, dropped: 0 };
  const stored = parseCsv(storedText, "playoffs.csv").rows;
  const sig = (r) => [r.league, r.division, ...[`${slugify(r.home)}:${r.home_score}`, `${slugify(r.away)}:${r.away_score}`].sort()].join("|");
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
  const scored = (r) => r.home_score !== "" && r.away_score !== "";
  const keep = rows.filter((r) => {
    if (!scored(r)) return true;
    const near = (o) => o !== r && scored(o) && o.game_date !== r.game_date && sig(o) === sig(r) && days(o.game_date, r.game_date) <= 2;
    return !stored.some(near) && !rows.some((o) => near(o) && o.game_date > r.game_date);
  });
  const lines = fresh.trimEnd().split("\n");
  const text = [header, ...lines.slice(1).filter((_, i) => keep.includes(rows[i]))].join("\n") + "\n";
  return { text, dropped: rows.length - keep.length };
}

export function playoffsCsv(games, bySlug) {
  // An unlisted side (ADR 0069) carries its own name; every other team is named as our alignments name it.
  const nameOf = (t) => t.label ?? bySlug.get(t.slug).school;
  const rounds = roundsFor(games.map((g) => ({ league: g.bracket.league, division: g.bracket.division, date: g.date })));
  const rows = games
    .map((g, i) => {
      const round = rounds[i];
      return [
        g.bracket.league, g.bracket.division, round, g.date, nameOf(g.home), nameOf(g.away),
        "", g.played ? g.home.score : "", g.played ? g.away.score : "", g.played ? "unknown" : "", "", g.gameUrl ?? g.source, "",
      ];
    })
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]) || a[4].localeCompare(b[4]));
  return [`league,${COLUMNS}`, ...rows.map((r) => r.join(","))].join("\n") + "\n";
}

/**
 * MaxPreps sometimes lists one game twice under two contest ids. Copies that agree on the score are one game (a copy
 * with a bracket wins); copies that disagree are all dropped and returned as conflicts, for coverage.txt. Then the shared
 * rule (apps/web/lib/duplicate-game.ts, also the ratings' and check-data's): the same two teams with the same score at most two
 * days apart are one game too, the earlier date kept, the later one returned in `repeats` (the source lists a late game a
 * day apart on each team's schedule). A game whose
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
  const playedKept = kept.filter((g) => g.played);
  const copies = duplicateRows(playedKept.map((g) => ({ game_date: g.date, home: g.home.slug, away: g.away.slug, home_score: g.home.score, away_score: g.away.score })));
  // A copy that carries the bracket gives it to the game that stays, so a playoff game is never dropped with its copy.
  for (const [i, first] of copies) if (playedKept[i].bracket && !playedKept[first].bracket) playedKept[first].bracket = playedKept[i].bracket;
  const repeats = [...copies].map(([i, first]) => `${playedKept[i].date} ${playedKept[i].away.slug} at ${playedKept[i].home.slug} ${playedKept[i].away.score}-${playedKept[i].home.score}, a copy of the game on ${playedKept[first].date}`);
  return { kept: copies.size ? kept.filter((g) => !g.played || !copies.has(playedKept.indexOf(g))) : kept, conflicts, selfGames, repeats };
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

/** A season stored and marked complete (ADR 0031) is never read again, except with --reread (a manual workflow input). */
export const SEASON_FILE = "season.json";
export function seasonComplete(dir) {
  const file = path.join(dir, SEASON_FILE);
  return existsSync(file) && JSON.parse(readFileSync(file, "utf8")).complete === true;
}

/** Outside games (outside.csv) the store keeps when a read no longer lists them: no stored score is lost (ADR 0031). */
export function keepOutside(storedText, freshText) {
  const lines = (text) => (text.trim() ? text.trimEnd().split("\n") : []);
  const [header, ...fresh] = lines(freshText);
  const key = (l) => l.split(",").slice(0, 3).map((c, i) => (i ? slugify(c) : c)).join("|"); // date, team, opponent
  const have = new Set(fresh.map(key));
  const kept = lines(storedText).slice(1).filter((l) => !have.has(key(l)));
  const rows = [...fresh, ...kept].sort();
  return { csv: [header ?? OUTSIDE_COLUMNS, ...rows].join("\n") + "\n", kept: kept.length };
}

/** The store's unplayed games between schools in our alignments (ADR 0031): what a targeted read looks for. Private. */
export const SCHEDULE_FILE = "schedule.csv";
export const SCHEDULE_COLUMNS = "game_date,home,away";
/** A targeted read looks back this many days for games without a score. */
export const LOOKBACK_DAYS = 14;

/**
 * Full or targeted (ADR 0031). A full read walks every team page from the seeds; it is the first read of a season (no
 * schedule.csv yet), a past season's read, every Monday (UTC; the weekly audit, whatever starts the run) and `--full`.
 * Every other read is targeted: only the pages targetPages names.
 */
export const isFullRead = ({ argv, now, past, scheduleStored }) => past || !scheduleStored || argv.includes("--full") || new Date(now).getUTCDay() === 1;

/**
 * The team pages a targeted read reads, from the store alone (ADR 0031):
 * - both teams of an unplayed game (schedule.csv) dated in the last LOOKBACK_DAYS days or today;
 * - both teams of a bracket game (playoffs.csv) dated in that window, played or not, so a winner's next game is found;
 * - a school in our alignments with no game stored this season (its schedule not yet captured).
 * Everything final and older than the window is not read again. Pages come from teams.csv; a team with none is skipped.
 */
export function targetPages({ today, schedule, games, playoffs, teams, schools }) {
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = (r) => r.game_date >= from && r.game_date <= today;
  const slugs = (rows) => rows.flatMap((r) => [slugify(r.home), slugify(r.away)]);
  const due = new Set([...slugs(schedule.filter(recent)), ...slugs(playoffs.filter(recent))]);
  const stored = new Set(slugs([...schedule, ...games, ...playoffs]));
  const uncaptured = schools.filter((s) => !stored.has(s));
  const want = new Set([...due, ...uncaptured]);
  const pages = [...new Set([...want].map((s) => teams.get(s)).filter(Boolean))];
  return { pages, due: due.size, uncaptured: uncaptured.length, noPage: [...want].filter((s) => !teams.has(s)).length };
}

/** A stored playoffs.csv row as the reader's game, so a targeted read names rounds from the whole stored bracket. */
export const storedBracketGame = (r) => ({
  date: r.game_date,
  bracket: { league: r.league, division: r.division },
  home: { slug: slugify(r.home), score: r.home_score === "" ? null : Number(r.home_score) },
  away: { slug: slugify(r.away), score: r.away_score === "" ? null : Number(r.away_score) },
  played: r.home_score !== "" && r.away_score !== "",
  gameUrl: r.source_url,
});

async function main() {
  if (seasonComplete(OUT) && !process.argv.includes("--reread")) {
    return console.log(`Season ${SEASON} is stored and marked complete (${path.join(OUT, SEASON_FILE)}): nothing read. To read it again, pass --reread.`);
  }
  const bySlug = loadAlignments();
  // Team pages are the same every season, so a season with no teams.csv of its own starts from a neighbour's.
  const known = [OUT, ...[SEASON - 1, SEASON + 1].map((y) => path.join(RESULTS, `maxpreps-${y}`))].map((d) => path.join(d, "teams.csv")).find(existsSync);
  const fromLastRun = known ? readFileSync(known, "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[1]) : [];
  const storedText = (name) => (existsSync(path.join(OUT, name)) ? readFileSync(path.join(OUT, name), "utf8") : "");
  const full = isFullRead({ argv: process.argv, now: Date.now(), past: SEASON < DEFAULT_SEASON, scheduleStored: existsSync(path.join(OUT, SCHEDULE_FILE)) });
  const storedTeams = new Map(storedText("teams.csv").trim().split("\n").slice(1).filter(Boolean).map((l) => l.split(",")));
  const target = full
    ? null
    : targetPages({
        today: centralDate(new Date()),
        schedule: parseCsv(storedText(SCHEDULE_FILE), SCHEDULE_FILE).rows,
        games: parseCsv(storedText("games.csv"), "games.csv").rows,
        playoffs: parseCsv(storedText("playoffs.csv"), "playoffs.csv").rows,
        teams: storedTeams,
        schools: [...bySlug.keys()],
      });
  const queue = full ? [...new Set([...fromLastRun, ...SEEDS, ...Object.keys(ALIASES)])] : target.pages;
  console.log(full ? `Full read of ${SEASON}.` : `Targeted read of ${SEASON}: ${queue.length} team pages (${target.due} teams with a game in the last ${LOOKBACK_DAYS} days, ${target.uncaptured} with no stored game, ${target.noPage} with no known page).`);
  const seen = new Set(queue);
  const games = new Map();
  const reached = new Set();
  const teamPages = new Map(); // our slug -> MaxPreps team page
  const pageCandidates = new Map(); // our slug -> every page an opponent's schedule linked it to (pickTeamPage)
  const readPages = new Set();
  const outside = new Map(); // opponents not in our alignments, with how many games
  const outsideGames = new Map(); // played games of one of our schools against one that is not, for the ratings
  const unlistedFound = []; // past private-league bracket games against a school outside our alignments (ADR 0069)
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
          pageCandidates.set(t.slug, [...new Set([...(pageCandidates.get(t.slug) ?? []), t.url])]);
          if (full && !seen.has(t.url)) {
            seen.add(t.url);
            queue.push(t.url);
          }
        }
        const both = g.home.slug && g.away.slug;
        if (!both && (g.home.slug || g.away.slug) && g.played && !outsideGames.has(g.id)) outsideGames.set(g.id, { ...g, source: page.url });
        // A past season's private-league bracket game against a school no longer in our alignments (ADR 0069).
        if (!both && (g.home.slug || g.away.slug) && g.bracket && UNLISTED_BRACKET_LEAGUES.has(g.bracket.league) && SEASON < DEFAULT_SEASON) {
          unlistedFound.push({ ...g, source: page.url });
        }
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
  const { kept, conflicts, selfGames, repeats } = dedupe([...games.values()]);
  // A game its league moved (moved-games.csv, ADR 0046) is laid on the date it is played, before anything is written.
  const moves = readMoves(storedText(MOVES_FILE));
  for (const g of kept) g.date = movedDate(moves, g.date, g.home.slug, g.away.slug);
  // A row with the same school on both sides breaks the database (a game needs two team-seasons): name it loudly.
  for (const s of selfGames) console.log(`::warning::left out, the same school on both sides: ${s}`);
  for (const r of repeats) console.log(`::warning::left out, one game listed twice: ${r}`);
  // The store is the record (ADR 0031): this read merges into the stored files and never deletes or blanks a score.
  const now = new Date().toISOString();
  const readTeam = (name) => readPages.has(teamPages.get(slugify(name)));
  const stored = storedText;
  // A targeted read names playoff rounds from the whole stored bracket, its own games laid over it.
  const bracket = new Map(full ? [] : parseCsv(stored("playoffs.csv"), "playoffs.csv").rows.filter((r) => bySlug.has(slugify(r.home)) && bySlug.has(slugify(r.away))).map((r) => [rowKey(r), storedBracketGame(r)]));
  for (const g of kept.filter((g) => g.bracket)) bracket.set([g.date, ...[g.home.slug, g.away.slug].sort()].join("|"), g);
  const unlisted = unlistedBracketGames(unlistedFound.filter((g) => !isElevenMan(g, football)), bySlug);
  for (const g of unlisted.games) {
    g.date = movedDate(moves, g.date, g.home.slug, g.away.slug);
    const key = [g.date, ...[g.home.slug, g.away.slug].sort()].join("|");
    if (!bracket.has(key)) bracket.set(key, g);
  }
  let pending = readPending(stored(PENDING_FILE));
  const changes = [];
  const storeLines = [];
  const counted = {};
  for (const [name, read] of [["games.csv", toCsv(kept, bySlug)], ["playoffs.csv", playoffsCsv([...bracket.values()], bySlug)]]) {
    let fresh = read;
    if (name === "playoffs.csv" && SEASON < DEFAULT_SEASON) {
      const near = withoutNearCopies(read, stored(name));
      fresh = near.text;
      if (near.dropped) storeLines.push(`playoffs.csv: ${near.dropped} bracket games listed twice a day or two apart with the same score, the earlier copy left out (ADR 0069).`);
    }
    const m = mergeStored({ file: name, stored: stored(name), fresh, pending, readTeam, now });
    // A past season read in full names its stored bracket rounds again from the whole bracket (ADR 0069).
    if (name === "playoffs.csv" && full && SEASON < DEFAULT_SEASON) {
      // TCAF's two six-man divisions, when the whole season shows them (ADR 0070), before the rounds are named again.
      const nameOf = (t) => t.label ?? bySlug.get(t.slug).school;
      const parts = new Map([...bracket.values()].filter((g) => g.bracket?.part).map((g) => [rowKey({ game_date: g.date, home: nameOf(g.home), away: nameOf(g.away) }), g.bracket.part]));
      const tcaf = splitTcafDivisions(m.text, parts);
      m.text = tcaf.text;
      if (tcaf.split) storeLines.push(`playoffs.csv: TCAF split into its two six-man divisions, ${tcaf.split} (ADR 0070).`);
      if (tcaf.kept) storeLines.push(`playoffs.csv: TCAF kept as one six-man bracket: ${tcaf.kept} (ADR 0070).`);
      // Counts by league, division and round only: never a school (the summary is public).
      const r = relabelRounds(m.text);
      m.text = r.text;
      storeLines.push(`playoffs.csv: ${r.relabeled} rounds named again from the whole bracket (ADR 0069)${r.changes.length ? `: ${r.changes.join("; ")}` : ""}.`);
      if (r.partial.length) storeLines.push(`playoffs.csv: partial brackets, stored rounds kept (ADR 0069): ${r.partial.join("; ")}.`);
    }
    writeFileSync(path.join(OUT, name), m.text);
    pending = m.pending;
    changes.push(...m.changes);
    counted[name] = m.text;
    storeLines.push(countsLine(name, m.counts));
  }
  writeFileSync(path.join(OUT, PENDING_FILE), pendingCsv(pending));
  if (changes.length) appendFileSync(path.join(OUT, CHANGES_FILE), changeLines(changes, existsSync(path.join(OUT, CHANGES_FILE))));
  const outsideRows = outsideCsv([...outsideGames.values()], bySlug);
  const outsideStore = keepOutside(stored("outside.csv"), outsideRows.csv);
  writeFileSync(path.join(OUT, "outside.csv"), outsideStore.csv);
  storeLines.push(`outside.csv: ${outsideStore.kept} games kept that this read did not list.`);
  // The unplayed games, for the next targeted read: a full read writes what it found; a targeted read keeps the stored
  // list, drops the games now scored, and adds the unplayed games of the pages it read.
  const playedKeys = new Set([...parseCsv(counted["games.csv"]).rows, ...parseCsv(counted["playoffs.csv"]).rows].filter((r) => r.home_score !== "").map(rowKey));
  const unplayed = kept.filter((g) => !g.played).map((g) => ({ game_date: g.date, home: bySlug.get(g.home.slug).school, away: bySlug.get(g.away.slug).school }));
  const scheduleRows = new Map((full ? [] : parseCsv(stored(SCHEDULE_FILE), SCHEDULE_FILE).rows).map((r) => [rowKey(r), r]));
  for (const r of unplayed) scheduleRows.set(rowKey(r), r);
  for (const k of playedKeys) scheduleRows.delete(k);
  const scheduleList = [...scheduleRows.values()].sort((a, b) => a.game_date.localeCompare(b.game_date) || a.home.localeCompare(b.home));
  writeFileSync(path.join(OUT, SCHEDULE_FILE), [SCHEDULE_COLUMNS, ...scheduleList.map((r) => `${r.game_date},${r.home},${r.away}`)].join("\n") + "\n");
  storeLines.push(`${SCHEDULE_FILE}: ${scheduleList.length} unplayed games stored.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Results store (season ${SEASON}, ${full ? "full read" : "targeted read"}, ${pages} pages)\n\n${storeLines.map((l) => `- ${l}`).join("\n")}\n`);
  // Team pages: a full read writes what it found; a targeted read adds to the stored list and never shortens it.
  for (const [slug, urls] of pageCandidates) teamPages.set(slug, pickTeamPage(urls, football));
  const teamList = new Map([...(full ? [] : storedTeams), ...teamPages]);
  writeFileSync(path.join(OUT, "teams.csv"), ["slug,maxpreps_url", ...[...teamList.entries()].sort().map(([slug, url]) => `${slug},${url}`)].join("\n") + "\n");
  if (!full) {
    console.log(`\nTargeted read: ${pages} pages.`);
    for (const l of storeLines) console.log(l);
    return;
  }
  writeFileSync(
    path.join(OUT, "coverage.txt"),
    [
      `Season ${SEASON}, read ${new Date().toISOString().slice(0, 10)} from ${pages} MaxPreps schedule pages (ADR 0008).`,
      `${kept.filter((g) => g.played).length} played games between schools in our alignments on this read; ${parseCsv(counted["games.csv"]).rows.length} in the store.`,
      ...storeLines,
      `${outsideRows.count} played games against opponents outside them, in outside.csv (the ratings' hidden teams; ${outsideRows.conflicts} listed twice with different scores, left out).`,
      ...(SEASON < DEFAULT_SEASON ? [`${unlisted.games.length} private-league bracket games against a school outside our alignments, in playoffs.csv (ADR 0069; ${unlisted.conflicts} listed twice with different scores, left out).`] : []),
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
      `One game listed twice (the same teams and score, at most two days apart), so the later copy left out (${repeats.length}):`,
      ...repeats.sort(),
      "",
      `${outside.size} opponents outside our alignments (${[...outside.values()].reduce((a, b) => a + b, 0)} game sides skipped; for a past season these include schools no longer six-man or no longer listed), most games first:`,
      ...[...outside.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([n, k]) => `${k}  ${n}`),
    ].join("\n") + "\n",
  );
  // A past season read in full is finished: stored and marked complete, never read again without --reread.
  if (SEASON < DEFAULT_SEASON) writeFileSync(path.join(OUT, SEASON_FILE), `${JSON.stringify({ complete: true, read: now.slice(0, 10) }, null, 2)}\n`);
  console.log(`\nWrote ${OUT}/games.csv; ${missing.length} schools not reached (coverage.txt)`);
  for (const l of storeLines) console.log(l);
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
