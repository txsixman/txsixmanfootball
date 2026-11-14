// Live scores from Dave Campbell's Texas Football's public game-schedule feed, a second live source beside MaxPreps
// (ADR 0025: read with the site owner's written permission, live scores only, for now). Run only by results-watch.yml
// on a game-day tick, after the MaxPreps night read:
//   node tools/league-watch/davecampbells.mjs --live <playoffs.csv> --merge <live.json>
// reads tonight's still-unscored bracket games (the same Central game-night rule as maxpreps.mjs --tonight), asks the
// feed for the Live and Upcoming games of one mapped team per game, and merges the games under way into <live.json>
// (the rows packages/db/live.mjs sends). It reads only teams, kickoff, status, scores, period and forfeit flags: never
// a spread, ranking, poll or `winner` field. Nothing is saved to this repo. A 403 or 429 stops the read at once.
//
// Finals, as a private cross-check of MaxPreps (ADR 0026, the same permission):
//   node tools/league-watch/davecampbells.mjs --finals <private playoffs.csv> --report <private davecampbells-<season>/>
// compares the bracket finals MaxPreps has scored in the last three game nights with the feed's, and keeps one row a
// game in <report>/finals-check.csv (with the feed's team ids in <report>/team-ids.json), in the private data repo
// only. The run summary gets counts, never a team or a score.
//
// Seasons (ADR 0032), run by hand, to the private data repo only: `--seasons` lists the feed's seasons,
// `--history <year> --private <private repo>` writes a season's six-man games to <private>/davecampbells-history-<year>/games.csv,
// and `--team <year> <their slug>` shows one team's game count and statuses. On Nov 13, 2026 only 2026 had games.
//
// Problems that do not fail the step (it runs with continue-on-error) are named in the file OPS_REASONS, when set, for
// the workflow's notify job to post to the robot-alert issue (ADR 0028): a refusal (403 or 429), no season id from
// August on, and no agreeing final among 10 or more checked games of past nights.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { centralDate, gameNight, slugify, tonightsGames } from "./maxpreps.mjs";
import { parseCsv } from "./store.mjs";

export const ORIGIN = "https://www.davecampbells.com";
export const USER_AGENT = "txsixmanfootball-results-reader/1.0 (+https://txsixmanfootball.com; contact@txsixmanfootball.com)";
/** The feed's id for each season (seen in its own pages). A season not listed is not read. */
export const SEASON_IDS = { 2026: "ddb8e968-3ddb-4c32-ba99-8329ed0a2853" };
const GAP_MS = 2500;
const TEAMS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "davecampbells-teams.json");

/** Their team slug: the feed gives it bare ("jayton-jaybirds") or in a team address (".../team/jayton-jaybirds"). */
export function teamSlugOf(url) {
  const text = String(url ?? "");
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(text)) return text;
  const m = /(?:^|\/)team\/([a-z0-9-]+)\/?(?:[?#]|$)/.exec(text);
  return m ? m[1] : null;
}

/**
 * One reader for a run: one request at a time, `gapMs` apart, our own user agent, no redirect followed. Only paths
 * under /api/public/ are asked for. A 403 or 429 is the site saying stop: it throws, and the run ends with no retry.
 * Anything else that is not a 200 with `success` gives null (logged).
 */
export function createClient({ fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = GAP_MS } = {}) {
  let last = 0;
  async function getData(pathAndQuery) {
    if (!pathAndQuery.startsWith("/api/public/")) throw new Error(`not a public feed path: ${pathAndQuery}`);
    const wait = last + gapMs - Date.now();
    if (last && wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetchImpl(`${ORIGIN}${pathAndQuery}`, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 403 || res.status === 429) throw new Error(`HTTP ${res.status} from the feed: stopping the read (ADR 0025)`);
    if (res.status !== 200) {
      console.warn(`feed answered ${res.status}: skipped`);
      return null;
    }
    const body = await res.json().catch(() => null);
    if (body?.success === true) return body.data;
    // The shape changed: say which fields came back (names only, never values), so the fix is one look away.
    console.warn(`feed answer without success: ${shapeOf(body)}`);
    return null;
  }
  return { getData };
}

/** Field names of an answer, two levels deep, with no values: `{a, b:{c, d}}`. */
export function shapeOf(value, depth = 2) {
  if (Array.isArray(value)) return `[${value.length ? shapeOf(value[0], depth) : ""}]`;
  if (value === null || typeof value !== "object") return typeof value;
  if (depth === 0) return "{…}";
  return `{${Object.entries(value).map(([k, v]) => (v !== null && typeof v === "object" ? `${k}:${shapeOf(v, depth - 1)}` : k)).join(", ")}}`;
}

/** The feed's id of a team (their slug) for a season, or null (the answer's field names are logged). */
export async function teamId(client, theirSlug, seasonId) {
  const data = await client.getData(`/api/public/teams/${encodeURIComponent(theirSlug)}?seasonId=${encodeURIComponent(seasonId)}`);
  const id = data?.teamId ?? data?.id;
  if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) return id;
  if (data) console.warn(`no team id in the answer for ${theirSlug}: ${shapeOf(data)}`);
  return null;
}

/** A team's games that are live or still to come this season. */
export async function liveAndUpcoming(client, seasonId, id) {
  const data = await client.getData(`/api/public/game-schedules?seasonId=${encodeURIComponent(seasonId)}&teamId=${encodeURIComponent(id)}&status=Live%2CUpcoming`);
  return Array.isArray(data?.items) ? data.items : [];
}

/** The period as the site shows it (letters, digits and spaces only, at most 12): "Q1" to "Q4", "Halftime", "OT"; else null. */
export function periodLabel(summary) {
  const p = summary?.period;
  if (typeof p === "number" && Number.isInteger(p)) return p >= 1 && p <= 4 ? `Q${p}` : p > 4 ? "OT" : null;
  if (typeof p !== "string") return null;
  const t = p.trim();
  if (/^half(time)?$/i.test(t)) return "Halftime";
  const q = /^(?:q|quarter\s*)?([1-4])(?:st|nd|rd|th)?(?:\s*quarter)?$/i.exec(t);
  if (q) return `Q${q[1]}`;
  if (/^(ot|overtime)\s*\d*$/i.test(t)) return "OT";
  return null;
}

/** A game under way: the feed's status says live, in progress or halftime (any case, spaces or dashes). */
export function isLive(item) {
  const s = String(item?.status ?? item?.summary?.status ?? "").toLowerCase().replace(/[\s_-]/g, "");
  return s === "live" || s === "inprogress" || s === "halftime";
}

const score = (n) => (Number.isInteger(n) && n >= 0 && n <= 200 ? n : null);

/** The feed's school name is our program's: the same slug, or one is the other plus a town ("Lark" and "lark-west"). */
export function sameSchool(schoolName, ourSlug) {
  const s = slugify(String(schoolName ?? ""));
  return s !== "" && (s === ourSlug || ourSlug.startsWith(`${s}-`) || s.startsWith(`${ourSlug}-`));
}

/**
 * Tonight's games under way as live rows (packages/db/live.mjs): games of `date` (Central) that are one of tonight's
 * still-unscored bracket games (`due`). A team is ours by the map (`ours`: their slug to our slug); when only one team is
 * mapped, the other is that team's opponent in tonight's bracket row, and only if the feed's school name matches it.
 * Scores are set in the bracket row's own home and away order. Skipped: a forfeit, a score outside 0 to 200, and a 0-0
 * with no period (a game may list 0-0 before kickoff). One row a game.
 */
export function liveRowsFromItems(items, { date, due, ours, readAt = new Date() }) {
  const rows = new Map();
  for (const m of matchTonight(items, { date, due, ours })) {
    const { item, key, row, h, a, hs, as } = m;
    if (!isLive(item) || rows.has(key) || h.forfeited === true || a.forfeited === true) continue;
    const [hScore, aScore] = [score(h.score ?? item.summary?.homeScore), score(a.score ?? item.summary?.awayScore)];
    if (hScore === null || aScore === null) continue;
    const period = periodLabel(item.summary);
    if (hScore === 0 && aScore === 0 && !period) continue;
    // The bracket row's home and away, whatever the feed calls them.
    const flip = slugify(row.home) !== hs;
    rows.set(key, {
      game_key: key,
      home: flip ? as : hs,
      away: flip ? hs : as,
      home_score: flip ? aScore : hScore,
      away_score: flip ? hScore : aScore,
      period,
      read_at: readAt.toISOString(),
    });
  }
  return [...rows.values()].sort((x, y) => x.game_key.localeCompare(y.game_key));
}

/** The feed's games of `date` (Central) that are one of tonight's due bracket games, whatever their status. */
export function matchTonight(items, { date, due, ours }) {
  return matchGames(items, { rows: due.filter((r) => r.game_date === date), ours });
}

/** A game's key: its date and both program slugs in order, as the live rows and the finals report use it. */
const gameKey = (date, a, b) => [date, ...[a, b].sort()].join("|");

/**
 * The feed's games that are one of `rows` (bracket rows of any dates): the same date (the kickoff's, Central) and the
 * same two programs. A team is ours by the map (`ours`: their slug to our slug); when only one is mapped, the other is
 * that team's opponent in its bracket row of that date, and only if the feed's school name matches it.
 */
export function matchGames(items, { rows, ours }) {
  const byKey = new Map(rows.map((r) => [gameKey(r.game_date, slugify(r.home), slugify(r.away)), r]));
  // Each program's opponent in its bracket game, by date.
  const opponent = new Map(rows.flatMap((r) => [[`${r.game_date}|${slugify(r.home)}`, slugify(r.away)], [`${r.game_date}|${slugify(r.away)}`, slugify(r.home)]]));
  const found = [];
  for (const item of items) {
    if (!item?.scheduledKickoff) continue;
    const kickoff = new Date(item.scheduledKickoff);
    if (Number.isNaN(kickoff.getTime())) continue;
    const date = centralDate(kickoff);
    const resolve = (p, other) => {
      const mapped = ours.get(teamSlugOf(p.websiteUrl));
      if (mapped) return mapped;
      const theirs = other && ours.get(teamSlugOf(other.websiteUrl));
      const expected = theirs && opponent.get(`${date}|${theirs}`);
      return expected && sameSchool(p.schoolName, expected) ? expected : undefined;
    };
    const parts = Array.isArray(item.participants) ? item.participants : [];
    const side = (type) => parts.find((p) => p?.participantType === type);
    const [h, a] = [side("HOME"), side("AWAY")];
    if (!h || !a) continue;
    const [hs, as] = [resolve(h, a), resolve(a, h)];
    if (!hs || !as || hs === as) continue;
    const key = gameKey(date, hs, as);
    const row = byKey.get(key);
    if (row) found.push({ item, key, row, h, a, hs, as });
  }
  return found;
}

/**
 * Both sources' rows for tonight, one per game. Scores only go up during a game, so the row with the higher total is
 * the newer read; on a tie, the one that knows the period. Neither row names a winner, and every live score stays
 * unconfirmed on the site.
 */
export function mergeLive(first, second) {
  const total = (r) => r.home_score + r.away_score;
  const better = (x, y) => (total(y) > total(x) || (total(y) === total(x) && !x.period && y.period) ? y : x);
  const byKey = new Map(first.map((r) => [r.game_key, r]));
  for (const r of second) byKey.set(r.game_key, byKey.has(r.game_key) ? better(byKey.get(r.game_key), r) : r);
  return [...byKey.values()].sort((x, y) => x.game_key.localeCompare(y.game_key));
}

/** Our program slug to their team slug (davecampbells-teams.json, reviewed by hand), and the reverse. */
export function teamMaps(json) {
  const theirs = new Map(Object.entries(json).filter(([o, t]) => /^[a-z0-9-]+$/.test(o) && /^[a-z0-9-]+$/.test(t)));
  return { theirs, ours: new Map([...theirs].map(([o, t]) => [t, o])) };
}

// ---- Finals: a private cross-check of MaxPreps (ADR 0026) ----

/** The statuses asked for: every finished game, forfeits included, so a forfeit is seen and skipped, not missed. */
export const FINAL_STATUSES = ["Final", "Completed", "Finished", "Forfeit", "Double Forfeit"];
/** At most this many teams asked a run (two requests each at most), oldest games first: a backlog never bursts. */
export const TEAMS_PER_RUN = 8;
/** Games of the last this-many game nights are checked; an older one keeps the verdict it last had. */
export const NIGHTS = 3;
export const REPORT_FILE = "finals-check.csv";
export const IDS_FILE = "team-ids.json";
export const REPORT_COLUMNS = ["game_date", "home", "away", "mp_home", "mp_away", "dc_home", "dc_away", "verdict", "first_checked", "last_checked"];
/** agree: both finals the same. disagree: not. dc-missing: the game is not among the team's finished games (no final
 * there yet), or its status is one the code does not know. dc-forfeit: the feed says forfeit (skipped). unmatched: no
 * mapped team, or no team id for it. Every verdict but agree and dc-forfeit is checked again on later runs. */
export const VERDICTS = ["agree", "disagree", "dc-missing", "dc-forfeit", "unmatched"];

const normal = (s) => String(s ?? "").toLowerCase().replace(/[\s_-]/g, "");
/** A finished game: status Final, Completed or Finished (any case, spaces or dashes). */
export const isFinal = (item) => ["final", "completed", "finished"].includes(normal(item?.status ?? item?.summary?.status));
/** A forfeit, by its status or either side's flag. */
export const isForfeit = (item) =>
  normal(item?.status ?? item?.summary?.status).includes("forfeit") || (Array.isArray(item?.participants) && item.participants.some((p) => p?.forfeited === true));

/** A team's finished games this season, newest first. */
export async function finishedGames(client, seasonId, id) {
  const status = encodeURIComponent(FINAL_STATUSES.join(","));
  const data = await client.getData(`/api/public/game-schedules?seasonId=${encodeURIComponent(seasonId)}&teamId=${encodeURIComponent(id)}&status=${status}&sort=NEWEST`);
  return Array.isArray(data?.items) ? data.items : [];
}

/** The date `days` before a Central date ("2026-11-13", 3 -> "2026-11-10"). */
export const daysBefore = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

const csvRows = (text) => {
  const [header, ...lines] = String(text ?? "").trimEnd().split("\n");
  if (!header) return [];
  const cols = header.split(",");
  return lines.filter(Boolean).map((l) => Object.fromEntries(cols.map((c, i) => [c, l.split(",")[i] ?? ""])));
};
const intScore = (s) => (/^\d{1,3}$/.test(s) && Number(s) <= 200 ? Number(s) : null);

/**
 * The bracket games to check now (oldest first): scored by MaxPreps, not a forfeit there, dated from `NIGHTS` game
 * nights before `date` up to `date`, and not settled. Settled: the last verdict was agree or dc-forfeit and MaxPreps
 * still has the score that verdict was for (a corrected score is checked again).
 */
export function gamesToCheck(playoffsText, report, date) {
  const from = daysBefore(date, NIGHTS);
  return csvRows(playoffsText)
    .filter((r) => r.game_date >= from && r.game_date <= date && intScore(r.home_score) !== null && intScore(r.away_score) !== null && r.end_reason !== "forfeit")
    .filter((r) => {
      const last = report.get(gameKey(r.game_date, slugify(r.home), slugify(r.away)));
      const same = last && last.mp_home === r.home_score && last.mp_away === r.away_score && last.home === slugify(r.home);
      return !(same && (last.verdict === "agree" || last.verdict === "dc-forfeit"));
    })
    .sort((x, y) => x.game_date.localeCompare(y.game_date) || slugify(x.home).localeCompare(slugify(y.home)));
}

/** The feed's final of a matched game, in the bracket row's home and away order: { forfeit } or { home, away } or null. */
export function finalOf({ item, row, h, a, hs }) {
  if (isForfeit(item)) return { forfeit: true };
  if (!isFinal(item)) return null;
  const [hScore, aScore] = [score(h.score ?? item.summary?.homeScore), score(a.score ?? item.summary?.awayScore)];
  if (hScore === null || aScore === null) return null;
  const flip = slugify(row.home) !== hs;
  return { home: flip ? aScore : hScore, away: flip ? hScore : aScore };
}

/** One game's verdict from MaxPreps' row and the feed's final (finalOf), or null when the feed had no final. */
export function verdictOf(mpRow, dc) {
  if (!dc) return "dc-missing";
  if (dc.forfeit) return "dc-forfeit";
  return dc.home === Number(mpRow.home_score) && dc.away === Number(mpRow.away_score) ? "agree" : "disagree";
}

/** The report as a map by game key, and back to CSV (sorted by date, then home). */
export const readReport = (text) => new Map(csvRows(text).map((r) => [gameKey(r.game_date, r.home, r.away), r]));
export const reportCsv = (report) =>
  [REPORT_COLUMNS.join(","), ...[...report.values()].sort((x, y) => x.game_date.localeCompare(y.game_date) || x.home.localeCompare(y.home)).map((r) => REPORT_COLUMNS.map((c) => r[c] ?? "").join(","))].join("\n") + "\n";

/**
 * One finals check. Asks the feed for at most TEAMS_PER_RUN teams (a cached team id saves a request) and records a
 * verdict for every game it looked at. A 403 or 429 throws (the caller writes nothing). Returns the new report, the team
 * ids and the counts for the summary.
 */
export async function checkFinals({ playoffsText, report, ids, date, seasonId, client, theirs, ours, now = new Date(), warn = console.warn }) {
  const stamp = now.toISOString();
  const games = gamesToCheck(playoffsText, report, date);
  const out = new Map(report);
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  const record = (r, verdict, dc) => {
    const [home, away] = [slugify(r.home), slugify(r.away)];
    const key = gameKey(r.game_date, home, away);
    const last = out.get(key);
    out.set(key, {
      game_date: r.game_date,
      home,
      away,
      mp_home: r.home_score,
      mp_away: r.away_score,
      dc_home: dc && !dc.forfeit ? String(dc.home) : "",
      dc_away: dc && !dc.forfeit ? String(dc.away) : "",
      verdict,
      first_checked: last?.first_checked || stamp,
      last_checked: stamp,
    });
    counts[verdict]++;
  };
  // Each game asks its first mapped team; a team's list covers all its games.
  const teamOf = (r) => theirs.get(slugify(r.home)) ?? theirs.get(slugify(r.away));
  const teams = [];
  for (const r of games) {
    const t = teamOf(r);
    if (!t) record(r, "unmatched", null);
    else if (!teams.includes(t) && teams.length < TEAMS_PER_RUN) teams.push(t);
  }
  const ids2 = { ...ids };
  let requests = 0;
  let shapeLogged = false;
  for (const t of teams) {
    if (!ids2[t]) {
      requests++;
      const id = await teamId(client, t, seasonId);
      if (!id) {
        for (const r of games.filter((g) => teamOf(g) === t)) record(r, "unmatched", null);
        continue;
      }
      ids2[t] = id;
    }
    requests++;
    const items = await finishedGames(client, seasonId, ids2[t]);
    const mine = games.filter((g) => teamOf(g) === t);
    const matched = new Map(matchGames(items, { rows: mine, ours }).map((m) => [m.key, m]));
    for (const r of mine) {
      const m = matched.get(gameKey(r.game_date, slugify(r.home), slugify(r.away)));
      // Not in the team's finished games: no final there yet (or a game the feed lists another way).
      if (!m) {
        record(r, "dc-missing", null);
        continue;
      }
      const dc = finalOf(m);
      if (!dc && !shapeLogged) {
        // A status the code does not know: say which fields came back (names only, never values).
        warn(`a matched game has a status the finals check does not know: ${shapeOf(m.item)}`);
        shapeLogged = true;
      }
      record(r, verdictOf(r, dc), dc);
    }
  }
  const left = games.filter((r) => teamOf(r) && !teams.includes(teamOf(r))).length;
  return { report: out, ids: ids2, counts, requests, teams: teams.length, games: games.length, left };
}

/** The run summary's line: counts only, never a team or a score (the repo's Actions summaries are public). */
export const finalsSummary = ({ counts, teams, requests, games, left }) =>
  `Finals cross-check: ${games} games to check, ${teams} teams asked (${requests} requests); ${counts.agree} agree, ${counts.disagree} disagree, ${counts["dc-missing"]} no final there yet, ${counts["dc-forfeit"]} forfeits skipped, ${counts.unmatched} unmatched${left ? `, ${left} left for the next run` : ""}.`;

/** Names a problem for the robot-alert issue (ADR 0028); a no-op without OPS_REASONS. */
export function raise(reason, file = process.env.OPS_REASONS) {
  if (file) appendFileSync(file, `${reason}\n`);
}

/** A season id is owed from August on (the season is under way); before that a missing one is not a problem yet. */
export const seasonIdOwed = (date) => Number(date.slice(5, 7)) >= 8;

/** At least this many checked games of past nights with none agreeing means the cross-check itself is broken. */
export const NO_AGREEMENT_MIN = 10;

/**
 * Did the check find no agreeing final among NO_AGREEMENT_MIN or more games of the past game nights in its window?
 * Checked means agree, disagree or dc-missing: a game the feed was asked about. Tonight's games are left out (their
 * finals may not be posted yet).
 */
export function noAgreement(report, date) {
  const from = daysBefore(date, NIGHTS);
  const rows = [...report.values()].filter((r) => r.game_date >= from && r.game_date < date && ["agree", "disagree", "dc-missing"].includes(r.verdict));
  return rows.length >= NO_AGREEMENT_MIN && !rows.some((r) => r.verdict === "agree");
}

/** Runs a mode; a refusal from the feed is named for the robot-alert issue before the step fails. */
async function guarded(mode) {
  try {
    await mode();
  } catch (e) {
    if (/HTTP (403|429)/.test(e.message)) raise("second-source-refused");
    throw e;
  }
}

async function finals() {
  const arg = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
  const playoffsFile = arg("--finals");
  const dir = arg("--report");
  if (!playoffsFile || !dir) throw new Error("usage: davecampbells.mjs --finals <private playoffs.csv> --report <private dir>");
  const summary = (line) => {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`, { flag: "a" });
  };
  const date = gameNight();
  // The season under way: from July on this year's, before July last year's (as the results reader counts it).
  const season = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) >= 7 ? 0 : 1);
  const seasonId = SEASON_IDS[season];
  if (!seasonId) {
    if (seasonIdOwed(date)) raise("second-source-no-season");
    return summary(`Finals cross-check: no feed season id for ${season}, nothing read.`);
  }
  const reportPath = path.join(dir, REPORT_FILE);
  const idsPath = path.join(dir, IDS_FILE);
  const report = readReport(existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "");
  const ids = existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, "utf8")) : {};
  const { theirs, ours } = teamMaps(JSON.parse(readFileSync(TEAMS_FILE, "utf8")));
  const result = await checkFinals({ playoffsText: readFileSync(playoffsFile, "utf8"), report, ids, date, seasonId, client: createClient(), theirs, ours });
  if (result.games) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(reportPath, reportCsv(result.report));
    writeFileSync(idsPath, `${JSON.stringify(Object.fromEntries(Object.entries(result.ids).sort()), null, 2)}\n`);
  }
  summary(finalsSummary(result));
  if (noAgreement(result.report, date)) raise("second-source-no-agreement");
}

async function live() {
  const arg = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
  const playoffsFile = arg("--live");
  const mergeFile = arg("--merge");
  if (!playoffsFile || !mergeFile) throw new Error("usage: davecampbells.mjs --live <playoffs.csv> --merge <live.json>");
  const date = gameNight();
  const seasonId = SEASON_IDS[Number(date.slice(0, 4))];
  const summary = (line) => {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`, { flag: "a" });
  };
  if (!seasonId) {
    if (seasonIdOwed(date)) raise("second-source-no-season");
    return summary(`Second live read: no feed season id for ${date.slice(0, 4)}, nothing read.`);
  }
  const due = tonightsGames(readFileSync(playoffsFile, "utf8"), date);
  if (!due.length) return summary("Second live read: no bracket game of tonight is still without a score.");
  const { theirs, ours } = teamMaps(JSON.parse(readFileSync(TEAMS_FILE, "utf8")));
  // One mapped team a game is enough: its schedule lists the game.
  const teams = [...new Set(due.map((r) => theirs.get(slugify(r.home)) ?? theirs.get(slugify(r.away))).filter(Boolean))];
  const client = createClient();
  const items = [];
  let ids = 0;
  for (const t of teams) {
    const id = await teamId(client, t, seasonId);
    if (id) (ids++, items.push(...(await liveAndUpcoming(client, seasonId, id))));
  }
  const rows = liveRowsFromItems(items, { date, due, ours });
  const seen = new Set(matchTonight(items, { date, due, ours }).map((m) => m.key));
  const before = JSON.parse(readFileSync(mergeFile, "utf8"));
  if (!Array.isArray(before)) throw new Error(`${mergeFile} is not a list of live rows`);
  writeFileSync(mergeFile, `${JSON.stringify(mergeLive(before, rows), null, 2)}\n`);
  // Games listed but none of tonight's found: the item shape (names only) shows whether matching or the feed changed.
  if (items.length && !seen.size) console.warn(`none of tonight's games matched; a listed game looks like ${shapeOf(items[0])}`);
  const unmapped = due.filter((r) => !theirs.has(slugify(r.home)) && !theirs.has(slugify(r.away))).length;
  summary(`Second live read: ${due.length} games due (${unmapped} with no mapped team), ${teams.length} teams asked, ${ids} ids found, ${items.length} games listed, ${seen.size} of tonight's games found, ${rows.length} under way.`);
}

// ---- Past seasons (ADR 0032: the same permission, which the owner confirmed covers past seasons) ----
//   node tools/league-watch/davecampbells.mjs --seasons
// lists the feed's seasons (year, id, sport, school type).
//   node tools/league-watch/davecampbells.mjs --history <year> --private <private data repo>
// reads the finished games of every mapped team (davecampbells-teams.json) in the feed's high school football season of
// <year>, and writes the six-man games among them to <private>/davecampbells-history-<year>/games.csv: date, both programs, the
// scores and the forfeit flags. Never a ranking, poll, spread or the `winner` field. It writes nothing to this repo.

/** The private per-season file's columns: the facts the merge needs, our program slugs, no source. */
export const HISTORY_COLUMNS = ["game_date", "home", "away", "home_score", "away_score", "home_forfeit", "away_forfeit"];
export const HISTORY_FILE = "games.csv";

/** The feed's high school (boys) football season ids by year, from its season list. */
export function footballSeasons(data) {
  const ids = new Map();
  for (const s of Array.isArray(data) ? data : []) {
    if (s?.sportName === "Football" && s?.gender === "BOYS" && s?.schoolTypeName === "High School" && Number.isInteger(s?.year) && typeof s?.seasonId === "string") {
      if (!ids.has(s.year)) ids.set(s.year, s.seasonId);
    }
  }
  return ids;
}

/** Every finished game of a team in a season, all pages. A page that repeats or a page count past 20 stops it (logged). */
export async function allFinishedGames(client, seasonId, id, warn = console.warn) {
  const status = encodeURIComponent(FINAL_STATUSES.join(","));
  const base = `/api/public/game-schedules?seasonId=${encodeURIComponent(seasonId)}&teamId=${encodeURIComponent(id)}&status=${status}&sort=NEWEST&size=100`;
  const items = [];
  let data = await client.getData(base);
  for (let pages = 1; ; pages++) {
    if (!Array.isArray(data?.items)) {
      if (data != null) warn(`game list without items: ${shapeOf(data)}`);
      return items;
    }
    items.push(...data.items);
    const [page, total] = [data.page, data.totalPages];
    if (!Number.isInteger(page) || !Number.isInteger(total) || page + 1 >= total || (page === 0 && total === 1)) return items;
    if (pages >= 20) {
      warn(`game list past 20 pages: stopped`);
      return items;
    }
    const next = await client.getData(`${base}&page=${page + 1}`);
    if (next?.page === page) {
      warn(`game list page ${page + 1} answered as page ${page}: stopped`);
      return items;
    }
    data = next;
  }
}

/**
 * Our programs, for opponents the map does not name: every program slug in the published seasons and the lineage
 * table, with the program each old name became and the season it changed.
 */
export function knownPrograms(seedDir) {
  const slugs = new Set();
  const renamed = new Map(); // successor slug -> [{ from: predecessor slug, season }]
  for (const dir of existsSync(seedDir) ? readdirSync(seedDir) : []) {
    if (!/^maxpreps-\d{4}$/.test(dir)) continue;
    for (const f of ["games.csv", "playoffs.csv"]) {
      const file = path.join(seedDir, dir, f);
      if (!existsSync(file)) continue;
      for (const r of csvRows(readFileSync(file, "utf8"))) for (const n of [r.home, r.away]) if (n) slugs.add(slugify(n));
    }
  }
  const lineage = path.join(seedDir, "lineage", "programs.csv");
  if (existsSync(lineage)) {
    for (const line of readFileSync(lineage, "utf8").trimEnd().split("\n").slice(1)) {
      const [pred, succ, , season] = line.split(",");
      if (!pred || !succ || !/^\d{4}$/.test(season)) continue;
      const [p, s] = [slugify(pred), slugify(succ)];
      slugs.add(p).add(s);
      renamed.set(s, [...(renamed.get(s) ?? []), { from: p, season: Number(season) }]);
    }
  }
  return { slugs, renamed };
}

/** A program's name in `season`: the old one when the lineage table says it changed later. */
export function asOf(slug, season, renamed) {
  const later = (renamed.get(slug) ?? []).filter((r) => r.season > season).sort((a, b) => a.season - b.season);
  return later.length ? asOf(later[0].from, season, renamed) : slug;
}

/**
 * One of our programs by the feed's school name: the only known slug that is the same school, or null. When our slug
 * adds a town to the feed's name ("community-christian-mineral-wells" for "Community Christian"), the town must be in
 * the feed's own team slug too, so a same-named school elsewhere is never taken for ours.
 */
export function programByName(schoolName, slugs, theirSlug = "") {
  const name = slugify(String(schoolName ?? ""));
  const theirs = new Set(String(theirSlug ?? "").split("-"));
  // The words our slug adds, less the ones that name a kind of school rather than a place.
  const town = (s) => (s.startsWith(`${name}-`) ? s.slice(name.length + 1).split("-").filter((w) => !SCHOOL_WORDS.has(w)) : []);
  const hits = [...slugs].filter((s) => sameSchool(schoolName, s) && town(s).every((w) => theirs.has(w)));
  return hits.length === 1 ? hits[0] : null;
}

/** Words our program slugs add to a school's name that say what kind of school it is, not where. */
const SCHOOL_WORDS = new Set(["school", "schools", "high", "hs", "academy", "charter", "christian", "classical", "prep", "preparatory", "the", "of", "and", "isd", "cisd"]);

const flag = (b) => (b === true ? "true" : "false");
const cell = (n) => (score(n) === null ? "" : String(n));

/**
 * The season's six-man games among `items` (any teams' finished games, repeats allowed): one row a game (date and both
 * programs), oldest first. A team is ours by the map, else by its school name among `slugs`; a game with a team that is
 * neither (an 11-man opponent, a school we do not carry) is counted in `skipped`, never written. Only finished games and
 * forfeits; scores outside 0 to 200 are left blank.
 */
export function historyRows(items, { ours, slugs, renamed, season }) {
  const rows = new Map();
  const skipped = { notFinished: 0, notOurs: 0, noDate: 0, forfeitUnflagged: 0 };
  for (const item of items) {
    if (!isFinal(item) && !isForfeit(item)) {
      skipped.notFinished++;
      continue;
    }
    const kickoff = new Date(item?.scheduledKickoff ?? NaN);
    if (Number.isNaN(kickoff.getTime())) {
      skipped.noDate++;
      continue;
    }
    const parts = Array.isArray(item.participants) ? item.participants : [];
    const [h, a] = ["HOME", "AWAY"].map((t) => parts.find((p) => p?.participantType === t));
    const program = (p) => p && (ours.get(teamSlugOf(p.websiteUrl)) ?? programByName(p.schoolName, slugs, teamSlugOf(p.websiteUrl)));
    const [hs, as] = [program(h), program(a)].map((s) => s && asOf(s, season, renamed));
    if (!hs || !as || hs === as) {
      skipped.notOurs++;
      continue;
    }
    const date = centralDate(kickoff);
    const key = gameKey(date, hs, as);
    if (rows.has(key)) continue;
    // A forfeit names its side: a forfeit status with neither side flagged is not written (counted).
    if (isForfeit(item) && h.forfeited !== true && a.forfeited !== true) {
      skipped.forfeitUnflagged++;
      continue;
    }
    // A final of 0-0 is the feed's placeholder, not a result: no score (a forfeit keeps what it says).
    let [hScore, aScore] = [cell(h.score ?? item.summary?.homeScore), cell(a.score ?? item.summary?.awayScore)];
    if (hScore === "0" && aScore === "0" && !isForfeit(item)) [hScore, aScore] = ["", ""];
    rows.set(key, {
      game_date: date,
      home: hs,
      away: as,
      home_score: hScore,
      away_score: aScore,
      home_forfeit: flag(h.forfeited === true),
      away_forfeit: flag(a.forfeited === true),
    });
  }
  const list = [...rows.values()].sort((x, y) => x.game_date.localeCompare(y.game_date) || x.home.localeCompare(y.home));
  return { rows: list, skipped };
}

export const historyCsv = (rows) => [HISTORY_COLUMNS.join(","), ...rows.map((r) => HISTORY_COLUMNS.map((c) => r[c]).join(","))].join("\n").concat("\n");

/** `--seasons`: the feed's season list, one line a season (year, id, sport, gender, school type). */
async function seasons() {
  const data = await createClient().getData("/api/public/seasons");
  if (!Array.isArray(data)) return console.log(`/api/public/seasons: ${data == null ? "no data" : shapeOf(data, 3)}`);
  for (const s of data) console.log([s.year, s.seasonId, s.sportName, s.gender, s.schoolTypeName, s.isCurrent ? "current" : ""].join(" | "));
}

/** `--history <year> --private <dir>`: one season's six-man games from the feed, to the private repo. */
async function history() {
  const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
  const year = Number(arg("--history"));
  const root = arg("--private");
  if (!Number.isInteger(year) || year < 1938 || !root) throw new Error("usage: davecampbells.mjs --history <year> --private <private data repo>");
  const client = createClient();
  const seasonId = footballSeasons(await client.getData("/api/public/seasons")).get(year);
  if (!seasonId) return console.log(`${year}: the feed lists no high school football season`);
  const { theirs, ours } = teamMaps(JSON.parse(readFileSync(TEAMS_FILE, "utf8")));
  const { slugs, renamed } = knownPrograms(path.join(path.dirname(TEAMS_FILE), "..", "..", "data", "seed"));
  const items = [];
  let teams = 0;
  let shown = false;
  for (const theirSlug of new Set(theirs.values())) {
    const id = await teamId(client, theirSlug, seasonId);
    if (!id) continue;
    teams++;
    const games = await allFinishedGames(client, seasonId, id);
    // The first game's field names, once, so a changed answer is one look away (names only, never values).
    if (!shown && games.length) {
      shown = true;
      console.log(`game fields: ${shapeOf(games[0], 2)}`);
    }
    items.push(...games);
  }
  const { rows, skipped } = historyRows(items, { ours, slugs, renamed, season: year });
  const dir = path.join(root, `davecampbells-history-${year}`);
  if (rows.length) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, HISTORY_FILE), historyCsv(rows));
  }
  console.log(`${year}: ${teams} of ${theirs.size} teams found, ${items.length} finished games read, ${rows.length} six-man games written` +
    ` (skipped: ${skipped.notOurs} with a team not ours, ${skipped.notFinished} not finished, ${skipped.noDate} with no date, ${skipped.forfeitUnflagged} forfeits naming no side)`);
}

/** `--team <year> <their slug>`: one team's game list in a season, with no status filter: how many games and which
 * statuses, so a season that reads nothing is one look away. Counts and status names only. */
async function team() {
  const i = process.argv.indexOf("--team");
  const [year, theirSlug] = [Number(process.argv[i + 1]), process.argv[i + 2]];
  if (!Number.isInteger(year) || !theirSlug) throw new Error("usage: davecampbells.mjs --team <year> <their team slug>");
  const client = createClient();
  const seasonId = footballSeasons(await client.getData("/api/public/seasons")).get(year);
  const t = seasonId && (await client.getData(`/api/public/teams/${encodeURIComponent(theirSlug)}?seasonId=${encodeURIComponent(seasonId)}`));
  if (!t?.teamId) return console.log(`${year} ${theirSlug}: no season or team id`);
  const current = await client.getData(`/api/public/teams/${encodeURIComponent(theirSlug)}`);
  console.log(`team id the same as with no season: ${current?.teamId === t.teamId}; previousSeasonRecords: ${shapeOf(t.previousSeasonRecords, 2)}`);
  const by = (k, v) => `&${k}=${encodeURIComponent(v)}`;
  for (const q of [by("teamId", t.teamId), by("schoolId", t.schoolId), ""]) {
    const data = await client.getData(`/api/public/game-schedules?seasonId=${encodeURIComponent(seasonId)}${q}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    const statuses = [...new Set(items.map((x) => x?.status ?? x?.summary?.status))].join(", ");
    console.log(`query "${q.split("=")[0] || "season only"}": ${items.length} items, total ${data?.totalElements}, pages ${data?.totalPages}, page ${data?.page}, size ${data?.size}, statuses: ${statuses}`);
  }
}

// Game details (ADR 0036): the feed's scheduled kickoff, in UTC, for every bracket game with no score yet, kept in the public
// facts file data/seed/game-details/<year>.csv. The file names no source: date, the two teams as the bracket spells them, the
// kickoff, and the site (filled by a later read; blank until then).
export const DETAIL_COLUMNS = "date,home,away,kickoff_utc,site_name,site_city";
const kickoffKey = (date, home, away) => gameKey(date, slugify(home), slugify(away));

/** The kickoff of each `due` bracket row the feed lists, as a facts row; a row the feed does not list is left out. */
export function kickoffRows(items, { due, ours }) {
  return matchGames(items, { rows: due, ours }).map(({ item, row }) => ({
    date: row.game_date,
    home: row.home,
    away: row.away,
    kickoff_utc: new Date(item.scheduledKickoff).toISOString().replace(/\.\d{3}Z$/, "Z"),
    site_name: "",
    site_city: "",
  }));
}

/** The facts file with `fresh` rows laid over the kept ones, field by field: a fresh value wins, a blank keeps the old one. */
export function mergeKickoffs(text, fresh) {
  const kept = text.trim() ? parseCsv(text, "game details").rows : [];
  const out = new Map(kept.map((r) => [kickoffKey(r.date, r.home, r.away), r]));
  for (const r of fresh) {
    const k = kickoffKey(r.date, r.home, r.away);
    const old = out.get(k) ?? {};
    out.set(k, Object.fromEntries(DETAIL_COLUMNS.split(",").map((c) => [c, r[c] || old[c] || ""])));
  }
  const rows = [...out.values()].sort((a, b) => a.kickoff_utc.localeCompare(b.kickoff_utc) || a.home.localeCompare(b.home));
  const cols = DETAIL_COLUMNS.split(",");
  for (const r of rows) if (cols.some((c) => r[c].includes(","))) throw new Error(`a comma in a game detail: ${r.date} ${r.home} / ${r.away}`);
  return [DETAIL_COLUMNS, ...rows.map((r) => cols.map((c) => r[c]).join(","))].join("\n") + "\n";
}

async function kickoffs() {
  const arg = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
  const playoffsFile = arg("--kickoffs");
  const out = arg("--out");
  if (!playoffsFile || !out) throw new Error("usage: davecampbells.mjs --kickoffs <playoffs.csv> --out <data/seed/game-details/YYYY.csv>");
  const today = centralDate();
  const seasonId = SEASON_IDS[Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) >= 7 ? 0 : 1)];
  if (!seasonId) return console.log("Kickoffs: no feed season id for this season, nothing read.");
  const due = parseCsv(readFileSync(playoffsFile, "utf8"), "playoffs.csv").rows.filter((r) => r.home_score === "" && r.game_date >= today);
  if (!due.length) return console.log("Kickoffs: no bracket game still to play.");
  const { theirs, ours } = teamMaps(JSON.parse(readFileSync(TEAMS_FILE, "utf8")));
  // One mapped team a game is enough: its schedule lists the game.
  const teams = [...new Set(due.map((r) => theirs.get(slugify(r.home)) ?? theirs.get(slugify(r.away))).filter(Boolean))];
  const client = createClient();
  const items = [];
  for (const t of teams) {
    const id = await teamId(client, t, seasonId);
    if (id) items.push(...(await liveAndUpcoming(client, seasonId, id)));
  }
  const fresh = kickoffRows(items, { due, ours });
  writeFileSync(out, mergeKickoffs(existsSync(out) ? readFileSync(out, "utf8") : "", fresh));
  console.log(`Kickoffs: ${due.length} bracket games still to play, ${teams.length} teams read, ${fresh.length} kickoff times found.`);
}

const MODES = { "--finals": finals, "--seasons": seasons, "--history": history, "--team": team, "--kickoffs": kickoffs };
if (process.argv[1] === fileURLToPath(import.meta.url)) await guarded(Object.entries(MODES).find(([f]) => process.argv.includes(f))?.[1] ?? live);
