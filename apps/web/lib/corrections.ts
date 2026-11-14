import type { z } from "zod";
import type { GameCorrectionRow, ProgramMergeRow } from "./data-schemas";

// Applying data/corrections/ to the game files (the admin console writes them; lib/admin). Pure: no file access, no
// imports but types, so the site (lib/games.ts), the console and the node tests all run these same functions.
// TWIN: services/ratings/corrections.py does the same to the rows the ratings read. Change one, change the other.
//
//   merge   a name some game file spells that no alignment lists → the listed program it is. Applied first, to every
//           team name in every game row (and in the game corrections' own names), so everything downstream sees one name.
//   game    one row per game (the LAST row for a game wins): `score`/`forfeit` set the score, `void` drops the game.
//           A corrected final is confirmed like any final (ADR 0040, superseding ADR 0011 there); `corrected` marks it.

export type GameCorrection = z.output<typeof GameCorrectionRow>;
export type ProgramMerge = z.output<typeof ProgramMergeRow>;

/** The fields of a game row a correction reads or changes (the files' own column names). */
export type GameFields = { game_date: string; home: string; away: string; home_score: string; away_score: string; end_reason: string };

export type Corrections = { merges: Map<string, string>; games: Map<string, GameCorrection> };

export const NO_CORRECTIONS: Corrections = { merges: new Map(), games: new Map() };

/** The key one game answers to: its date and both teams, either way round (names exactly as the files spell them). */
export const correctionKey = (date: string, a: string, b: string) => [date, ...[a, b].sort()].join("|");

/**
 * Merge rows → name → program, the last row for a name winning. A merge must point at a name no merge retires, so a
 * chain (A is B, B is C) or a loop is refused rather than followed.
 */
export function resolveMerges(rows: ProgramMerge[]): Map<string, string> {
  const merges = new Map<string, string>();
  for (const r of rows) merges.set(r.name, r.same_as);
  for (const [name, target] of merges) {
    if (merges.has(target)) throw new Error(`merge ${name} -> ${target}: ${target} is itself merged into ${merges.get(target)}`);
  }
  return merges;
}

const canonicalName = (merges: Map<string, string>, name: string) => merges.get(name) ?? name;

/** Build the lookup from the two files' rows (either may be empty). */
export function buildCorrections(merges: ProgramMerge[], games: GameCorrection[]): Corrections {
  const resolved = resolveMerges(merges);
  const byGame = new Map<string, GameCorrection>();
  for (const g of games) {
    const [home, away] = [canonicalName(resolved, g.home), canonicalName(resolved, g.away)];
    byGame.set(correctionKey(g.game_date, home, away), { ...g, home, away });
  }
  return { merges: resolved, games: byGame };
}

/**
 * One game row with the corrections applied: team names merged, then the game's fix (if any). `null` means the game
 * was voided and is left out. `corrected` is true when a game fix changed the row. A fix names its teams the way the
 * row does; if the row lists them the other way round (home and away swapped) the score is swapped to match.
 */
export function applyToGame<T extends GameFields>(c: Corrections, row: T): { row: T; corrected: boolean } | null {
  const home = canonicalName(c.merges, row.home);
  const away = canonicalName(c.merges, row.away);
  const merged = home === row.home && away === row.away ? row : { ...row, home, away };
  const fix = c.games.get(correctionKey(row.game_date, home, away));
  if (!fix) return { row: merged, corrected: false };
  if (fix.action === "void") return null;
  const flipped = fix.home !== home;
  return {
    row: {
      ...merged,
      home_score: flipped ? fix.away_score : fix.home_score,
      away_score: flipped ? fix.home_score : fix.away_score,
      end_reason: fix.action === "forfeit" ? "forfeit" : "unknown",
    },
    corrected: true,
  };
}
