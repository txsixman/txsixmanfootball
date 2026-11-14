// Sends browser push alerts (web-push, MPL-2.0) for new finals to everyone following one of the two programs.
// Results watch runs it right after it pushes a commit of new results:
//   node tools/push/send-finals.mjs --season 2026 --before HEAD~1
// A new final is a played game in the season's games.csv or playoffs.csv that `--before` did not have with that score.
// Subscriptions come from Supabase's push_subscription table (migration 0008; PG* variables as in supabase.yml).
// Needs VAPID_PRIVATE_KEY (repo secret); without it, or without the database password, says so and sends nothing.
// A subscription the push service reports gone (404, 410) is deleted. Any other failure is counted and exits 1.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
    .map(([, r]) => ({ date: r.game_date, home: r.home, away: r.away, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }));
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

/** Sends each subscription its message; deletes the gone ones. `send` and `db` are injected so tests run offline. */
export async function sendAll({ db, send, finals }) {
  const programs = [...new Set(finals.flatMap((f) => [slugify(f.home), slugify(f.away)]))];
  const result = { finals: finals.length, subscriptions: 0, sent: 0, removed: 0, skipped: 0, failed: [] };
  if (!programs.length) return result;
  const { rows } = await db.query("select endpoint, p256dh, auth, programs from push_subscription where programs && $1::text[]", [programs]);
  result.subscriptions = rows.length;
  for (const s of rows) {
    const msg = message(finals, s.programs);
    if (!msg || !allowedEndpoint(s.endpoint)) {
      result.skipped += 1;
      continue;
    }
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg));
      result.sent += 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.query("delete from push_subscription where endpoint = $1", [s.endpoint]);
        result.removed += 1;
      } else {
        result.failed.push(`${new URL(s.endpoint).hostname}: ${e.statusCode ?? e.message}`);
      }
    }
  }
  return result;
}

const fileAt = (rev, file) => {
  try {
    return execFileSync("git", ["-C", ROOT, "show", `${rev}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ""; // the file is new in this commit
  }
};

async function main() {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const season = arg("--season");
  const before = arg("--before");
  if (!/^\d{4}$/.test(season ?? "") || !before) throw new Error("usage: send-finals.mjs --season <year> --before <git rev>");
  const finals = ["games.csv", "playoffs.csv"].flatMap((name) => {
    const file = `data/seed/maxpreps-${season}/${name}`;
    const now = existsSync(path.join(ROOT, file)) ? readFileSync(path.join(ROOT, file), "utf8") : "";
    return newFinals(fileAt(before, file), now);
  });
  console.log(`${finals.length} new final(s) in ${season}.`);
  if (!finals.length) return;
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.PGPASSWORD) {
    console.log("::warning::VAPID_PRIVATE_KEY or SUPABASE_DB_PASSWORD is not set; no push alerts were sent.");
    return;
  }
  const webpush = await import("web-push");
  const { default: pg } = await import("pg");
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const ca = readFileSync(path.join(ROOT, "packages/db/supabase-ca.crt"), "utf8");
  const db = new pg.Client({ ssl: { ca, rejectUnauthorized: true }, database: "postgres", port: 5432 });
  await db.connect();
  try {
    const r = await sendAll({ db, finals, send: (sub, body) => webpush.sendNotification(sub, body, { TTL: 6 * 60 * 60, urgency: "normal" }) });
    console.log(`Push alerts: ${r.subscriptions} following, ${r.sent} sent, ${r.removed} gone and deleted, ${r.skipped} skipped, ${r.failed.length} failed.`);
    if (r.failed.length) {
      console.error(r.failed.join("\n"));
      process.exitCode = 1;
    }
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
