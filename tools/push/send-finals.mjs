// Sends browser push alerts (web-push, MPL-2.0) for new finals to everyone following one of the two programs.
// Results watch runs it right after it pushes a commit of new results:
//   node tools/push/send-finals.mjs --season 2026 --before HEAD~1
// A new final is a played game in the season's games.csv or playoffs.csv that `--before` did not have with that score.
// Subscriptions come from Supabase's push_subscription table (migration 0008; PG* variables as in supabase.yml). A browser
// linked to a fan's account (migration 0023, ADR 0054) is alerted for the account's follows (table `follow`, migration 0012) as
// well as its own programs; an unlinked one only for its own, as before. One row a browser, so one alert a browser. A program a
// browser has muted (push_subscription.muted, migration 0026, ADR 0058) gets no alert on that browser, whoever follows it.
// Needs VAPID_PRIVATE_KEY (repo secret); without it, or without the database password, says so and sends nothing.
// A subscription the push service reports gone (404, 410) is deleted. Any other failure is counted and exits 1.
//
// Game alerts (ADR 0082, migration 0031), dark until the owner opens the `push_alerts` switch (`update site_switch set is_on =
// true where name = 'push_alerts'`; a missing table or row reads as off):
//   switch off  finals only, worded as ever ("Gordon 0, Strawn 45", the program page), no kickoff, no pairing;
//   switch on   "Final: Strawn 45, Gordon 0" with the game page, "X v Y has started" when a game first shows in the night read's
//               live file, and "Next round: X v Y" for each playoff game a bracket has set and nobody has played yet.
// Either way every event is claimed once in push_sent before it is sent, so it goes out at most once (a missing push_sent, SQL
// state 42P01, sends without that memory and says so). Rows older than 90 days are deleted at the end of a run.
// Modes:  --season Y --before REV   finals since REV (and the pairings, when the switch is on)
//         --season Y --live FILE    kickoffs from the live file the night read wrote (only when the switch is on)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** The site's public VAPID key (apps/web/lib/push.ts holds the same value). The private half is a secret. */
export const VAPID_PUBLIC_KEY = "BIYcYxqLhhCfvjinOizccPGyBIaaIZBCZoeaRwJ9dHWXa5lRz6IXFnEUErvbb40xntsAtCPvE6R0a8zZ0_YRX_Q";
const SUBJECT = "https://txsixmanfootballcom.vercel.app";
/** The only hosts a push may go to (the same list as migration 0008's check). */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

/** Twin of apps/web/lib/slug.ts and packages/db/seed.mjs. */
export const slugify = (name) => name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Played games in a games.csv or playoffs.csv text, keyed by date and both teams. */
export function playedGames(csv) {
  if (!csv.trim()) return new Map();
  const [header, ...lines] = csv.trim().split("\n");
  const cols = header.split(",");
  const games = new Map();
  for (const line of lines) {
    const r = Object.fromEntries(cols.map((c, i) => [c, (line.split(",")[i] ?? "").trim()]));
    if (r.home_score === "" || r.away_score === "") continue;
    games.set([r.game_date, ...[r.home, r.away].sort()].join("|"), r);
  }
  return games;
}

/** Finals in `after` that `before` lacked, or had with another score. */
export function newFinals(before, after) {
  const was = playedGames(before);
  return [...playedGames(after).entries()]
    .filter(([key, r]) => {
      const old = was.get(key);
      return !old || old.home_score !== r.home_score || old.away_score !== r.away_score;
    })
    .map(([, r]) => ({
      date: r.game_date, home: r.home, away: r.away, homeScore: Number(r.home_score), awayScore: Number(r.away_score),
      // A playoffs.csv row names its round; games.csv says "season" (the game page tells the two apart, ADR 0079).
      ...(r.round && r.round !== "season" ? { round: r.round } : {}),
    }));
}

/** One alert a subscription: its programs' new finals, each as its score (a final is confirmed, ADR 0040). */
export function message(finals, followed) {
  const mine = finals.filter((f) => followed.includes(slugify(f.home)) || followed.includes(slugify(f.away)));
  if (!mine.length) return null;
  const line = (f) => `${f.away} ${f.awayScore}, ${f.home} ${f.homeScore}`;
  const first = mine[0];
  const slug = followed.includes(slugify(first.home)) ? slugify(first.home) : slugify(first.away);
  return mine.length === 1
    ? { title: line(first), body: "Final score. Tap for the program page.", url: `/programs/${slug}` }
    : { title: `${mine.length} new finals`, body: mine.slice(0, 4).map(line).join("\n"), url: "/results" };
}

export const allowedEndpoint = (endpoint) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
};

/**
 * The subscriptions that follow one of `$1`'s programs, with the programs each is alerted for: its own list joined with the
 * account's follows when it is linked (user_id), each program once, and the programs the browser has muted (migration 0026) kept
 * apart in `muted`, which sendAll takes out. The primary key is the endpoint, so a browser is one row however many of its programs
 * were played, and a browser that follows a program both ways still gets one alert.
 */
export const SUBSCRIPTIONS_SQL = `
  select s.endpoint, s.p256dh, s.auth, s.muted,
         array(select distinct p from unnest(s.programs || coalesce((select array_agg(f.program_slug) from follow f where f.user_id = s.user_id), '{}'::text[])) p order by p) as programs
    from push_subscription s
   where s.programs && $1::text[]
      or exists (select 1 from follow f where f.user_id = s.user_id and f.program_slug = any($1::text[]))`;

/** Before migration 0026 is on the database (no `muted` column, SQL state 42703): the same, with no mutes to honour. */
const WITHOUT_MUTES_SQL = SUBSCRIPTIONS_SQL.replace("s.p256dh, s.auth, s.muted,", "s.p256dh, s.auth,");

/** Before migration 0023 is on the database (the column is missing, SQL state 42703): each browser by its own programs, as ever. */
const OWN_PROGRAMS_SQL = "select endpoint, p256dh, auth, programs from push_subscription where programs && $1::text[]";

/** How long the push service may hold an alert for a browser that is offline: a kickoff is stale in an hour, the rest in six. */
const TTL = { kickoff: 60 * 60, final: 6 * 60 * 60, pairing: 6 * 60 * 60 };

const sameTeams = (a, b) => [a, b].sort().join("|");
const sentTag = (tag) => tag.toLowerCase().replace(/[^a-z0-9:|._-]/g, "").slice(0, 120);

/** "whiteface-high-school" -> "Whiteface High School": the name when no file gives the team's own. */
const titleCaseSlug = (slug) => slug.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

/** A round as the site words it (apps/web/lib/brackets.ts roundLabel): the last round of any league is the State Championship. */
export function roundLabel(round) {
  if (round === "state" || round === "final") return "State Championship";
  const n = /^round-(\d+)$/.exec(round);
  if (n) return `Round ${n[1]}`;
  return round ? round[0].toUpperCase() + round.slice(1) : "";
}

/** "TAIAO Division 1", "UIL Division I", "TAPPS Division II Large School"; a division with no number or numeral stands as its own name. */
const divisionLabel = (league, division) => (/^(\d+|[IV]+)(\s|$)/.test(division) ? `${league} Division ${division}` : `${league} ${division}`.trim());

/** "2026-11-20" -> "Fri, Nov 20" (a calendar date has no zone: noon UTC keeps the day whatever the runner's clock). */
const shortDate = (date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));

/** Every row of a plain-comma CSV text as an object by its header; blank text has none. */
function csvRows(text) {
  if (!text.trim()) return [];
  const [header, ...lines] = text.trim().split("\n");
  const cols = header.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? "").trim()]));
  });
}

/**
 * What the alert wording needs besides the games themselves, from the season's published files:
 *   names     team slug -> display name: the first CSV to give a team wins (games, playoffs, then the alignments);
 *   rows      every playoffs.csv row as { round, date, key (both slugs sorted), played }, to tell a game's round and which
 *             pairings are already played;
 *   pairings  the bracket-set games (bracket-due.mjs pagePairings: { league, division, round, home, away }), in bracket order.
 */
export function buildContext({ season, playoffs = "", texts = [], pairings = [] }) {
  const names = new Map();
  for (const text of [playoffs, ...texts]) {
    for (const r of csvRows(text)) {
      for (const col of ["home", "away", "school", "a", "b"]) {
        const name = r[col];
        if (name && name !== "bye" && !name.startsWith("winner:") && !names.has(slugify(name))) names.set(slugify(name), name);
      }
    }
  }
  for (const p of pairings) for (const name of [p.home, p.away]) if (!names.has(slugify(name))) names.set(slugify(name), name);
  const rows = csvRows(playoffs).map((r) => ({
    round: r.round, date: r.game_date, key: sameTeams(slugify(r.home), slugify(r.away)), played: r.home_score !== "" && r.away_score !== "",
  }));
  return { season, names, rows, pairings };
}

const nameOf = (ctx, slug) => ctx.names?.get(slug) ?? titleCaseSlug(slug);

/** The playoff round a game belongs to, or undefined for a regular-season game: by its date in playoffs.csv, else the one still-unplayed pairing of those two teams. */
function roundFor(ctx, date, a, b) {
  const key = sameTeams(a, b);
  const hits = (ctx.rows ?? []).filter((r) => r.key === key);
  const hit = hits.find((r) => r.date === date) ?? hits.find((r) => !r.date && !r.played);
  if (hit) return hit.round;
  const played = (round) => (ctx.rows ?? []).some((r) => r.played && r.round === round && r.key === key);
  return (ctx.pairings ?? []).find((p) => sameTeams(slugify(p.home), slugify(p.away)) === key && !played(p.round))?.round;
}

/**
 * A game's page address (apps/web/lib/page-id.ts, season-results.ts). A playoff game of the season takes
 * `/scores/<season>-<round>-<away>-at-<home>`, in the bracket's own order when a bracket sets it (found by round and the two
 * teams), else its listing's order; any other game is `/scores/<date>-<away>-at-<home>`. Slugs in, away first.
 */
export function gameUrl(ctx, { date, away, home, round }) {
  const r = round ?? roundFor(ctx, date, away, home);
  if (!r) return `/scores/${date}-${away}-at-${home}`;
  const set = (ctx.pairings ?? []).find((p) => p.round === r && sameTeams(slugify(p.home), slugify(p.away)) === sameTeams(away, home));
  const [a, h] = set ? [slugify(set.away), slugify(set.home)] : [away, home];
  return `/scores/${ctx.season}-${r}-${a}-at-${h}`;
}

const dateKeyOf = (date, a, b) => `${date}|${[a, b].sort().join("|")}`;

/** The final as an event: "Final: Strawn 45, Gordon 0" (winner first; a tie away first), the game page, replacing the kickoff on the device. */
export function finalEvent(f, ctx = {}) {
  const [home, away] = [slugify(f.home), slugify(f.away)];
  const [w, l] = f.homeScore > f.awayScore ? [[f.home, f.homeScore], [f.away, f.awayScore]] : [[f.away, f.awayScore], [f.home, f.homeScore]];
  return {
    kind: "final", key: `final|${dateKeyOf(f.date, home, away)}|${f.awayScore}-${f.homeScore}`, teams: [home, away], final: f,
    title: `Final: ${w[0]} ${w[1]}, ${l[0]} ${l[1]}`, body: "Tap for the game page.",
    url: gameUrl(ctx, { date: f.date, away, home, round: f.round }), tag: sentTag(`game:${dateKeyOf(f.date, home, away)}`),
  };
}

/** A game that is under way (a row of the night read's live file, not `finished`) as a kickoff event, away v home; finished rows are no kickoff. */
export function kickoffEvents(rows, ctx = {}) {
  return rows.filter((r) => r.finished !== true).map((r) => {
    const date = r.game_key.split("|")[0];
    return {
      kind: "kickoff", key: `kickoff|${dateKeyOf(date, r.home, r.away)}`, teams: [r.home, r.away],
      title: `${nameOf(ctx, r.away)} v ${nameOf(ctx, r.home)} has started`, body: "Tap for the live score.",
      url: gameUrl(ctx, { date, away: r.away, home: r.home }), tag: sentTag(`game:${dateKeyOf(date, r.home, r.away)}`),
    };
  });
}

/** The next-round alerts: each pairing a bracket has set, not yet played (no scored playoffs.csv row of that round with those two teams), away v home in bracket order. */
export function pairingEvents(pairings, ctx = {}) {
  return pairings.flatMap((p) => {
    const [home, away] = [slugify(p.home), slugify(p.away)];
    const key = sameTeams(home, away);
    const mine = (ctx.rows ?? []).filter((r) => r.round === p.round && r.key === key);
    if (mine.some((r) => r.played)) return [];
    const date = mine.find((r) => r.date)?.date;
    const [a, b] = [home, away].sort();
    return [{
      kind: "pairing", key: `pairing|${ctx.season}|${p.league}|${p.division}|${p.round}|${a}|${b}`, teams: [home, away],
      title: `Next round: ${p.away} v ${p.home}`,
      body: [divisionLabel(p.league, p.division), roundLabel(p.round), ...(date ? [shortDate(date)] : [])].join(" · "),
      url: `/scores/${ctx.season}-${p.round}-${away}-at-${home}`, tag: sentTag(`pairing:${ctx.season}|${p.round}|${a}|${b}`),
    }];
  });
}

/** The old final alert, kept for the switch off: its own key and nothing else changes (message() words it). */
const legacyFinalEvent = (f) => {
  const [home, away] = [slugify(f.home), slugify(f.away)];
  return { kind: "final", key: `final|${dateKeyOf(f.date, home, away)}|${f.awayScore}-${f.homeScore}`, teams: [home, away], final: f };
};

/** The push_alerts switch (migration 0031, site_switch): on only when its row says so; a missing table or row is off. */
export async function alertsOn(db) {
  try {
    const { rows } = await db.query("select is_on from site_switch where name = 'push_alerts'");
    return rows[0]?.is_on === true;
  } catch (e) {
    if (e.code === "42P01") return false;
    throw e;
  }
}

/** Claims each event in push_sent: the keys this run is first to take. A missing push_sent (42P01) claims everything and says so on `result`. */
async function claimEvents(db, events, result) {
  const claimed = new Set();
  for (const e of events) {
    try {
      const { rows } = await db.query("insert into push_sent (event_key, kind) values ($1, $2) on conflict do nothing returning event_key", [e.key, e.kind]);
      if (rows.length) claimed.add(e.key);
    } catch (err) {
      if (err.code !== "42P01") throw err;
      result.dedupeSkipped = true;
      return new Set(events.map((x) => x.key));
    }
  }
  return claimed;
}

/** Deletes the sent-log rows older than 90 days (a missing table is nothing to prune); returns how many went. */
export async function pruneSent(db) {
  try {
    const r = await db.query("delete from push_sent where sent_at < now() - interval '90 days'");
    return r.rowCount ?? r.affectedRows ?? 0;
  } catch (e) {
    if (e.code === "42P01") return 0;
    throw e;
  }
}

/**
 * Sends each subscription its alerts; deletes the gone ones. `send(subscription, body, { ttl })` and `db` are injected so tests
 * run offline. Switch off (`alerts` false, or read from the database when not given): only `finals`, worded as ever, one alert a
 * browser. Switch on: `finals`, `kickoffs` (live-file rows) and `pairings` (pagePairings rows), one alert an event, each with its
 * game page and tag. `ctx`: buildContext's result (names, playoff rows, bracket-set games) for the wording and the addresses.
 * Every event is claimed in push_sent first, and only when some browser would get it, so none is sent twice.
 */
export async function sendAll({ db, send, finals = [], kickoffs = [], pairings = [], ctx = {}, alerts }) {
  const on = alerts ?? (await alertsOn(db));
  const lookup = { ...ctx, pairings: ctx.pairings ?? pairings };
  const events = [
    ...new Map(
      (on ? [...finals.map((f) => finalEvent(f, lookup)), ...kickoffEvents(kickoffs, lookup), ...pairingEvents(pairings, lookup)] : finals.map(legacyFinalEvent)).map((e) => [e.key, e]),
    ).values(),
  ];
  const result = { finals: finals.length, subscriptions: 0, sent: 0, removed: 0, skipped: 0, failed: [] };
  if (on) Object.assign(result, { kickoffs: events.filter((e) => e.kind === "kickoff").length, pairings: events.filter((e) => e.kind === "pairing").length });
  const programs = [...new Set(events.flatMap((e) => e.teams))];
  if (!programs.length) return result;
  let rows;
  try {
    ({ rows } = await db.query(SUBSCRIPTIONS_SQL, [programs]));
  } catch (e) {
    // Alerts must not stop because this run came before a migration did: send without mutes (0026 missing), and if the account
    // links are missing too (0023), by each browser's own programs; and say so.
    if (e.code !== "42703") throw e;
    result.mutesSkipped = true;
    try {
      ({ rows } = await db.query(WITHOUT_MUTES_SQL, [programs]));
    } catch (e2) {
      if (e2.code !== "42703") throw e2;
      ({ rows } = await db.query(OWN_PROGRAMS_SQL, [programs]));
      result.accountLinksSkipped = true;
    }
  }
  result.subscriptions = rows.length;
  // What each browser would get: the events of its programs, a muted program (migration 0026) kept out (the account still follows
  // it, and its other browsers still alert), and nothing at all for an address that is not a push service's.
  const targets = rows.map((s) => {
    const muted = new Set(s.muted ?? []);
    const followed = s.programs.filter((p) => !muted.has(p));
    return { s, followed, mine: allowedEndpoint(s.endpoint) ? events.filter((e) => e.teams.some((t) => followed.includes(t))) : [] };
  });
  const wanted = new Set(targets.flatMap((t) => t.mine.map((e) => e.key)));
  const claimed = await claimEvents(db, events.filter((e) => wanted.has(e.key)), result);
  if (wanted.size > claimed.size) result.duplicates = wanted.size - claimed.size;
  for (const { s, followed, mine } of targets) {
    const evs = mine.filter((e) => claimed.has(e.key));
    if (!evs.length) {
      result.skipped += 1;
      continue;
    }
    // Switch off: the one old alert for all of this browser's finals. On: one alert an event.
    const outgoing = on
      ? evs.map((e) => ({ body: { title: e.title, body: e.body, url: e.url, tag: e.tag }, ttl: TTL[e.kind] }))
      : [{ body: message(evs.map((e) => e.final), followed), ttl: TTL.final }];
    const host = new URL(s.endpoint).hostname;
    for (const o of outgoing) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(o.body), { ttl: o.ttl });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          // Gone: delete it. A database error here is counted and the run goes on: the events are already claimed, so stopping
          // would cost every browser after this one its alerts for good. The row goes on the next run that reaches it.
          if (await bookkeep(db, "delete from push_subscription where endpoint = $1", [s.endpoint], `${host}: gone, not deleted`, result)) result.removed += 1;
          break; // gone: nothing more to send it
        }
        result.failed.push(`${host}: ${e.statusCode ?? e.message}`);
        continue;
      }
      result.sent += 1;
      // The push service took it: this browser is real, and push_follow's full-table eviction (migration 0018) leaves it alone.
      await bookkeep(db, "update push_subscription set confirmed_at = now() where endpoint = $1 and confirmed_at is null", [s.endpoint], `${host}: sent, not marked confirmed`, result);
    }
  }
  return result;
}

/** One cleanup query after a send; true when it ran. It never throws: a failure goes in `result.failed` (the run then exits 1) with the database's code only. */
async function bookkeep(db, sql, params, what, result) {
  try {
    await db.query(sql, params);
    return true;
  } catch (e) {
    result.failed.push(`${what} (database ${e.code ?? "error"})`);
    return false;
  }
}

const fileAt = (rev, file) => {
  try {
    return execFileSync("git", ["-C", ROOT, "show", `${rev}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ""; // the file is new in this commit
  }
};

const textOf = (file) => (existsSync(path.join(ROOT, file)) ? readFileSync(path.join(ROOT, file), "utf8") : "");

/** The bracket-set games of the season now (bracket-due.mjs, the pages' own rule), or none with a warning: alerts must never stop on this. */
async function currentPairings(season, playoffs) {
  try {
    const { pagePairings, seasonSlotRows } = await import("../league-watch/bracket-due.mjs");
    const { parseCsv } = await import("../league-watch/store.mjs");
    const rows = playoffs.trim() ? parseCsv(playoffs, "playoffs.csv").rows : [];
    return pagePairings(seasonSlotRows(path.join(ROOT, "data/seed"), season), rows, { corrections: textOf("data/corrections/games.csv") });
  } catch (e) {
    console.log(`::warning::The bracket-set games could not be worked out (${e.message}); no next-round alerts, and game pages use each game's listing order.`);
    return [];
  }
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const season = arg("--season");
  const before = arg("--before");
  const liveFile = arg("--live");
  if (!/^\d{4}$/.test(season ?? "") || !before === !liveFile) throw new Error("usage: send-finals.mjs --season <year> (--before <git rev> | --live <live file>)");
  const games = textOf(`data/seed/maxpreps-${season}/games.csv`);
  const playoffs = textOf(`data/seed/maxpreps-${season}/playoffs.csv`);
  const finals = before
    ? [["games.csv", games], ["playoffs.csv", playoffs]].flatMap(([name, now]) => newFinals(fileAt(before, `data/seed/maxpreps-${season}/${name}`), now))
    : [];
  const liveRows = liveFile ? JSON.parse(readFileSync(liveFile, "utf8")) : [];
  if (liveFile && !Array.isArray(liveRows)) throw new Error("the live file is not a list");
  console.log(before ? `${finals.length} new final(s) in ${season}.` : `${liveRows.length} game(s) in the live file for ${season}.`);
  if (liveFile && !liveRows.length) return; // nothing under way: nothing to alert, no need to ask the database
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.PGPASSWORD) {
    if (finals.length || liveRows.length) console.log("::warning::VAPID_PRIVATE_KEY or SUPABASE_DB_PASSWORD is not set; no push alerts were sent.");
    return;
  }
  const { default: pg } = await import("pg");
  const ca = readFileSync(path.join(ROOT, "packages/db/supabase-ca.crt"), "utf8");
  const db = new pg.Client({ ssl: { ca, rejectUnauthorized: true }, database: "postgres", port: 5432 });
  await db.connect();
  try {
    const alerts = await alertsOn(db);
    if (liveFile && !alerts) {
      console.log("Game alerts are off (the push_alerts switch); no kickoff alerts.");
      return;
    }
    let ctx = {};
    let pairings = [];
    if (alerts) {
      const set = await currentPairings(season, playoffs);
      const alignments = readdirSync(path.join(ROOT, "data/seed")).flatMap((d) => (existsSync(path.join(ROOT, "data/seed", d, "alignments.csv")) ? [textOf(`data/seed/${d}/alignments.csv`)] : []));
      ctx = buildContext({ season, playoffs, texts: [games, ...alignments], pairings: set });
      if (before) pairings = set;
    }
    let webpush;
    const send = async (sub, body, { ttl }) => {
      if (!webpush) {
        webpush = await import("web-push");
        webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      }
      return webpush.sendNotification(sub, body, { TTL: ttl, urgency: "normal" });
    };
    const r = await sendAll({ db, send, finals, kickoffs: liveRows, pairings, ctx, alerts });
    if (r.accountLinksSkipped) console.log("::warning::push_subscription.user_id (migration 0023) is not on the database yet; alerts went by each browser's own programs only.");
    if (r.mutesSkipped) console.log("::warning::push_subscription.muted (migration 0026) is not on the database yet; per-team mutes were not applied.");
    if (r.dedupeSkipped) console.log("::warning::push_sent (migration 0031) is not on the database yet; alerts were sent with no record of what was sent before, so a repeat run could repeat them.");
    const extra = alerts ? `, ${r.kickoffs} kickoff(s) and ${r.pairings} pairing(s) in play` : "";
    console.log(`Push alerts: ${r.subscriptions} following, ${r.sent} sent, ${r.removed} gone and deleted, ${r.skipped} skipped, ${r.duplicates ?? 0} already sent, ${r.failed.length} failed${extra}.`);
    if (r.failed.length) {
      console.error(r.failed.join("\n"));
      process.exitCode = 1;
    }
    const pruned = await pruneSent(db);
    if (pruned) console.log(`Sent-log: ${pruned} row(s) older than 90 days deleted.`);
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
