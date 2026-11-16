// Playoff games about to be played with no kickoff or no site: names each one, so a person can find the missing fact
// before the fans do. A bracket game starting within 72 hours (Central dates; a game dated today counts until it is
// scored) that the site would show without a kickoff time or without "where" is listed, and a next-round pairing the
// bracket has set by winners but no listing holds yet counts too (its date is its round's: no date of its own).
// "Has a kickoff" and "has a site" are what the site shows (apps/web/lib/kickoffs.ts, ADRs 0036, 0041, 0047, 0067): the
// game's row in data/seed/game-details/<season>.csv, else the kickoff and site its bracket slot lists; a pairing without
// a listing finds its row by its two teams alone. A game voided by data/corrections is not a game.
//
//   node .github/scripts/playoff-details.mjs [--season 2026] [--hours 72] [--alert]
//
// Prints the games and writes them to GITHUB_STEP_SUMMARY. With --alert it also posts ONE comment on the open
// `ops-alert` issue (ops-alert.mjs, ADRs 0027 and 0028), or opens it. This is the deliberate exception to that issue's
// rule of naming no school: each game is named (two schools, league, division, round, date, what is missing) but never a
// score and never anything else from the data. The same games are posted at most once every QUIET_HOURS; a game not in
// any post of that window (a new one, or one missing more) posts at once. Always exits 0 for a warning: only a run that
// could not look (an unreadable file, a failed API call) exits 1, and the workflow marks that step continue-on-error.
// Needs a checkout of .github/scripts, tools/league-watch, apps/web/lib, data/seed and data/corrections.
// Env (--alert only): GITHUB_TOKEN (issues: write), GITHUB_REPOSITORY. Optional: GITHUB_STEP_SUMMARY.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bracketSlots, fill, ROUND_ORDER } from "../../apps/web/lib/bracket-fill.ts";
import { slugify } from "../../apps/web/lib/slug.ts";
import { builtDue, fillGame, seasonSlotRows, withoutVoided } from "../../tools/league-watch/bracket-due.mjs";
// Moved to bracket-due.mjs (pagePairings shares it); still exported from here.
export { withoutVoided };
import { parseCsv } from "../../tools/league-watch/store.mjs";
import { seasonOf } from "./gameday-clock.mjs";
import { BOT, github, keyIn, REASON_QUIET_HOURS } from "./ops-alert.mjs";

export const WINDOW_HOURS = 72;
/** The same games are posted at most once this often (ops-alert's REASON_QUIET_HOURS). */
export const QUIET_HOURS = REASON_QUIET_HOURS;
export const KEY_PREFIX = "playoff-details|";

const HOUR = 3_600_000;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HEADER = "date,home,away,kickoff_utc,site_name,site_city";
const ADDRESS_HEADER = `${HEADER},site_street,site_state,site_zip`;

/** A game by its date and two teams, in either order (lib/kickoffs.ts). */
export const gameKey = (date, a, b) => [date, ...[slugify(a), slugify(b)].sort()].join("|");
const pairKey = (a, b) => [slugify(a), slugify(b)].sort().join("|");

/** The Central calendar date (YYYY-MM-DD) of an instant. */
export const centralDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(ms));

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Thu Nov 19" from "2026-11-19". */
export function dayLabel(date) {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * game-details/<season>.csv as the site reads it: by game, the kickoff and the site, and by the two teams alone, every
 * row that has either (for a pairing no listing dates yet). A row that does not parse is dropped, as the site drops it.
 * @returns {{ kickoffs: Map<string,string>, sites: Map<string,string>, pairs: Map<string, {date:string, kickoff?:string, site?:string}[]> }}
 */
export function parseDetails(text) {
  const out = { kickoffs: new Map(), sites: new Map(), pairs: new Map() };
  const [header, ...lines] = text.trim().split("\n");
  if (!header) return out;
  if (header !== HEADER && header !== ADDRESS_HEADER) throw new Error(`game-details: unexpected header ${header}`);
  const width = header.split(",").length;
  for (const line of lines) {
    const fields = line.split(",");
    const [date, home, away, utc, name, city] = fields;
    if (fields.length !== width || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !home || !away || (utc && !UTC.test(utc))) continue;
    const site = name ? (city ? `${name}, ${city}` : name) : undefined;
    if (utc) out.kickoffs.set(gameKey(date, home, away), utc);
    if (site) out.sites.set(gameKey(date, home, away), site);
    if (utc || site) {
      const list = out.pairs.get(pairKey(home, away)) ?? [];
      list.push({ date, ...(utc && { kickoff: utc }), ...(site && { site }) });
      out.pairs.set(pairKey(home, away), list);
    }
  }
  return out;
}

/**
 * The kickoff and site a bracket slot lists, keyed to the listed game that fills it, as lib/kickoffs.ts bracketDetails
 * reads them: a kickoff on another day than the listed game's is not used.
 * @returns {{ key: string, kickoff?: string, site?: string }[]}
 */
export function slotDetailsOf(slotRows, playoffs) {
  const out = [];
  for (const [both, list] of Map.groupBy(slotRows.filter((r) => r.kickoff_utc || r.site), (r) => `${r.league}|${r.division}`)) {
    const [league, division] = both.split("|");
    const listed = playoffs.filter((r) => r.league === league && r.division === division).map((r) => ({ ...fillGame(r), confirmed: false }));
    for (const f of fill(bracketSlots(slotRows, listed, { league, division }), listed, ROUND_ORDER)) {
      const r = list.find((x) => x.slot === f.slot.slot);
      if (!r || !f.game) continue;
      const kickoff = r.kickoff_utc && UTC.test(r.kickoff_utc) && centralDate(Date.parse(r.kickoff_utc)) === f.game.date ? r.kickoff_utc : undefined;
      out.push({ key: gameKey(f.game.date, f.game.home, f.game.away), ...(kickoff && { kickoff }), ...(r.site && { site: r.site }) });
    }
  }
  return out;
}

/** Names go on a public issue: letters, digits, spaces and a few marks of a school name, at most 80 characters. */
const plain = (s) => String(s ?? "").replace(/[^A-Za-z0-9 ,.'()&-]/g, "").trim().slice(0, 80);

/** "UIL Division II", "TAIAO Division 1", "TAPPS II Large School", "TCAF Six-Man". */
const leagueLabel = (league, division) => `${plain(league)} ${/^([IVX]+|\d+)$/.test(division) ? `Division ${division}` : plain(division)}`;

/** The round as the pages name it: the last round is always "State Championship". */
export function roundText(round) {
  if (round === "state" || round === "final") return "State Championship";
  return round === "round-1" ? "first round" : plain(round);
}

/**
 * The unscored playoff games starting within `hours` hours that lack a kickoff, a site or both, each named.
 * `playoffs`: playoffs.csv rows (voided games already out); `details`: parseDetails(); `slotDetails`: slotDetailsOf();
 * `built`: builtDue() rows (pairings set by winners with no listing). A game's date, not its hour, puts it in the window
 * unless its kickoff is known (the kickoff then decides). A pairing no source dates at all (no row of its own, no game of
 * its round listed) is taken to be a week after its teams' last game and named for its missing date too: on Nov 16, 2026
 * four TAIAO semifinals had no date anywhere, and the alert said nothing about them.
 * @returns {{ id: string, date: string, built: boolean, missing: ("date"|"kickoff"|"site")[], line: string }[]}
 */
export function missingDetails({ playoffs, details, slotDetails = [], built = [], now, hours = WINDOW_HOURS }) {
  const today = centralDate(now);
  const lastDay = centralDate(now + hours * HOUR);
  const slotBy = new Map(slotDetails.map((d) => [d.key, d]));
  const found = [];
  const scored = (r) => r.home_score !== "" && r.away_score !== "";

  // `dated`: "own" (the game's own date), "round" (its round's, from another game of it) or "guessed" (a week after its
  // teams' last game: no source dates it).
  const add = (r, date, kickoff, site, dated = "own") => {
    if (kickoff && Date.parse(kickoff) > now + hours * HOUR) return; // a kickoff beyond the window, on the last day
    const missing = [...(dated === "guessed" ? ["date"] : []), ...(kickoff ? [] : ["kickoff"]), ...(site ? [] : ["site"])];
    if (!missing.length) return;
    const nos = missing.map((m) => `no ${m}`);
    const what = nos.length > 1 ? `${nos.slice(0, -1).join(", ")} and ${nos.at(-1)}` : nos[0];
    const note = { own: "", round: " (the round's date)", guessed: " (a week after their last game)" }[dated];
    const isBuilt = dated !== "own";
    const round = `${roundText(r.round)}, ${dayLabel(date)}${note}`;
    const line = `${plain(r.home)} v ${plain(r.away)} — ${leagueLabel(r.league, r.division)} ${round}: ${what}`;
    const id = createHash("sha1").update([r.league, r.division, r.round, date, r.home, r.away, missing.join("+")].join("|")).digest("hex").slice(0, 8);
    found.push({ id, date, built: isBuilt, missing, line });
  };

  for (const r of playoffs) {
    if (!r.home || !r.away || !/^\d{4}-\d{2}-\d{2}$/.test(r.game_date) || scored(r)) continue;
    if (r.game_date < today || r.game_date > lastDay) continue;
    const key = gameKey(r.game_date, r.home, r.away);
    const slot = slotBy.get(key);
    add(r, r.game_date, details.kickoffs.get(key) ?? slot?.kickoff, details.sites.get(key) ?? slot?.site);
  }

  for (const b of built) {
    const same = playoffs.filter((r) => r.league === b.league && r.division === b.division);
    // The file's first game between the two teams after their last listed games, as the bracket page finds it.
    const last = same.filter((r) => [r.home, r.away].some((t) => t === b.home || t === b.away)).map((r) => r.game_date).sort().at(-1) ?? "";
    const pair = (details.pairs.get(pairKey(b.home, b.away)) ?? []).filter((d) => d.date > last).sort((x, y) => x.date.localeCompare(y.date))[0];
    const roundDate = same.filter((r) => r.round === b.round && r.game_date >= today && r.game_date <= lastDay).map((r) => r.game_date).sort()[0];
    const guessed = !pair && !roundDate && last ? new Date(Date.parse(`${last}T12:00:00Z`) + 7 * 24 * HOUR).toISOString().slice(0, 10) : undefined;
    const date = pair?.date ?? roundDate ?? guessed;
    if (!date || date < today || date > lastDay) continue;
    add(b, date, pair?.kickoff, pair?.site, pair ? "own" : roundDate ? "round" : "guessed");
  }

  return found.sort((a, b) => a.date.localeCompare(b.date) || a.line.localeCompare(b.line));
}

/** The comment (or the new issue's body). The key carries each game's id, so the next run can see what was posted. */
export function bodyOf(games) {
  const lines = [
    `**${games.length} playoff game${games.length === 1 ? "" : "s"} within ${WINDOW_HOURS} hours ${games.length === 1 ? "has" : "have"} no kickoff or no site:**`,
    "",
    ...games.map((g) => `- ${g.line}`),
    "",
    `The site shows these games without the missing detail until it is in the data. The same games are posted at most once every ${QUIET_HOURS} hours; a new one posts at once. Close this issue once things are fixed; the next alert opens a new one.`,
    `<!-- ops-alert key=${encodeURIComponent(`${KEY_PREFIX}${games.map((g) => g.id).sort().join(",")}`)} -->`,
  ];
  return lines.join("\n");
}

/** Every game id the bot posted (issue body or comment) within `hours`. */
export function recentIds({ issue, comments }, now, hours = QUIET_HOURS) {
  const ids = new Set();
  for (const p of [{ body: issue.body, created_at: issue.created_at, user: issue.user }, ...comments]) {
    const key = keyIn(p.body);
    if (p.user?.login === BOT && key?.startsWith(KEY_PREFIX) && now - Date.parse(p.created_at) < hours * HOUR) {
      for (const id of key.slice(KEY_PREFIX.length).split(",")) ids.add(id);
    }
  }
  return ids;
}

/** One alert: comment on the open issue, or open one, unless every game was posted within the last QUIET_HOURS. */
export async function postAlert({ api, games, now = Date.now(), log = console.log }) {
  if (!games.length) {
    log("Playoff details: every game within the window has its kickoff and site, nothing posted.");
    return "nothing";
  }
  const body = bodyOf(games);
  const issue = await api.openIssue();
  if (issue) {
    const posted = recentIds({ issue, comments: await api.comments(issue.number) }, now);
    if (games.every((g) => posted.has(g.id))) {
      log(`Playoff details: the same games were posted on issue #${issue.number} within ${QUIET_HOURS} hours, not again.`);
      return "quiet";
    }
    await api.comment(issue.number, body);
    log(`Playoff details: commented on issue #${issue.number}.`);
    return "commented";
  }
  await api.ensureLabel();
  const made = await api.open(body);
  log(`Playoff details: opened issue #${made.number}.`);
  return "opened";
}

async function main(argv) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const now = Date.now();
  const season = Number(arg("--season") ?? seasonOf(now));
  const hours = Number(arg("--hours") ?? WINDOW_HOURS);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const seed = path.join(root, "data", "seed");
  const log = (line) => {
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  };

  const playoffsFile = path.join(seed, `maxpreps-${season}`, "playoffs.csv");
  if (!existsSync(playoffsFile)) {
    log(`Playoff details: no playoffs file for the ${season} season yet.`);
    return;
  }
  const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const corrections = read(path.join(root, "data", "corrections", "games.csv"));
  const playoffs = withoutVoided(parseCsv(readFileSync(playoffsFile, "utf8"), playoffsFile).rows, corrections);
  const slotRows = seasonSlotRows(seed, season);
  const games = missingDetails({
    playoffs,
    details: parseDetails(read(path.join(seed, "game-details", `${season}.csv`))),
    slotDetails: slotDetailsOf(slotRows, playoffs),
    built: builtDue(slotRows, playoffs),
    now,
    hours,
  });
  log(games.length ? `Playoff games within ${hours} hours with no kickoff or no site (${games.length}):` : `Playoff details: every game within ${hours} hours has its kickoff and site.`);
  for (const g of games) log(`- ${g.line}`);

  if (argv.includes("--alert")) {
    const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
    if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set for --alert");
    await postAlert({ api: github({ token, repo }), games, now, log });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Playoff details could not check: ${error.message}`);
    process.exit(1);
  });
}
