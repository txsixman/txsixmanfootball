// Live scores from Dave Campbell's Texas Football's public game-schedule feed, a second live source beside MaxPreps
// (ADR 0024: read with the site owner's written permission, live scores only, for now). Run only by results-watch.yml
// on a game-day tick, after the MaxPreps night read:
//   node tools/league-watch/davecampbells.mjs --live <playoffs.csv> --merge <live.json>
// reads tonight's still-unscored bracket games (the same Central game-night rule as maxpreps.mjs --tonight), asks the
// feed for the Live and Upcoming games of one mapped team per game, and merges the games under way into <live.json>
// (the rows packages/db/live.mjs sends). It reads only teams, kickoff, status, scores, period and forfeit flags: never
// a spread, ranking, poll or `winner` field. Nothing is saved to this repo. A 403 or 429 stops the read at once.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { centralDate, gameNight, slugify, tonightsGames } from "./maxpreps.mjs";

export const ORIGIN = "https://www.davecampbells.com";
export const USER_AGENT = "project-80x40-results-reader/1.0 (six-man scores; one request per 2.5 s)";
/** The feed's id for each season (seen in its own pages). A season not listed is not read. */
export const SEASON_IDS = { 2026: "ddb8e968-3ddb-4c32-ba99-8329ed0a2853" };
const GAP_MS = 2500;
const TEAMS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "davecampbells-teams.json");

/** Their team slug from a team address ("https://www.davecampbells.com/team/jayton-jaybirds" or "/team/jayton-jaybirds"). */
export function teamSlugOf(url) {
  const m = /(?:^|\/)team\/([a-z0-9-]+)\/?(?:[?#]|$)/.exec(String(url ?? ""));
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
    if (res.status === 403 || res.status === 429) throw new Error(`HTTP ${res.status} from the feed: stopping the read (ADR 0024)`);
    if (res.status !== 200) {
      console.warn(`feed answered ${res.status}: skipped`);
      return null;
    }
    const body = await res.json().catch(() => null);
    return body?.success === true ? body.data : null;
  }
  return { getData };
}

/** The feed's id of a team (their slug) for a season, or null. */
export async function teamId(client, theirSlug, seasonId) {
  const data = await client.getData(`/api/public/teams/${encodeURIComponent(theirSlug)}?seasonId=${encodeURIComponent(seasonId)}`);
  const id = data?.id ?? data?.team?.id;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
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

/**
 * Tonight's games under way as live rows (packages/db/live.mjs): games of `date` (Central) that are one of tonight's
 * still-unscored bracket games (`due`), with both teams mapped to our programs (`ours`: their slug to our slug). Scores
 * are set in the bracket row's own home and away order. Skipped: a forfeit, a score outside 0 to 200, and a 0-0 with no
 * period (a game may list 0-0 before kickoff). One row a game.
 */
export function liveRowsFromItems(items, { date, due, ours, readAt = new Date() }) {
  const dueByKey = new Map(due.map((r) => [[r.game_date, ...[slugify(r.home), slugify(r.away)].sort()].join("|"), r]));
  const rows = new Map();
  for (const item of items) {
    if (!isLive(item) || !item?.scheduledKickoff) continue;
    const kickoff = new Date(item.scheduledKickoff);
    if (Number.isNaN(kickoff.getTime()) || centralDate(kickoff) !== date) continue;
    const parts = Array.isArray(item.participants) ? item.participants : [];
    const side = (type) => parts.find((p) => p?.participantType === type);
    const [h, a] = [side("HOME"), side("AWAY")];
    if (!h || !a || h.forfeited === true || a.forfeited === true) continue;
    const [hs, as] = [ours.get(teamSlugOf(h.websiteUrl)), ours.get(teamSlugOf(a.websiteUrl))];
    if (!hs || !as || hs === as) continue;
    const key = [date, ...[hs, as].sort()].join("|");
    const row = dueByKey.get(key);
    if (!row || rows.has(key)) continue;
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
  if (!seasonId) return summary(`Second live read: no feed season id for ${date.slice(0, 4)}, nothing read.`);
  const due = tonightsGames(readFileSync(playoffsFile, "utf8"), date);
  if (!due.length) return summary("Second live read: no bracket game of tonight is still without a score.");
  const { theirs, ours } = teamMaps(JSON.parse(readFileSync(TEAMS_FILE, "utf8")));
  // One mapped team a game is enough: its schedule lists the game.
  const teams = [...new Set(due.map((r) => theirs.get(slugify(r.home)) ?? theirs.get(slugify(r.away))).filter(Boolean))];
  const client = createClient();
  const items = [];
  for (const t of teams) {
    const id = await teamId(client, t, seasonId);
    if (id) items.push(...(await liveAndUpcoming(client, seasonId, id)));
  }
  const rows = liveRowsFromItems(items, { date, due, ours });
  const before = JSON.parse(readFileSync(mergeFile, "utf8"));
  if (!Array.isArray(before)) throw new Error(`${mergeFile} is not a list of live rows`);
  writeFileSync(mergeFile, `${JSON.stringify(mergeLive(before, rows), null, 2)}\n`);
  summary(`Second live read: ${due.length} games due, ${teams.length} teams read, ${rows.length} under way (${due.length - due.filter((r) => theirs.has(slugify(r.home)) || theirs.has(slugify(r.away))).length} games with no mapped team).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await live();
