// Data gaps: what the site would show as missing or wrong, counted by kind, every season (CI's web-checks job runs it
// after check-data.mjs; scripts/check.sh too). It fails on a NEW gap, so a gap that comes back is loud, and it fails on an
// allow-list entry that no longer matches anything, so the list only holds live gaps.
//
//   no-date            a game row with no real date, or a date outside its season (July to February)
//   no-score           a game more than 3 days past with no score
//   no-kickoff         a current-season playoff game with no kickoff on the site (fails once the game is a day past)
//   no-site            the same, with no site
//   unknown-team       a team in any game, detail, bracket, home-field or ratings file that is no program in the alignments
//   duplicate          one game listed twice (lib/duplicate-game.ts), or one game twice in the same file
//   score-mismatch     a playoff game whose score games.csv disagrees with, or that games.csv lacks
//   empty-season       a program in the alignments with no current-season game, or no rated one
//   no-league          an alignment row with no league or division, or a league that is no organization (lib/orgs.ts)
//   ratings-mismatch   a team whose rated games or record in data/ratings/<season>.json differ from the season's game
//                      files: a game the ratings skip without one of their reasons (forfeit, no contest, duplicate)
//   no-logo            a program with no identity entry, or no logo and not removed on request
//
// A gap is known in one of two ways. By rule, in the code below, citing the ADR that makes it expected (TAPPS and TCAF
// sites are by hand only, a withheld site stays blank, a past bracket game against an unlisted school, a program whose
// only games are forfeits, a game not played yet). By hand, in data/gaps-allowed.json: kind, key, a reason, the date it
// was reviewed. Everything else fails.

import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyToGame, buildCorrections } from "../lib/corrections.ts";
import * as s from "../lib/data-schemas.ts";
import { duplicateRows } from "../lib/duplicate-game.ts";
import { forfeitScore } from "../lib/forfeit.ts";
import { ORGS } from "../lib/orgs.ts";
import { CURRENT_SEASON } from "../lib/season.ts";
import { slugify } from "../lib/slug.ts";

export const KINDS = ["no-date", "no-score", "no-kickoff", "no-site", "unknown-team", "duplicate", "score-mismatch", "empty-season", "no-league", "ratings-mismatch", "no-logo"];
export const ALLOWED = "data/gaps-allowed.json";

const DAY = 86_400_000;
const STATE_FINAL = new Set(["final", "state"]);
const played = (r) => r.home_score !== "" && r.away_score !== "";
const noContest = (r) => +r.home_score === 0 && +r.away_score === 0;
const forfeit = (r) => r.end_reason === "forfeit" || forfeitScore(+r.home_score, +r.away_score);
/** One game, whatever the order of its teams (lib/games.ts gameKey). */
export const gameKey = (date, a, b) => [date, ...[slugify(a), slugify(b)].sort()].join("|");
const keyOf = (r) => gameKey(r.game_date ?? r.date, r.home, r.away);
const line = (r) => `${r.game_date ?? r.date} ${r.away} at ${r.home}${r.home_score ? ` ${r.away_score}-${r.home_score}` : ""}`;
const realDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "") && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
/** A season's games run from July to February. */
const inSeason = (d, season) => d >= `${season}-07-01` && d <= `${season + 1}-02-28`;
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Every gap in the data, each with a kind, a key that names it in the allow list, a line a person can act on, and `rule`
 * when the code itself knows why it is there.
 * @param {{
 *   today: string,
 *   alignments: {league: string, division: string, school: string}[],
 *   seasons: {season: number, games: object[], playoffs: object[], ratings?: {teams: object[]}}[],
 *   details?: object[], disputed?: object[], brackets?: object[], uilBracket?: object[], homeFields?: object[],
 *   identity?: {removed: string[], schools: Record<string, {logo?: object | null}>},
 *   withheld?: object[], kickoffs?: Set<string>, sites?: Set<string>,
 * }} data  games and playoffs with corrections applied, playoffs each with `league`; kickoffs and sites: the gameKeys the
 *   site shows a kickoff or a site for (lib/kickoffs.ts), current season.
 * @returns {{kind: string, key: string, text: string, rule?: string}[]}
 */
export function findGaps(data) {
  const { today, alignments, seasons } = data;
  const gaps = [];
  const gap = (kind, key, text, rule) => gaps.push({ kind, key: `${kind} ${key}`, text, ...(rule && { rule }) });
  const programs = new Set(alignments.map((a) => slugify(a.school)));
  const team = (t, where) => !programs.has(slugify(t)) && gap("unknown-team", `${where} ${slugify(t)}`, `${where}: ${t} is no program in the alignments (add an alias or a merge)`);

  // Alignments: every row has an organization the site knows.
  const leagues = new Set(ORGS.map((o) => o.league));
  for (const a of alignments) {
    if (!a.league || !a.division || !leagues.has(a.league)) gap("no-league", slugify(a.school), `alignment row with no known league or division: ${a.school} (${a.league || "no league"}, ${a.division || "no division"})`);
  }

  for (const { season, games, playoffs, ratings } of seasons) {
    const current = season === CURRENT_SEASON;
    for (const r of [...games, ...playoffs]) {
      if (!realDate(r.game_date) || !inSeason(r.game_date, season)) gap("no-date", `${season} ${keyOf(r)}`, `${season}: no date in the season: ${line(r)}`);
      else if (!played(r) && r.game_date <= addDays(today, -4)) gap("no-score", `${season} ${keyOf(r)}`, `${season}: no score on a game more than 3 days past: ${line(r)} (${r.round})`);
    }

    // Teams. A past season's bracket game may be against a school no alignment lists (ADR 0069): an outside game.
    for (const r of games) for (const t of [r.home, r.away]) team(t, `${season} games`);
    for (const r of playoffs) {
      for (const t of [r.home, r.away]) {
        if (programs.has(slugify(t))) continue;
        if (current) team(t, `${season} playoffs`);
        else gap("unknown-team", `${season} playoffs ${slugify(t)}`, `${season} playoffs: ${t}`, "ADR 0069: a past bracket game against a school outside the alignments");
      }
    }
    for (const t of ratings?.teams ?? []) team(t.team, `${season} ratings`);

    // One game listed once.
    for (const [i] of duplicateRows(games)) gap("duplicate", `${season} ${keyOf(games[i])}`, `${season}: one game listed twice: ${line(games[i])}`);
    for (const [k, list] of Map.groupBy(playoffs, keyOf)) if (list.length > 1) gap("duplicate", `${season} playoffs ${k}`, `${season} playoffs: one game ${list.length} times: ${line(list[0])}`);

    // A playoff game and its games.csv row agree.
    const inGames = new Map(games.map((r) => [keyOf(r), r]));
    for (const r of playoffs.filter(played)) {
      if (![r.home, r.away].every((t) => programs.has(slugify(t)))) continue; // an outside game: never in games.csv
      const g = inGames.get(keyOf(r));
      if (!g) {
        gap("score-mismatch", `${season} ${keyOf(r)}`, `${season}: playoff game not in games.csv: ${line(r)}`);
        continue;
      }
      const same = slugify(g.home) === slugify(r.home) ? [g.home_score, g.away_score] : [g.away_score, g.home_score];
      if (same[0] !== r.home_score || same[1] !== r.away_score) gap("score-mismatch", `${season} ${keyOf(r)}`, `${season}: playoffs.csv has ${line(r)}, games.csv ${same[1]}-${same[0]}`);
    }

    // The ratings table counts each team's games as the files do.
    if (ratings) {
      const want = new Map();
      const kept = games.filter(played);
      const copies = duplicateRows(kept);
      const seen = new Set();
      kept.forEach((r, i) => {
        if (copies.has(i) || seen.has(keyOf(r)) || noContest(r)) return;
        seen.add(keyOf(r));
        const d = +r.home_score - +r.away_score;
        for (const [t, m] of [[r.home, d], [r.away, -d]]) {
          const w = want.get(t) ?? { rated: 0, won: 0, lost: 0, tied: 0 };
          if (!forfeit(r)) w.rated++;
          w[m > 0 ? "won" : m < 0 ? "lost" : "tied"]++;
          want.set(t, w);
        }
      });
      const table = new Map(ratings.teams.map((t) => [t.team, t]));
      for (const [t, w] of want) {
        const got = table.get(t);
        const fields = ["rated", "won", "lost", "tied"].filter((f) => (got?.[f] ?? 0) !== w[f]);
        if (!w.rated && !got) continue; // only forfeits: no rating (see empty-season)
        if (fields.length) gap("ratings-mismatch", `${season} ${slugify(t)}`, `${season}: ${t} has ${fields.map((f) => `${f} ${w[f]}`).join(", ")} in the game files but ${fields.map((f) => `${f} ${got?.[f] ?? "none"}`).join(", ")} in data/ratings/${season}.json (rerun run.py --season ${season})`);
      }
      for (const t of ratings.teams) if (!want.has(t.team) && t.rated) gap("ratings-mismatch", `${season} ${slugify(t.team)}`, `${season}: ${t.team} is rated in data/ratings/${season}.json but has no game in the files`);
    }

    if (!current) continue;
    // Every program has a season, and a rating unless it only has forfeits.
    const withGame = new Map();
    for (const r of [...games, ...playoffs]) for (const t of [r.home, r.away]) withGame.set(slugify(t), [...(withGame.get(slugify(t)) ?? []), r]);
    const rated = new Set((ratings?.teams ?? []).map((t) => slugify(t.team)));
    for (const p of programs) {
      const rows = withGame.get(p) ?? [];
      if (!rows.length) gap("empty-season", `${season} ${p}`, `${season}: ${p} has no game this season`);
      else if (ratings && !rated.has(p)) {
        const onlyForfeits = rows.filter(played).every((r) => forfeit(r) || noContest(r));
        gap("empty-season", `${season} ${p}`, `${season}: ${p} has ${rows.length} game(s) and no rating`, onlyForfeits && "ADR 0004: its only results are forfeits, which are never rated");
      }
    }

    // Kickoff and site for a playoff game. Due once the morning read after the game has run (ADR 0077): a game of today or
    // later is listed as known, so a gap is seen before game night without failing every pull request that evening.
    const withheld = new Set((data.withheld ?? []).map((w) => gameKey(w.date, w.home, w.away)));
    for (const r of playoffs) {
      if (!data.kickoffs || !data.sites) continue;
      const k = keyOf(r);
      const byHand = r.league === "TCAF" || (r.league === "TAPPS" && !STATE_FINAL.has(r.round));
      const notPlayed = played(r) && (forfeit(r) || noContest(r));
      const rule = notPlayed
        ? "ADR 0004: a forfeit or a no contest was not played, so it has no kickoff or site"
        : byHand
          ? "ADRs 0064 and 0065: a TAPPS or TCAF bracket game's site and kickoff come by hand only"
          : r.game_date >= today
            ? "not due yet: the game is today or later, and the next morning read may fill it"
            : undefined;
      if (!data.kickoffs.has(k)) gap("no-kickoff", `${season} ${k}`, `${season} ${r.league} ${r.round}: no kickoff: ${line(r)}`, rule);
      if (!data.sites.has(k)) gap("no-site", `${season} ${k}`, `${season} ${r.league} ${r.round}: no site: ${line(r)}`, rule ?? (withheld.has(k) ? "ADR 0076: a site allowed pages contradict is withheld" : undefined));
    }
  }

  // The other files name programs too.
  for (const r of data.details ?? []) for (const t of [r.home, r.away]) team(t, "game-details");
  for (const r of data.disputed ?? []) for (const t of [r.home, r.away]) team(t, "disputed");
  for (const r of [...(data.brackets ?? []), ...(data.uilBracket ?? [])]) for (const t of [r.a, r.b]) if (t && t !== "bye" && !t.startsWith("winner:")) team(t, "brackets");
  for (const r of data.homeFields ?? []) if (!programs.has(r.program)) gap("unknown-team", `home-fields ${r.program}`, `home-fields.csv: ${r.program} is no program in the alignments`);
  for (const [k, list] of Map.groupBy(data.details ?? [], keyOf)) if (list.length > 1) gap("duplicate", `game-details ${k}`, `game-details: one game ${list.length} times: ${line(list[0])}`);

  // Logos.
  if (data.identity) {
    const removed = new Set(data.identity.removed);
    for (const p of programs) {
      const e = data.identity.schools[p];
      if (!e) gap("no-logo", p, `${p} has no entry in data/seed/schools/identity.json`);
      else if (!e.logo && !removed.has(p)) gap("no-logo", p, `${p} has no logo from an allowed source (ADRs 0006, 0016)`);
    }
  }
  return gaps;
}

/**
 * Gaps against the allow list: counts by kind, what fails (a new gap, a stale or malformed entry), what is known.
 * @param {ReturnType<typeof findGaps>} gaps
 * @param {{kind: string, key: string, reason: string, reviewed: string}[]} allowed
 */
export function judgeGaps(gaps, allowed) {
  const failures = [];
  const ok = allowed.filter((a) => {
    const good = KINDS.includes(a?.kind) && typeof a.key === "string" && a.key.startsWith(`${a.kind} `) && typeof a.reason === "string" && a.reason.length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(a.reviewed ?? "");
    if (!good) failures.push(`${ALLOWED}: an entry needs a kind, a key starting with its kind, a reason and a reviewed date: ${JSON.stringify(a).slice(0, 140)}`);
    return good;
  });
  const reasons = new Map(ok.map((a) => [a.key, a.reason]));
  const keys = new Set(gaps.map((g) => g.key));
  const counts = Object.fromEntries(KINDS.map((k) => [k, { total: 0, rule: 0, allowed: 0, new: 0 }]));
  const known = [];
  for (const g of gaps) {
    const c = counts[g.kind];
    c.total++;
    if (g.rule) {
      c.rule++;
      known.push(`${g.text} [${g.rule}]`);
    } else if (reasons.has(g.key)) {
      c.allowed++;
      known.push(`${g.text} [allowed: ${reasons.get(g.key)}]`);
    } else {
      c.new++;
      failures.push(`${g.text}  (key: ${g.key})`);
    }
  }
  for (const a of ok) if (!keys.has(a.key)) failures.push(`stale entry in ${ALLOWED} (no such gap now; remove it): ${a.key}`);
  for (const a of ok) if (gaps.some((g) => g.key === a.key && g.rule)) failures.push(`entry in ${ALLOWED} for a gap a rule already explains (remove it): ${a.key}`);
  return { counts, failures, known };
}

/** The repo's files, read and corrected as the site reads them. */
export async function loadData(root, today = new Date().toISOString().slice(0, 10)) {
  const P = (f) => path.join(root, f);
  const read = (file, columns, schema) => (existsSync(P(file)) ? s.parseCsv(file, readFileSync(P(file), "utf8"), columns, schema).map(({ row }) => row) : []);
  const fixes = buildCorrections([], read("data/corrections/games.csv", s.GAME_CORRECTION_COLUMNS, s.GameCorrectionRow));
  const fixed = (rows) => rows.flatMap((r) => applyToGame(fixes, r)?.row ?? []);
  const dirs = readdirSync(P("data/seed"));
  const alignments = dirs.filter((d) => existsSync(P(`data/seed/${d}/alignments.csv`))).flatMap((d) => read(`data/seed/${d}/alignments.csv`, s.ALIGNMENT_COLUMNS, s.AlignmentRow));
  const seasons = dirs.flatMap((d) => /^maxpreps-(\d{4})$/.exec(d)?.[1] ?? []).map(Number).sort().map((season) => {
    const captured = dirs.flatMap((d) => (existsSync(P(`data/seed/${d}/playoffs-${season}.csv`)) && d.startsWith("uil-") ? fixed(read(`data/seed/${d}/playoffs-${season}.csv`, s.GAME_COLUMNS, s.PlayoffRow)).map((r) => ({ ...r, league: "UIL" })) : []));
    const seen = new Set(captured.map(keyOf));
    const robot = fixed(read(`data/seed/maxpreps-${season}/playoffs.csv`, ["league", ...s.RESULT_COLUMNS], s.RobotPlayoffRow)).filter((r) => !seen.has(keyOf(r)));
    const ratingsFile = P(`data/ratings/${season}.json`);
    return {
      season,
      // Hand captures first, as the ratings read them (run.py: the first file wins a game).
      games: [...captured.filter(played), ...fixed(read(`data/seed/maxpreps-${season}/games.csv`, s.RESULT_COLUMNS, s.PlayedGameRow)).filter((r) => !seen.has(keyOf(r)))],
      playoffs: [...captured, ...robot],
      ...(existsSync(ratingsFile) && { ratings: JSON.parse(readFileSync(ratingsFile, "utf8")) }),
    };
  });
  // The site's own reading of kickoffs and sites (game-details plus what a league's bracket lists), from apps/web.
  const cwd = process.cwd();
  process.chdir(P("apps/web"));
  const { loadKickoffs, loadSites } = await import("../lib/kickoffs.ts");
  const [kickoffs, sites] = await Promise.all([loadKickoffs(CURRENT_SEASON), loadSites(CURRENT_SEASON)]);
  process.chdir(cwd);
  return {
    today,
    alignments,
    seasons,
    details: dirs.includes("game-details") ? readdirSync(P("data/seed/game-details")).filter((f) => /^\d{4}\.csv$/.test(f)).flatMap((f) => read(`data/seed/game-details/${f}`, s.DETAIL_COLUMNS, s.DetailRow)) : [],
    disputed: dirs.includes("disputed") ? readdirSync(P("data/seed/disputed")).filter((f) => /^\d{4}\.csv$/.test(f)).flatMap((f) => read(`data/seed/disputed/${f}`, s.DISPUTED_COLUMNS, s.DisputedRow)) : [],
    brackets: dirs.includes("brackets") ? readdirSync(P("data/seed/brackets")).filter((f) => /^\d{4}\.csv$/.test(f)).flatMap((f) => read(`data/seed/brackets/${f}`, s.BRACKET_COLUMNS, s.BracketSlotRow)) : [],
    uilBracket: dirs.filter((d) => /^uil-\d{4}-\d{2}$/.test(d)).flatMap((d) => readdirSync(P(`data/seed/${d}`)).filter((f) => /^bracket-\d{4}\.csv$/.test(f)).flatMap((f) => read(`data/seed/${d}/${f}`, s.UIL_BRACKET_COLUMNS, s.UilBracketRow))),
    homeFields: read("data/seed/schools/home-fields.csv", s.HOME_FIELD_COLUMNS, s.HomeFieldRow),
    identity: JSON.parse(readFileSync(P("data/seed/schools/identity.json"), "utf8")),
    withheld: read("data/corrections/sites.csv", s.WITHHELD_SITE_COLUMNS, s.WithheldSiteRow),
    kickoffs: new Set(kickoffs.keys()),
    sites: new Set(sites.keys()),
  };
}

/** Prints the counts and the failures, adds them to the run summary, and gives the exit code. */
export function report({ counts, failures, known }, env = {}, log = console.log) {
  const rows = KINDS.map((k) => `| ${k} | ${counts[k].total} | ${counts[k].rule} | ${counts[k].allowed} | ${counts[k].new} |`);
  const table = ["| Kind | Found | Known by rule | Allowed | New |", "|---|---|---|---|---|", ...rows].join("\n");
  log(table);
  for (const k of known) log(`known gap: ${k}`);
  for (const f of failures) log(`BAD  gap: ${f}`);
  log(failures.length ? `${failures.length} data gap problem(s): fix the data, or add a reviewed entry to ${ALLOWED} with the reason.` : "No new data gaps.");
  if (env.GITHUB_STEP_SUMMARY) {
    const list = (title, items) => (items.length ? `\n**${title}**\n${items.map((i) => `- ${i}`).join("\n")}\n` : "");
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Data gaps\n${table}\n${list("Failed", failures)}${list("Known", known)}\n`);
  }
  return failures.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "../../.."));
  const allowed = existsSync(path.join(root, ALLOWED)) ? JSON.parse(readFileSync(path.join(root, ALLOWED), "utf8")) : [];
  process.exit(report(judgeGaps(findGaps(await loadData(root)), allowed), process.env));
}
