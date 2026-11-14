// Writes the games under way into the hosted database (migration 0016, ADR 0021). Results watch runs it after each game-day
// read, with the file the reader wrote (`maxpreps.mjs --tonight --live-out <file>`):
//
//   PGHOST=… PGUSER=… PGPASSWORD=… PGSSLROOTCERT=packages/db/supabase-ca.crt node packages/db/live.mjs <file>
//
// In ONE transaction: every row in the file is upserted (keeping when its score last changed, migration 0020), every row NOT in the file is deleted (a game that went final or
// vanished stops being live), and any row read more than 6 hours ago is deleted. An empty file clears the table. A bad row
// rejects the whole file before anything is written. Nothing here touches the repo, so a live update never rebuilds the site.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adapt } from "./load.mjs";

export const MAX_AGE_HOURS = 6;
const MAX_ROWS = 200;
const KEYS = ["game_key", "home", "away", "home_score", "away_score", "period", "finished", "late", "read_at"];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^(\d{4}-\d{2}-\d{2})\|([a-z0-9]+(?:-[a-z0-9]+)*)\|([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The rows of a live file, checked and normalized (read_at as ISO text), or an Error naming the first bad row. The same
 * rules as the table's checks, so a bad row fails here with a clear message rather than inside the transaction. */
export function validateLiveRows(rows) {
  if (!Array.isArray(rows)) throw new Error("the live file is not a list");
  if (rows.length > MAX_ROWS) throw new Error(`the live file has ${rows.length} rows (the most is ${MAX_ROWS})`);
  const seen = new Set();
  return rows.map((r, i) => {
    const bad = (why) => new Error(`live row ${i}: ${why}`);
    if (r === null || typeof r !== "object" || Array.isArray(r)) throw bad("not an object");
    const extra = Object.keys(r).filter((k) => !KEYS.includes(k));
    if (extra.length) throw bad(`unexpected field ${extra.join(", ")}`);
    const key = KEY.exec(typeof r.game_key === "string" && r.game_key.length <= 200 ? r.game_key : "");
    if (!key) throw bad("game_key is not date|slug|slug");
    for (const f of ["home", "away"]) if (typeof r[f] !== "string" || r[f].length > 80 || !SLUG.test(r[f])) throw bad(`${f} is not a slug`);
    if ([key[2], key[3]].sort().join("|") !== [r.home, r.away].sort().join("|")) throw bad("game_key does not match home and away");
    for (const f of ["home_score", "away_score"]) if (!Number.isInteger(r[f]) || r[f] < 0 || r[f] > 200) throw bad(`${f} is not a whole number from 0 to 200`);
    const period = r.period ?? null;
    if (period !== null && (typeof period !== "string" || period.length < 1 || period.length > 12 || /[<>&"]/.test(period))) throw bad("period is not short plain text");
    // A game the read saw finished (migration 0019): absent means under way.
    if (r.finished !== undefined && typeof r.finished !== "boolean") throw bad("finished is not true or false");
    // The read saw the game in the fourth quarter or later (migration 0020, ADR 0043): absent means not.
    if (r.late !== undefined && typeof r.late !== "boolean") throw bad("late is not true or false");
    const at = typeof r.read_at === "string" ? new Date(r.read_at) : null;
    if (!at || Number.isNaN(at.getTime())) throw bad("read_at is not a date and time");
    if (seen.has(r.game_key)) throw bad("game_key listed twice");
    seen.add(r.game_key);
    return { game_key: r.game_key, home: r.home, away: r.away, home_score: r.home_score, away_score: r.away_score, period, finished: r.finished === true, late: r.late === true, read_at: at.toISOString() };
  });
}

/** Rows a delete removed: node-postgres says rowCount, PGlite affectedRows. */
const count = (result) => result.rowCount ?? result.affectedRows ?? 0;

/** Replaces the table's rows with `rows` (already validated), in one transaction. Returns the counts. */
export async function writeLive(db, rows) {
  return db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.query(
        // score_changed_at (migration 0020, ADR 0043): this read's time when the row is new or either team's score
        // differs from the stored row (compared team by team, so a row whose home and away swapped is not a change);
        // otherwise the stored time is kept, so "unchanged for an hour" carries across runs.
        `insert into live_score (game_key, home, away, home_score, away_score, period, finished, late, read_at, score_changed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         on conflict (game_key) do update
           set home = excluded.home, away = excluded.away, home_score = excluded.home_score,
               away_score = excluded.away_score, period = excluded.period, finished = excluded.finished,
               late = excluded.late, read_at = excluded.read_at,
               score_changed_at = case
                 when live_score.score_changed_at is not null
                  and ((live_score.home = excluded.home
                        and live_score.home_score = excluded.home_score and live_score.away_score = excluded.away_score)
                    or (live_score.home = excluded.away
                        and live_score.home_score = excluded.away_score and live_score.away_score = excluded.home_score))
                 then live_score.score_changed_at
                 else excluded.read_at
               end`,
        [r.game_key, r.home, r.away, r.home_score, r.away_score, r.period, r.finished === true, r.late === true, r.read_at],
      );
    }
    const gone = await tx.query("delete from live_score where not (game_key = any($1::text[]))", [rows.map((r) => r.game_key)]);
    const stale = await tx.query(`delete from live_score where read_at < now() - interval '${MAX_AGE_HOURS} hours'`);
    return { written: rows.length, removedNotLive: count(gone), removedStale: count(stale) };
  });
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node packages/db/live.mjs <live.json>");
  for (const name of ["PGHOST", "PGUSER", "PGPASSWORD"]) if (!process.env[name]) throw new Error(`${name} is not set`);
  const rows = validateLiveRows(JSON.parse(readFileSync(file, "utf8")));
  const { default: pg } = await import("pg");
  const ssl = process.env.PGSSLROOTCERT ? { ca: readFileSync(process.env.PGSSLROOTCERT, "utf8") } : true;
  const client = new pg.Client({ database: process.env.PGDATABASE || "postgres", ssl });
  await client.connect();
  try {
    console.log(JSON.stringify(await writeLive(adapt(client), rows)));
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
