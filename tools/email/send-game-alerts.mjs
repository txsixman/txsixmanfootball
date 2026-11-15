// Sends the email game alerts (ADR 0053) to fans who opted in for the teams they follow: a kickoff, a final, and the next-round
// game once the bracket sets it. Run by .github/workflows/email-alerts.yml after every Results watch run:
//   node tools/email/send-game-alerts.mjs [--season 2026] [--baseline]
// 1. Works the season's events out from the repo's data files (events.mjs) and records the new ones in the database.
// 2. Asks the database who is due which alert (email_pending_game_alerts: opted in, following, an adult, never already sent).
// 3. Sends each through Resend (resend.mjs), then records it (email_mark_sent). Resend's idempotency key makes a retry safe.
// It connects as the database role `email_sender` (migration 0022), which can run those three functions and nothing else.
// Sends NOTHING, and says so in the run summary, unless the repo variable EMAIL_ALERTS is true and RESEND_API_KEY, EMAIL_FROM,
// EMAIL_UNSUBSCRIBE_SECRET and the database password are all set. Nothing here logs an email address, a name, an id or the
// text of any error: only counts.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_SEASON } from "../../apps/web/lib/season.ts";
import { gameEvents } from "./events.mjs";
import { buildGameAlert } from "./message.mjs";
import { idempotencyKey, sendEmail } from "./resend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** The site's own address: every link in an email starts here (lib/auth/config.ts siteOrigin). */
export const ORIGIN = "https://txsixmanfootball.com";
const KIND = "game_alerts";

/**
 * Records the events, finds who is due, sends. `db` has `query(sql, params)`; `send` is resend.mjs's sendEmail (injected so
 * tests run offline); `sleep` paces Resend's rate limit. Returns counts only.
 */
export async function runGameAlerts({ db, events, baseline = false, secret, from, apiKey, origin = ORIGIN, send = sendEmail, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), limit = 300, paceMs = 600 }) {
  const result = { events: events.length, recorded: 0, due: 0, sent: 0, rejected: 0, retry: 0, deferred: 0, stopped: false, recordFailed: 0 };
  result.recorded = (await db.query("select email_record_game_events($1::jsonb, $2::boolean) as n", [JSON.stringify(events), baseline])).rows[0].n;
  const { rows } = await db.query("select * from email_pending_game_alerts($1)", [limit]);
  result.due = rows.length;
  for (const [i, row] of rows.entries()) {
    const item = `${row.alert}:${row.event_key}`;
    const mail = buildGameAlert(row, { origin, secret });
    const r = await send({ apiKey, from, to: row.email, ...mail, key: idempotencyKey(row.user_id, KIND, item) });
    if (r.outcome === "slow" || r.outcome === "stop") {
      result.stopped = r.outcome;
      result.deferred = rows.length - i;
      break;
    }
    if (r.outcome === "retry") {
      result.retry += 1;
    } else {
      result[r.outcome] += 1;
      try {
        await db.query("select email_mark_sent($1::uuid, $2, $3, $4)", [row.user_id, KIND, item, r.outcome]);
      } catch {
        result.recordFailed += 1; // sent but not recorded: the idempotency key keeps a retry from sending twice
      }
    }
    if (i < rows.length - 1) await sleep(paceMs);
  }
  return result;
}

const summarize = (lines) => {
  const text = lines.map((l) => `- ${l}`).join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Email alerts\n${text}\n`);
};

/** What is missing, by name: the run sends nothing until every one is set. */
export function missing(env) {
  return [
    ["RESEND_API_KEY", env.RESEND_API_KEY],
    ["EMAIL_FROM (repo variable)", env.EMAIL_FROM],
    ["EMAIL_UNSUBSCRIBE_SECRET (32 characters or more)", (env.EMAIL_UNSUBSCRIBE_SECRET ?? "").trim().length >= 32 ? "ok" : ""],
    ["EMAIL_DB_PASSWORD", env.PGPASSWORD],
  ].filter(([, v]) => !v).map(([name]) => name);
}

async function main() {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const season = Number(process.argv.includes("--season") ? arg("--season") : CURRENT_SEASON);
  if (!/^\d{4}$/.test(String(season))) throw new Error("usage: send-game-alerts.mjs [--season <year>] [--baseline]");
  if (process.env.EMAIL_ALERTS !== "true") return summarize(["Email alerts are off: the repo variable EMAIL_ALERTS is not true. Nothing was sent."]);
  const gaps = missing(process.env);
  if (gaps.length) {
    console.log(`::warning::${gaps.join(", ")} not set; no email alerts were sent.`);
    return summarize([`Nothing was sent: not set yet: ${gaps.join(", ")}.`]);
  }
  const files = {
    read: (rel) => (existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), "utf8") : ""),
    list: (rel) => readdirSync(path.join(ROOT, rel)),
  };
  const { events, skipped } = gameEvents({ season, now: Date.now(), files });
  // pg is the one package this needs, and packages/db already pins it (the workflow runs npm ci there).
  const { Client } = createRequire(path.join(ROOT, "packages/db/package.json"))("pg");
  const ca = readFileSync(path.join(ROOT, "packages/db/supabase-ca.crt"), "utf8");
  const db = new Client({ ssl: { ca, rejectUnauthorized: true }, database: "postgres", port: 5432 });
  await db.connect();
  try {
    const r = await runGameAlerts({
      db, events, baseline: process.argv.includes("--baseline"), secret: process.env.EMAIL_UNSUBSCRIBE_SECRET.trim(),
      from: process.env.EMAIL_FROM, apiKey: process.env.RESEND_API_KEY,
    });
    summarize([
      `${season}: ${r.events} game event(s) found, ${r.recorded} new, ${skipped} skipped (a name the database refuses).`,
      `${r.due} email(s) due: ${r.sent} sent, ${r.rejected} refused by the email service, ${r.retry} to retry next run, ${r.deferred} waiting.`,
      ...(r.recordFailed ? [`${r.recordFailed} sent but not recorded (a retry cannot send them twice).`] : []),
      ...(r.stopped ? [`Stopped early: the email service answered "${r.stopped === "stop" ? "key or domain refused" : "slow down"}".`] : []),
    ]);
    if (r.stopped === "stop") process.exitCode = 1; // a wrong key or an unverified domain: fail the run so it is seen
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Only the error's code: a database or network message could hold an address or a host.
  main().catch((e) => {
    console.error(`Email alerts failed (${e?.code ?? e?.name ?? "error"}).`);
    process.exit(1);
  });
}
