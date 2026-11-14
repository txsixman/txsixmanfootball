import { readFile } from "node:fs/promises";
import { memo } from "./memo";
import path from "node:path";
import type { Game, Team } from "./demo-games";
import { heading, programFor, slugify, type Alignment } from "./alignments";
import { project, projectionText } from "./projection";
import { GAME_COLUMNS, parseCsv, PlayedGameRow, PlayoffRow, RESULT_COLUMNS, RobotPlayoffRow } from "./data-schemas";
import { loadRatings } from "./ratings";
import { roundLabel } from "./brackets";
import { CURRENT_SEASON } from "./season";
import { forfeitScore } from "./forfeit";
import { applyToGame } from "./corrections";
import { buildSeasonResults, type SeasonResult } from "./season-results";
import { loadCorrections } from "./correction-files";
import { kickoffOf, loadKickoffs } from "./kickoffs";
import { isDisputed, loadDisputed } from "./disputed";

// Hand-captured games (data/seed/*/playoffs-*.csv), read at build time. Same columns as packages/db/games.mjs, checked
// row by row in lib/data-schemas.ts: a bad row fails the build.
const CAPTURES = [{ file: "uil-2026-28/playoffs-2026.csv", league: "UIL", season: CURRENT_SEASON }];

export const initials = (name: string) =>
  name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function endReason(code: string, period: string): string | undefined {
  if (code === "forfeit") return "Forfeit";
  if (code === "mercy_half") return "45-point rule, halftime";
  if (code === "mercy_2h") return period ? `45-point rule, Q${period}` : "45-point rule, second half";
  return undefined;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

const readOptional = (file: string) =>
  readFile(path.join(process.cwd(), "../../data/seed", file), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });

type Row = { r: Record<string, string>; league: string; season: number; file: string; line: number; robot: boolean };

/** Rows left out on purpose, reported once per file in the build log (never silently). */
const reported = new Set<string>();
function reportSkipped(file: string, count: number, why: string) {
  if (!count || reported.has(file)) return;
  reported.add(file);
  console.info(`${file}: ${count} row(s) skipped (${why})`);
}

/** Hand captures, then robot-read playoff games (ADR 0008); a robot row for a game already captured by hand is dropped. */
async function playoffRows(seasons = [CURRENT_SEASON]): Promise<Row[]> {
  const fixes = await loadCorrections();
  const rows: Row[] = [];
  for (const c of CAPTURES.filter((c) => seasons.includes(c.season))) {
    const text = await readFile(path.join(process.cwd(), "../../data/seed", c.file), "utf8");
    for (const { row, line } of parseCsv(`data/seed/${c.file}`, text, GAME_COLUMNS, PlayoffRow)) {
      const fixed = applyToGame(fixes, row);
      if (fixed) rows.push({ r: fixed.row, league: c.league, season: c.season, file: c.file, line, robot: false });
    }
  }
  const seen = new Set(rows.map(({ r }) => [r.game_date, ...[r.home, r.away].sort()].join("|")));
  for (const season of seasons) {
    const file = `maxpreps-${season}/playoffs.csv`;
    const text = await readOptional(file);
    if (!text) continue;
    let skipped = 0;
    let voided = 0;
    for (const { row, line } of parseCsv(`data/seed/${file}`, text, ["league", ...RESULT_COLUMNS], RobotPlayoffRow)) {
      const fixed = applyToGame(fixes, row);
      if (!fixed) {
        voided += 1; // listed in error (data/corrections)
        continue;
      }
      const r = fixed.row;
      if (seen.has([r.game_date, ...[r.home, r.away].sort()].join("|"))) {
        skipped += 1;
        continue;
      }
      rows.push({ r, league: r.league, season, file, line, robot: true });
    }
    reportSkipped(`data/seed/${file}`, skipped, "already captured by hand");
    reportSkipped(`data/seed/${file}#voided`, voided, "voided by a correction");
  }
  return rows;
}

/** The address id of a playoff game's page (/scores/<id>). */
const playoffGameId = (season: number, r: Record<string, string>) =>
  `${season}-${r.round}-${slugify(r.away)}-at-${slugify(r.home)}`;

/** Leagues with playoff games in a season (hand-captured or robot-read). */
export async function playoffLeagueSet(season: number): Promise<Set<string>> {
  return new Set((await playoffRows([season])).map(({ league }) => league));
}

export async function loadGames(alignments: Alignment[]): Promise<Game[]> {
  const [rows, ratings, kickoffs] = await Promise.all([playoffRows(), loadRatings(), loadKickoffs(CURRENT_SEASON)]);
  const disputedBy = new Map(await Promise.all([...new Set(rows.map((x) => x.season))].map(async (s) => [s, await loadDisputed(s)] as const)));
  return rows.map(({ r, league, season, file, line: i, robot }) => {
    const team = (name: string): Team => {
      const known = programFor(alignments, name, league);
      if (!known) throw new Error(`${file} row ${i}: unknown team ${name}`);
      return { name: known.school, mascot: "", initials: initials(known.school), color: "#0a2a5e", record: "" };
    };
    // A 0-0 is how a source writes a game it has no score for: no score, never a final (ADR 0034's store rule).
    const played = r.home_score !== "" && r.away_score !== "" && !(r.home_score === "0" && r.away_score === "0");
    const home = team(r.home);
    const away = team(r.away);
    const disputed = played && isDisputed(disputedBy.get(season)!, r.game_date, r.home, r.away);
    // Playoff sites are mostly neutral; a row that does not say gets no home edge.
    const projection = !played && ratings.season === season ? project(ratings, home.name, away.name, r.neutral !== "false", r.neutral === "true") : undefined;
    return {
      id: playoffGameId(season, r),
      date: r.game_date,
      round: r.round,
      league: `${heading({ league, division: r.division, region: "1" }).replace("Division ", "D")} · ${roundLabel(r.round, league)}`,
      home,
      away,
      homeScore: played ? Number(r.home_score) : null,
      awayScore: played ? Number(r.away_score) : null,
      state: played ? "final" : "scheduled",
      status: played ? (disputed ? "Score reported" : "Final") : shortDate(r.game_date),
      ...(!played && season === CURRENT_SEASON && { kickoff: kickoffOf(kickoffs, r.game_date, r.home, r.away) }),
      // A robot-read 1-0 or 2-0 is how the source records a forfeit: shown as one, never as a score (ADR 0004).
      endReason: played
        ? endReason(robot && forfeitScore(Number(r.home_score), Number(r.away_score)) ? "forfeit" : r.end_reason, r.end_period)
        : undefined,
      // A final score is confirmed, whether read by the robot, captured by hand or corrected (ADR 0040). Only a live score is
      // unconfirmed, and a forfeit still shows the word, never its 1-0 or 2-0 (ADR 0004). A final the sources give different
      // winners is disputed (data/seed/disputed): its score shows, no winner is marked.
      verification: played ? (disputed ? "disputed" : "confirmed") : "none",
      projected: projection && projectionText(projection),
      projectedMargin: projection?.margin,
      venue: r.neutral === "true" ? "Neutral site" : r.neutral === "false" ? `${home.name} (home)` : "Site not listed",
    } satisfies Game;
  });
}

/** A season's playoff game for the bracket page: hand capture or robot-read, team names as our alignments spell them.
 * Scores are absent until played; a forfeit carries no score to show (ADR 0004). */
export type PlayoffGame = {
  league: string; bracket: string; round: string; date: string; home: string; away: string;
  homeScore?: number; awayScore?: number; forfeit: boolean; neutral: boolean;
  /** A played game: its final score is confirmed, however it was read, unless the sources give it different winners (ADR 0040). */
  confirmed: boolean;
  /** Kickoff in UTC, for a game not yet played, when known (lib/kickoffs.ts, ADR 0036). */
  kickoff?: string;
};

export async function loadPlayoffGames(alignments: Alignment[], season = CURRENT_SEASON): Promise<PlayoffGame[]> {
  const [kickoffs, disputed] = await Promise.all([loadKickoffs(season), loadDisputed(season)]);
  return (await playoffRows([season])).map(({ r, league }) => {
    const name = (n: string) => programFor(alignments, n, league)?.school ?? n;
    const played = r.home_score !== "" && r.away_score !== "" && !(r.home_score === "0" && r.away_score === "0");
    const [h, a] = [Number(r.home_score), Number(r.away_score)];
    return {
      league,
      bracket: heading({ league, division: r.division, region: "1" }),
      round: r.round,
      date: r.game_date,
      home: name(r.home),
      away: name(r.away),
      ...(played ? { homeScore: h, awayScore: a } : {}),
      forfeit: r.end_reason === "forfeit" || (played && forfeitScore(h, a)),
      neutral: r.neutral !== "false",
      confirmed: played && !isDisputed(disputed, r.game_date, r.home, r.away), // a final is confirmed unless disputed (ADR 0040)
      ...(!played && { kickoff: kickoffOf(kickoffs, r.game_date, r.home, r.away) }),
    };
  });
}

/** Playoff games with their bracket ("TAPPS Division II Large School") and round, team names as our alignments spell them. */
export type BracketGame = { bracket: string; round: string; home: string; away: string; played: boolean; neutral: boolean };

// Playoff rounds in bracket order, earliest first. UIL plays bi-district, area, regional, semifinal, state; the private
// leagues play round-1 (or none), quarterfinal, semifinal, final.
export const ROUNDS = ["round-1", "bi-district", "area", "quarterfinal", "regional", "semifinal", "final", "state"];

/** "the regional round": how far a team went, as a phrase. Says which round it played, never whether it won (ADR 0004). */
export function roundPhrase(round: string, league: string): string {
  const state = league === "UIL" ? "state " : "";
  if (round === "final" || round === "state") return `the ${state}final`;
  if (round === "semifinal") return `the ${state}semifinal`;
  if (round === "round-1") return "the first round";
  if (round === "quarterfinal") return "the quarterfinal";
  return `the ${round} round`;
}

/** Each team's last playoff round of a season (team name as the season's files spell it) and its league. Shared across
 * pages: never mutate it. */
export const playoffReach = memo(async (season: number): Promise<Map<string, { round: string; league: string }>> => {
  const reach = new Map<string, { round: string; league: string }>();
  for (const { r, league } of await playoffRows([season])) {
    for (const team of [r.home, r.away]) {
      const was = reach.get(team);
      if (!was || ROUNDS.indexOf(r.round) > ROUNDS.indexOf(was.round)) reach.set(team, { round: r.round, league });
    }
  }
  return reach;
});

/** The key two files agree on for one game: date and both teams (spelling and order of the teams do not matter). */
export const gameKey = (date: string, home: string, away: string) => [date, ...[slugify(home), slugify(away)].sort()].join("|");

/** `gameKey` of each playoff game of a season: playoff sites are mostly neutral (see run.py playoff_sites), and
 * games.csv holds playoff games too, so standings and pregame use this to tell them from regular-season games. */
export async function playoffGameKeys(season: number): Promise<Set<string>> {
  return new Set((await playoffRows([season])).map(({ r }) => gameKey(r.game_date, r.home, r.away)));
}

export type { SeasonResult };

/** Robot-read results for a season, with team names already matched to our alignments by the reader. Shared across
 * pages: never mutate it. */
export const loadSeasonResults = memo(async (season: number): Promise<SeasonResult[]> => {
  const file = path.join(process.cwd(), "../../data/seed", `maxpreps-${season}`, "games.csv");
  const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  if (!text) return [];
  const playoffPages = new Map(season === CURRENT_SEASON ? (await playoffRows([season])).map(({ r }) => [gameKey(r.game_date, r.home, r.away), playoffGameId(season, r)]) : []);
  const { results, voided, duplicates } = buildSeasonResults(season, text, await loadCorrections(), playoffPages, gameKey);
  reportSkipped(`data/seed/maxpreps-${season}/games.csv#voided`, voided, "voided by a correction");
  reportSkipped(`data/seed/maxpreps-${season}/games.csv#duplicates`, duplicates, "one game listed twice");
  return results;
});
