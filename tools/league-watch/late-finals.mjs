// Late finals and missing finals (ADR 0046). Run by the Results watch after its morning read (and on a dispatch that is
// not a game-day read), before the commit step:
//   node tools/league-watch/late-finals.mjs <store dir: private/maxpreps-<season>> [--season <year>] [--second] [--missing <file>]
// 1. A bracket game whose Central game night is over (from 6:00 AM Central the next morning, 12 hours past a 6:00 PM
//    night; maxpreps.mjs gameNight) and that MaxPreps has still not scored takes its final from TAIAO's own bracket
//    (taiao.mjs readBrackets, for a TAIAO game) or the second source (davecampbells.mjs, with --second, for a game with a
//    mapped team). Both: they must agree, else nothing is filled. Never a forfeit (ADR 0034): a game whose bracket text
//    says forfeit, or whose score is 1-0 or 2-0, waits for MaxPreps or a hand capture; so does a 0-0. TAIAO's date must be
//    the stored row's date.
//    The fill goes through the store's own merge (store.mjs mergeStored), so it is an ordinary stored row: a later MaxPreps
//    read can only propose a different score, which applies after two reads (ADR 0031).
// 2. A blank late TAIAO game that TAIAO's bracket dates later (the game moved) is moved to that date in playoffs.csv, and
//    the move is kept in moved-games.csv (store.mjs), which every later read applies, so the reader's old date never
//    puts it back. It then counts by its new date: a game of tonight is due tonight, not missing.
// 3. A bracket game of a night that is over and still has no score after that is missing. Missing games are named in the run summary and in <file> (--missing), and raise the
//    ops reason "missing-finals" (ADR 0028), never on a page. A failed source read is counted and never stops the check.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, finalOf, footballSeasons, liveAndUpcoming, matchGames, ORIGIN, raise, teamId, teamMaps } from "./davecampbells.mjs";
import { gameNight, slugify } from "./maxpreps.mjs";
import { mergeStored, MOVES_FILE, movesCsv, parseCsv, PENDING_FILE, pendingCsv, readPending, rowKey } from "./store.mjs";
import { PAGE as TAIAO_PAGE, readBrackets } from "./taiao.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Where a filled row came from, in the store's notes (publish.mjs drops notes and source_url: no page names a source). */
export const NOTE = { taiao: "late final from the league bracket (ADR 0046)", second: "late final from the second source (ADR 0046)", both: "late final from the league bracket and the second source (ADR 0046)" };

const scored = (r) => r.home_score !== "" && r.away_score !== "";
const stopped = (r) => /postpon|cancel/i.test(r.end_reason ?? "");

/** Bracket rows with no score whose game night is over at `now` (a postponed or cancelled one is not owed). */
export const lateRows = (rows, now) => rows.filter((r) => !scored(r) && !stopped(r) && r.game_date < gameNight(now));

/** A score that may be a forfeit's recorded 1-0 or 2-0, or a 0-0 placeholder: never filled from these sources. */
const forfeitLike = (a, b) => (a === 0 && b === 0) || (Math.min(a, b) === 0 && [1, 2].includes(Math.max(a, b)));

/**
 * TAIAO's bracket game for a stored row: the same two teams by name. `final`: its score in the row's home and away
 * order, when both scores are in, the date is the row's, and it is not forfeit-like; `date`: TAIAO's own date for it.
 */
export function taiaoFor(row, games) {
  const want = [slugify(row.home), slugify(row.away)].sort().join("|");
  const g = games.find((x) => x.teams.length === 2 && x.teams.map((t) => slugify(t.name)).sort().join("|") === want);
  if (!g) return null;
  const score = (name) => g.teams.find((t) => slugify(t.name) === slugify(name))?.score ?? null;
  const [home, away] = [score(row.home), score(row.away)];
  const final = home !== null && away !== null && g.date === row.game_date && !g.forfeit && !forfeitLike(home, away) ? { home, away } : null;
  return { date: g.date, final };
}

/**
 * What each late row gets: `fill` (scores in its own order, and where from) when one source has a final, or both agree;
 * `disagree` when both have one and they differ; else nothing. `taiao` and `second` map rowKey to each source's final.
 */
export function planLate(rows, { taiao = new Map(), second = new Map() }) {
  const fill = [];
  const disagree = [];
  for (const r of rows) {
    const t = taiao.get(rowKey(r));
    const s = second.get(rowKey(r));
    if (t && s) {
      if (t.home === s.home && t.away === s.away) fill.push({ row: r, ...t, from: "both" });
      else disagree.push(r);
    } else if (t) fill.push({ row: r, ...t, from: "taiao" });
    else if (s) fill.push({ row: r, ...s, from: "second" });
  }
  return { fill, disagree };
}

/**
 * The planned fills written through the store's merge into the stored playoffs.csv (every one must come back filled)
 * and games.csv, which holds every played game, playoff games too, as round "season" (each must come back added, filled
 * or the same). Nothing else may change; else it throws and nothing is written. `games`: the stored games.csv text.
 */
export function fillStore({ stored, games = "", fill, pending, now, sourceUrl = () => TAIAO_PAGE }) {
  const csvOf = (text, file, rows, fallback) => {
    const { header, cols } = parseCsv(text, file);
    const h = header || fallback;
    return [h, ...rows.map((r) => (cols.length ? cols : h.split(",")).map((c) => r[c] ?? "").join(","))].join("\n") + "\n";
  };
  const rows = fill.map(({ row, home, away, from }) => ({ ...row, home_score: String(home), away_score: String(away), end_reason: "unknown", source_url: sourceUrl(row, from), notes: row.notes || NOTE[from] }));
  if (rows.some((r) => `${r.source_url}${r.notes}`.includes(","))) throw new Error("a filled row would hold a comma");
  const at = now.toISOString();
  const playoffs = mergeStored({ file: "playoffs.csv", stored, fresh: csvOf(stored, "playoffs.csv", rows), pending, readTeam: () => false, now: at });
  if (playoffs.counts.filled !== fill.length || playoffs.changes.length || playoffs.counts.added) throw new Error(`the store's merge did not only fill: ${JSON.stringify(playoffs.counts)}`);
  const played = rows.map((r) => ({ ...r, round: "season", neutral: r.neutral || "false" }));
  const gamesMerged = mergeStored({ file: "games.csv", stored: games, fresh: csvOf(games, "games.csv", played, GAMES_HEADER), pending: playoffs.pending, readTeam: () => false, now: at });
  const c = gamesMerged.counts;
  if (c.added + c.filled + c.same !== fill.length || gamesMerged.changes.length || c.proposed) throw new Error(`games.csv: the store's merge would change a stored score: ${JSON.stringify(c)}`);
  return { playoffs, games: gamesMerged, pending: gamesMerged.pending };
}
const GAMES_HEADER = "division,round,game_date,home,away,neutral,home_score,away_score,end_reason,end_period,source_url,notes";

/**
 * Moves for late TAIAO rows the league's bracket dates later, with no final there: `{ row, to }`. A row whose new date
 * would land on another stored row of the same two teams is left as it is.
 */
export function movesFor(late, games, rows) {
  const have = new Set(rows.map(rowKey));
  return late
    .filter((r) => r.league === "TAIAO")
    .map((r) => ({ row: r, to: taiaoFor(r, games)?.date ?? "" }))
    .filter(({ row, to }) => to > row.game_date && !have.has(rowKey({ ...row, game_date: to })));
}

/** playoffs.csv with each move's row on its new date (the next read puts the file back in its order). */
export function moveRows(text, moves) {
  const { header, cols, rows } = parseCsv(text, "playoffs.csv");
  const to = new Map(moves.map((m) => [rowKey(m.row), m.to]));
  return [header, ...rows.map((r) => cols.map((c) => (c === "game_date" ? (to.get(rowKey(r)) ?? r.game_date) : r[c])).join(","))].join("\n") + "\n";
}

/** "2026-11-13 · TAIAO 2 quarterfinal · Away at Home": our own published names, for the run summary. */
export const missingLine = (r) => `${r.game_date} · ${r.league} ${r.division} ${r.round} · ${r.away} at ${r.home}`;

/** The second source's finals for late rows with a mapped team: rowKey to the score in the row's order (never a forfeit). */
async function secondFinals(rows, year, log) {
  const { ours, theirs } = teamMaps(JSON.parse(readFileSync(path.join(HERE, "davecampbells-teams.json"), "utf8")));
  const asked = [...new Set(rows.map((r) => theirs.get(slugify(r.home)) ?? theirs.get(slugify(r.away))).filter(Boolean))];
  const out = new Map();
  if (!asked.length) return out;
  const client = createClient();
  const seasonId = footballSeasons(await client.getData("/api/public/seasons")).get(year);
  if (!seasonId) return out;
  const items = [];
  for (const slug of asked) {
    const id = await teamId(client, slug, seasonId);
    if (id) items.push(...(await liveAndUpcoming(client, seasonId, id)));
  }
  for (const m of matchGames(items, { rows, ours })) {
    const f = finalOf(m);
    if (f && !f.forfeit && !forfeitLike(f.home, f.away)) out.set(rowKey(m.row), f);
  }
  log(`second source: ${asked.length} teams asked, ${out.size} finals`);
  return out;
}

async function main() {
  const store = process.argv[2];
  const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
  if (!store || store.startsWith("--")) throw new Error("usage: late-finals.mjs <store dir> [--season <year>] [--second] [--missing <file>]");
  const year = Number(arg("--season") ?? path.basename(store).replace(/^\D+/, ""));
  const file = path.join(store, "playoffs.csv");
  const pendingFile = path.join(store, PENDING_FILE);
  const now = new Date();
  const lines = [];
  const log = (s) => (console.log(s), lines.push(s));
  let stored = readFileSync(file, "utf8");
  const late0 = lateRows(parseCsv(stored, "playoffs.csv").rows, now);
  log(`Late finals (ADR 0046): ${late0.length} bracket games of past nights with no score after the read.`);

  let games = null;
  if (late0.some((r) => r.league === "TAIAO")) {
    try {
      games = await readBrackets();
      log(`league bracket: ${games.length} games read`);
    } catch (e) {
      log(`league bracket: not read (${String(e.message).split("\n")[0]})`);
    }
  }
  const moves = games ? movesFor(late0, games, parseCsv(stored, "playoffs.csv").rows) : [];
  if (moves.length) {
    stored = moveRows(stored, moves);
    const movesFile = path.join(store, MOVES_FILE);
    const add = moves.map(({ row, to }) => ({ from_date: row.game_date, home: row.home, away: row.away, to_date: to, source: "league bracket" }));
    writeFileSync(movesFile, movesCsv(existsSync(movesFile) ? readFileSync(movesFile, "utf8") : "", add));
    writeFileSync(file, stored);
  }
  log(`moved to the league bracket's later date: ${moves.length}`);
  const late = lateRows(parseCsv(stored, "playoffs.csv").rows, now);

  const taiao = new Map();
  for (const r of games ? late.filter((x) => x.league === "TAIAO") : []) {
    const t = taiaoFor(r, games);
    if (t?.final) taiao.set(rowKey(r), t.final);
  }
  if (games) log(`league bracket: ${taiao.size} finals for these`);
  const second = new Map();
  if (process.argv.includes("--second") && late.length) {
    try {
      for (const [k, v] of await secondFinals(late, year, log)) second.set(k, v);
    } catch (e) {
      if (/HTTP 4(03|29)/.test(e.message)) raise("second-source-refused");
      log(`second source: not read (${String(e.message).split("\n")[0]})`);
    }
  }

  const { fill, disagree } = planLate(late, { taiao, second });
  if (fill.length) {
    const { theirs } = teamMaps(JSON.parse(readFileSync(path.join(HERE, "davecampbells-teams.json"), "utf8")));
    const teamPage = (r) => theirs.get(slugify(r.home)) ?? theirs.get(slugify(r.away));
    const gamesFile = path.join(store, "games.csv");
    const merged = fillStore({
      stored,
      games: existsSync(gamesFile) ? readFileSync(gamesFile, "utf8") : "",
      fill,
      pending: readPending(existsSync(pendingFile) ? readFileSync(pendingFile, "utf8") : ""),
      now,
      sourceUrl: (r, from) => (from === "second" && teamPage(r) ? `${ORIGIN}/team/${teamPage(r)}` : TAIAO_PAGE),
    });
    writeFileSync(file, merged.playoffs.text);
    writeFileSync(gamesFile, merged.games.text);
    writeFileSync(pendingFile, pendingCsv(merged.pending));
  }
  const count = (from) => fill.filter((f) => f.from === from).length;
  log(`filled ${fill.length} (league bracket ${count("taiao")}, second source ${count("second")}, both agreeing ${count("both")}); sources disagree on ${disagree.length}`);

  const filledKeys = new Set(fill.map((f) => rowKey(f.row)));
  const missing = late.filter((r) => !filledKeys.has(rowKey(r)));
  log(`Missing finals: ${missing.length}`);
  for (const r of missing) log(`- ${missingLine(r)}`);
  const out = arg("--missing");
  if (out) writeFileSync(out, missing.map(missingLine).join("\n") + (missing.length ? "\n" : ""));
  if (missing.length) raise("missing-finals");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
