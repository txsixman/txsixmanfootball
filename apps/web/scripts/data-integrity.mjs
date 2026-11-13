// Cross-file checks on a season's games, beyond what one row can show (scripts/check-data.mjs runs them). Pure: the
// caller reads the files and applies the corrections (data/corrections), so a fix made the normal way, a correction or
// an alias, is what is checked.
//
// Hard (fail CI and the robot's commit): the current season only. Earlier seasons are history the robots no longer
// write; their findings print as warnings, so they are known without blocking a deploy.
//   - no program plays two games on one date (a forfeit, 1-0 or 2-0, and a 0-0 no contest were not played, ADR 0004)
//   - every played playoff game (playoffs.csv, and a hand capture) is in games.csv: same teams, date and score
//   - a team in a later playoff round did not lose, tie or miss its game in that bracket's round before
//   - scores are whole numbers 0 to 200, and a game marked forfeit is recorded 1-0 or 2-0 (a forfeit-shaped score is
//     never marked regulation, overtime or a mercy rule)
//   - every team resolves to a program in the alignments
// Soft (a warning in the step summary; current season only): a margin over 90; a score on a game more than 3 days ahead; a program with no
// game after week 4; a playoff game outside its round's usual week; more teams arriving in a round with no game in the
// round before than the bracket has byes (an earlier game the source does not list).
//
// A hard problem the source cannot settle (both versions are on the source, so a correction would invent the right
// one) is listed in data/integrity-exceptions.json with the reason; an exception that no longer matches anything fails,
// so the list only holds live problems.

import { forfeitScore } from "../lib/forfeit.ts";
import { slugify } from "../lib/slug.ts";

/** Playoff rounds, earliest first (lib/games.ts ROUNDS). */
const ROUNDS = ["round-1", "bi-district", "area", "quarterfinal", "regional", "semifinal", "final", "state"];
const DAY = 86_400_000;
/** The Monday of a date's week; week 1 holds the season's first game (lib/weeks.ts, same rule). */
export const mondayOf = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

/** The key two files agree on for one game (lib/games.ts gameKey). */
export const gameKey = (r) => [r.game_date, ...[slugify(r.home), slugify(r.away)].sort()].join("|");
const played = (r) => r.home_score !== "" && r.away_score !== "";
/** Not a game on the field: a forfeit (1-0, 2-0, or marked so) or a 0-0 no contest. */
const notPlayed = (r) => played(r) && (r.end_reason === "forfeit" || forfeitScore(+r.home_score, +r.away_score) || (+r.home_score === 0 && +r.away_score === 0));
const line = (r) => `${r.game_date} ${r.away} at ${r.home}${played(r) ? ` ${r.away_score}-${r.home_score}` : ""}`;

/**
 * @param {{ season: number, current: boolean, games: object[], playoffs: object[], programs?: Set<string>, today: string }} input
 *   games: games.csv rows; playoffs: playoffs.csv rows and hand captures (each with `league`); programs: the slugs of
 *   every program in the alignments (current season only); today: YYYY-MM-DD.
 * @returns {{ hard: {key: string, text: string}[], soft: string[] }}
 */
export function checkSeason({ season, current, games, playoffs, programs, today }) {
  const hard = [];
  const soft = [];
  const fail = (key, text) => (current ? hard.push({ key, text }) : soft.push(`${season} (history): ${text}`));
  // The soft checks are for the season being written; history keeps only what would fail today.
  const warn = (text) => current && soft.push(text);

  // Scores and forfeits, every row.
  for (const r of [...games, ...playoffs]) {
    if (!played(r)) continue;
    const [h, a] = [r.home_score, r.away_score];
    if (![h, a].every((v) => /^\d+$/.test(v) && +v <= 200)) fail(`score ${gameKey(r)}`, `score is not a whole number 0 to 200: ${line(r)}`);
    else if (r.end_reason === "forfeit" && !forfeitScore(+h, +a)) fail(`forfeit ${gameKey(r)}`, `marked forfeit but not recorded 1-0 or 2-0: ${line(r)}`);
    else if (forfeitScore(+h, +a) && ["regulation", "overtime", "mercy_half", "mercy_2h"].includes(r.end_reason)) {
      fail(`forfeit ${gameKey(r)}`, `a forfeit's score (1-0 or 2-0) marked ${r.end_reason}: ${line(r)}`);
    }
  }

  // One game a program a date. A playoff game is in both files: one game, counted once.
  const all = new Map();
  for (const r of [...games, ...playoffs]) if (!all.has(gameKey(r)) || played(r)) all.set(gameKey(r), r);
  const byTeamDate = new Map();
  for (const r of all.values()) {
    if (notPlayed(r)) continue;
    for (const t of [r.home, r.away]) {
      const k = `${r.game_date} ${slugify(t)}`;
      byTeamDate.set(k, [...(byTeamDate.get(k) ?? []), r]);
    }
  }
  for (const [k, rows] of byTeamDate) if (rows.length > 1) fail(`two-games ${k}`, `${k.split(" ")[1]} has ${rows.length} games on ${rows[0].game_date}: ${rows.map(line).join("; ")}`);

  // Every played playoff game is in games.csv with the same score.
  const inGames = new Map(games.map((r) => [gameKey(r), r]));
  for (const r of playoffs.filter(played)) {
    const g = inGames.get(gameKey(r));
    if (!g) {
      fail(`playoff-missing ${gameKey(r)}`, `playoff game not in games.csv: ${line(r)}`);
      continue;
    }
    const same = slugify(g.home) === slugify(r.home) ? [g.home_score, g.away_score] : [g.away_score, g.home_score];
    if (same[0] !== r.home_score || same[1] !== r.away_score) {
      fail(`playoff-score ${gameKey(r)}`, `playoff score ${r.away_score}-${r.home_score} but games.csv has ${same[1]}-${same[0]}: ${line(r)}`);
    }
  }

  // Brackets: a later round's teams came out of the round before.
  const brackets = Map.groupBy(playoffs, (r) => `${r.league} ${r.division}`);
  for (const [bracket, rows] of brackets) {
    const rounds = [...new Set(rows.map((r) => r.round))].filter((r) => ROUNDS.includes(r)).sort((a, b) => ROUNDS.indexOf(a) - ROUNDS.indexOf(b));
    for (let i = 1; i < rounds.length; i++) {
      const before = rows.filter((r) => r.round === rounds[i - 1]);
      const result = new Map();
      for (const r of before) {
        const [h, a] = [slugify(r.home), slugify(r.away)];
        if (!played(r)) {
          result.set(h, "has no score in");
          result.set(a, "has no score in");
          continue;
        }
        const d = +r.home_score - +r.away_score;
        result.set(h, d > 0 ? "won" : d < 0 ? "lost" : "tied");
        result.set(a, d < 0 ? "won" : d > 0 ? "lost" : "tied");
      }
      const byes = 2 ** Math.ceil(Math.log2(Math.max(1, before.length))) - before.length;
      const arriving = [];
      for (const r of rows.filter((r) => r.round === rounds[i])) {
        for (const t of [r.home, r.away]) {
          const was = result.get(slugify(t));
          if (!was) arriving.push(t);
          else if (was === "has no score in") warn(`${season} ${bracket}: ${t} plays the ${rounds[i]} but its ${rounds[i - 1]} game has no score yet`);
          else if (was !== "won") fail(`bracket ${season} ${bracket} ${rounds[i]} ${slugify(t)}`, `${bracket}: ${t} is in the ${rounds[i]} but ${was} its ${rounds[i - 1]} game`);
        }
      }
      if (arriving.length > byes) {
        warn(`${season} ${bracket}: ${arriving.length} team(s) in the ${rounds[i]} with no ${rounds[i - 1]} game listed, ${byes} bye(s): ${arriving.join(", ")}`);
      }
    }
  }

  // Every team is a program we know (current season: the alignments are this season's).
  if (programs) {
    const unknown = new Set();
    for (const r of [...games, ...playoffs]) for (const t of [r.home, r.away]) if (!programs.has(slugify(t))) unknown.add(t);
    for (const t of unknown) fail(`unknown-team ${slugify(t)}`, `team not in the alignments (add an alias or a program merge): ${t}`);
  }

  // Soft: a margin over 90 (once a game).
  for (const r of all.values()) if (played(r) && Math.abs(+r.home_score - +r.away_score) > 90) warn(`${season}: margin over 90: ${line(r)}`);
  // Soft: a score more than 3 days ahead.
  for (const r of all.values()) if (played(r) && daysBetween(today, r.game_date) > 3) warn(`${season}: a score on a game more than 3 days ahead: ${line(r)}`);

  if (current && programs && all.size) {
    // Soft: a program with no game after week 4, once the season's games reach week 5 (so a file that stops early is
    // not every program at once).
    const dates = [...all.values()].map((r) => r.game_date).sort();
    const week5 = new Date(Date.parse(`${mondayOf(dates[0])}T12:00:00Z`) + 28 * DAY).toISOString().slice(0, 10);
    if (today >= week5 && dates.at(-1) >= week5) {
      const later = new Set([...all.values()].filter((r) => r.game_date >= week5).flatMap((r) => [slugify(r.home), slugify(r.away)]));
      const idle = [...programs].filter((p) => !later.has(p));
      if (idle.length) soft.push(`${season}: ${idle.length} program(s) with no game after week 4: ${idle.slice(0, 25).join(", ")}${idle.length > 25 ? ", …" : ""}`);
    }
  }
  if (current) {
    // Soft: a playoff game outside the week most of its round is played in.
    for (const [round, rows] of Map.groupBy(playoffs, (r) => `${r.league} ${r.round}`)) {
      const weeks = Map.groupBy(rows, (r) => mondayOf(r.game_date));
      const usual = [...weeks].sort((a, b) => b[1].length - a[1].length)[0][0];
      for (const r of rows) if (mondayOf(r.game_date) !== usual) soft.push(`${season} ${round}: outside the round's usual week (of ${usual}): ${line(r)}`);
    }
  }
  return { hard, soft };
}

/**
 * Hard problems less the reviewed exceptions; an exception that matches no problem is itself a problem (the fix landed,
 * or the key is wrong), so the list never hides a new one.
 * @param {{key: string, text: string}[]} hard
 * @param {{key: string, reason: string, reviewed: string}[]} exceptions
 */
export function applyExceptions(hard, exceptions) {
  const keys = new Set(hard.map((h) => h.key));
  const excused = new Set(exceptions.map((e) => e.key));
  return {
    failures: [
      ...hard.filter((h) => !excused.has(h.key)).map((h) => h.text),
      ...exceptions.filter((e) => !keys.has(e.key)).map((e) => `stale exception in data/integrity-exceptions.json (no such problem now; remove it): ${e.key}`),
    ],
    excused: hard.filter((h) => excused.has(h.key)).map((h) => `${h.text} [known: ${exceptions.find((e) => e.key === h.key).reason}]`),
  };
}
