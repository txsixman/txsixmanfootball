// Sends the weekly team digest (ADR 0055) to fans who opted in on /account. Run by .github/workflows/email-digest.yml on Monday
// mornings (Central), or by hand:
//   node tools/email/send-weekly-digest.mjs [--season 2026] [--dry-run]
// 1. Asks the database who is due this ISO week's digest (email_pending_digests: opted in, an adult, never already sent for the week).
// 2. Works out each fan's teams' last result, ranking move and next game from the repo's data (digest-data.mjs).
// 3. Sends each digest through Resend (resend.mjs) and records it for the week (email_mark_sent, the same function game alerts use).
//    A fan none of whose teams has a result or a next game gets nothing that week.
// --dry-run sends nothing and records nothing: it prints counts. It connects as the database role `email_sender` (migration 0022 and
// 0025). Sends NOTHING unless the repo variable EMAIL_DIGEST is true and the Resend key, sender and database password are set. And
// it REFUSES to send, and fails the run, while EMAIL_POSTAL_ADDRESS (the postal address in every digest's footer) is empty or unset.
// Nothing here logs an email address, a name, an id, the postal address or the text of any error: only counts.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_SEASON } from "../../apps/web/lib/season.ts";
import { centralDate, digestData, hasNews, isoWeek, sendWindowOpen } from "./digest-data.mjs";
import { buildDigest, MAX_TEAMS, postalAddress } from "./digest-message.mjs";
import { gameEvents } from "./events.mjs";
import { idempotencyKey, sendEmail } from "./resend.mjs";
import { missing, ORIGIN } from "./send-game-alerts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KIND = "weekly_digest";

/**
 * Finds who is due `week`'s digest and sends it. `data` is digestData's result, `events` the game events (for next-round games);
 * `postal` is postalAddress's result: without lines nothing is sent and every due digest is counted `refused`. `send` is
 * resend.mjs's sendEmail (injected so tests run offline); `sleep` paces Resend's rate limit. Returns counts only.
 */
export async function runWeeklyDigest({ db, data, week, postal, from, apiKey, origin = ORIGIN, dryRun = false, send = sendEmail, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), limit = 500, paceMs = 600 }) {
  const result = { due: 0, sent: 0, rejected: 0, retry: 0, deferred: 0, empty: 0, wouldSend: 0, refused: 0, stopped: false, recordFailed: 0 };
  const { rows } = await db.query("select * from email_pending_digests($1, $2)", [week, limit]);
  result.due = rows.length;
  if (!postal.lines) {
    result.refused = rows.length; // never a digest without the address: counted, not sent
    return result;
  }
  const mine = new Map(); // a team's section is the same for every fan who follows it
  const section = (slug) => mine.get(slug) ?? (mine.set(slug, data.forTeam(slug)), mine.get(slug));
  for (const [i, row] of rows.entries()) {
    const slugs = row.followed_slugs.slice(0, MAX_TEAMS);
    const teams = slugs.map(section);
    if (!hasNews(row.followed_slugs.map(section))) {
      result.empty += 1;
      continue;
    }
    if (dryRun) {
      result.wouldSend += 1;
      continue;
    }
    const mail = buildDigest({ teams, more: row.followed_slugs.length - slugs.length, token: row.unsubscribe_token, origin, postal: postal.lines });
    const r = await send({ apiKey, from, to: row.email, ...mail, key: idempotencyKey(row.user_id, KIND, week) });
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
        await db.query("select email_mark_sent($1::uuid, $2, $3, $4)", [row.user_id, KIND, week, r.outcome]);
      } catch {
        result.recordFailed += 1; // sent but not recorded: the idempotency key keeps a retry from sending twice
      }
    }
    await sleep(paceMs);
  }
  return result;
}

const summarize = (lines) => {
  const text = lines.map((l) => `- ${l}`).join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Weekly digest\n${text}\n`);
};

/** The run summary's lines, and whether the run fails: a refused key or domain, or no postal address (the digest never goes without it). */
export function report({ r, postal, dryRun, week }) {
  const lines = [
    dryRun
      ? `Dry run, ${week}: ${r.due} digest(s) due, ${r.wouldSend} would be sent, ${r.empty} with nothing to report. Nothing was sent or recorded.`
      : `${week}: ${r.due} digest(s) due: ${r.sent} sent, ${r.rejected} refused by the email service, ${r.retry} to retry next run, ${r.deferred} waiting, ${r.empty} with nothing to report.`,
    ...(r.recordFailed ? [`${r.recordFailed} sent but not recorded (a retry cannot send them twice).`] : []),
    ...(r.stopped ? [`Stopped early: the email service answered "${r.stopped === "stop" ? "key or domain refused" : "slow down"}".`] : []),
    ...(postal.lines ? [] : [`REFUSED: ${r.refused} digest(s) were not sent because the postal address (repo variable EMAIL_POSTAL_ADDRESS) is ${postal.error}.`]),
  ];
  return { lines, fail: r.stopped === "stop" || !postal.lines };
}

async function main() {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const season = Number(process.argv.includes("--season") ? arg("--season") : CURRENT_SEASON);
  if (!/^\d{4}$/.test(String(season))) throw new Error("usage: send-weekly-digest.mjs [--season <year>] [--dry-run]");
  const dryRun = process.argv.includes("--dry-run");
  if (process.env.EMAIL_DIGEST !== "true") return summarize(["The weekly digest is off: the repo variable EMAIL_DIGEST is not true. Nothing was sent."]);
  const gaps = missing(process.env);
  if (gaps.length) {
    console.log(`::warning::${gaps.join(", ")} not set; no digest was sent.`);
    return summarize([`Nothing was sent: not set yet: ${gaps.join(", ")}.`]);
  }
  const today = centralDate(Date.now());
  if (!dryRun && !sendWindowOpen(today)) return summarize(["Nothing was sent: the digest goes out Monday to Wednesday (Central), and today is outside that. Run it by hand with the dry run to see counts."]);
  const postal = postalAddress(process.env.EMAIL_POSTAL_ADDRESS);
  const files = {
    read: (rel) => (existsSync(path.join(ROOT, rel)) ? readFileSync(path.join(ROOT, rel), "utf8") : ""),
    list: (rel) => readdirSync(path.join(ROOT, rel)),
  };
  const { events } = gameEvents({ season, now: Date.now(), files });
  const data = digestData({ season, today, files, events });
  const week = isoWeek(today);
  const { Client } = createRequire(path.join(ROOT, "packages/db/package.json"))("pg");
  const ca = readFileSync(path.join(ROOT, "packages/db/supabase-ca.crt"), "utf8");
  const db = new Client({ ssl: { ca, rejectUnauthorized: true }, database: "postgres", port: 5432 });
  await db.connect();
  try {
    const r = await runWeeklyDigest({ db, data, week, postal, from: process.env.EMAIL_FROM, apiKey: process.env.RESEND_API_KEY, dryRun });
    const { lines, fail } = report({ r, postal, dryRun, week });
    summarize(lines);
    if (fail) process.exitCode = 1; // a wrong key, an unverified domain, or no postal address: fail the run so it is seen
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Only the error's code: a database or network message could hold an address or a host.
  main().catch((e) => {
    console.error(`Weekly digest failed (${e?.code ?? e?.name ?? "error"}).`);
    process.exit(1);
  });
}
