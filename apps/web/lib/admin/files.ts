import { buildCorrections, type Corrections } from "../corrections.ts";
import {
  GAME_CORRECTION_COLUMNS,
  GameCorrectionRow,
  PROGRAM_MERGE_COLUMNS,
  ProgramMergeRow,
  parseCsv,
} from "../data-schemas.ts";
import { slugify } from "../slug.ts";

// The console's reading and writing of the CSV files, as plain functions (no network, no cookies), so node tests cover them.

export const GAME_HEADER = GAME_CORRECTION_COLUMNS.join(",");
export const PROGRAM_HEADER = PROGRAM_MERGE_COLUMNS.join(",");

type GameCorrection = ReturnType<typeof GameCorrectionRow.parse>;
type ProgramMerge = ReturnType<typeof ProgramMergeRow.parse>;

/** Both correction files' text (either may be empty) → the corrections as the site applies them, and the raw rows (the history). */
export function readCorrections(gamesText: string | null, programsText: string | null): Corrections & { gameRows: GameCorrection[]; mergeRows: ProgramMerge[] } {
  const gameRows = gamesText?.trim() ? parseCsv("data/corrections/games.csv", gamesText, GAME_CORRECTION_COLUMNS, GameCorrectionRow).map((r) => r.row) : [];
  const mergeRows = programsText?.trim() ? parseCsv("data/corrections/programs.csv", programsText, PROGRAM_MERGE_COLUMNS, ProgramMergeRow).map((r) => r.row) : [];
  return { ...buildCorrections(mergeRows, gameRows), gameRows, mergeRows };
}

/**
 * `text` with one row added. The row is checked against the schema, the header must be the file's own, and the WHOLE new
 * file must still parse (and, for merges, still resolve), so an edit can never leave a file the site's build would refuse.
 */
export function appendGameCorrection(text: string, row: Record<string, string>): string {
  const next = appendLine(text, GAME_HEADER, GAME_CORRECTION_COLUMNS, row);
  GameCorrectionRow.parse(row);
  parseCsv("data/corrections/games.csv", next, GAME_CORRECTION_COLUMNS, GameCorrectionRow);
  return next;
}

export function appendProgramMerge(text: string, row: Record<string, string>, gamesText: string | null = null): string {
  const next = appendLine(text, PROGRAM_HEADER, PROGRAM_MERGE_COLUMNS, row);
  ProgramMergeRow.parse(row);
  readCorrections(gamesText, next); // throws on a chain or a loop
  return next;
}

function appendLine(text: string, header: string, columns: string[], row: Record<string, string>): string {
  if (text.split("\n", 1)[0].replace(/\r$/, "") !== header) throw new Error(`the file's header is not "${header}"`);
  const fields = columns.map((c) => {
    const v = row[c];
    if (typeof v !== "string" || /[,\r\n]/.test(v)) throw new Error(`${c} is missing or holds a comma or line break`);
    return v;
  });
  return `${text.endsWith("\n") ? text : `${text}\n`}${fields.join(",")}\n`;
}

// ---- The games the console searches --------------------------------------------------------------------------------

export type AdminGame = { id: string; date: string; home: string; away: string; homeScore: number; awayScore: number };

/** The game's id: the same one the site gives its result (`SeasonResult.id`, lib/games.ts), from the merged team names. */
export const gameId = (date: string, home: string, away: string) => `${date}-${slugify(away)}-at-${slugify(home)}`;

/** A season's games.csv text → its games, team names merged as the site merges them, so ids match the site's. */
export function parseSeasonGames(season: number, text: string | null, merges: Map<string, string>): AdminGame[] {
  // Columns by header name, never position: only game_date, home, away and the two scores are read, so a file with
  // more or fewer columns (the public copy has no source_url or notes) reads the same.
  return csvRecords(text).flatMap((r) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.game_date ?? "") || !r.game_date.startsWith(String(season)) || !/^\d{1,3}$/.test(r.home_score ?? "") || !/^\d{1,3}$/.test(r.away_score ?? "")) return [];
    if (!r.home || !r.away) return [];
    const [home, away] = [merges.get(r.home) ?? r.home, merges.get(r.away) ?? r.away];
    return [{ id: gameId(r.game_date, home, away), date: r.game_date, home, away, homeScore: Number(r.home_score), awayScore: Number(r.away_score) }];
  });
}

/** A plain CSV (no quoted cells, as every robot file is) as one record per row, keyed by the header; rows of the wrong width are skipped. */
function csvRecords(text: string | null): Record<string, string>[] {
  if (!text?.trim()) return [];
  const [head, ...rows] = text.trim().split("\n").map((l) => l.replace(/\r$/, "").split(","));
  return rows.filter((f) => f.length === head.length).map((f) => Object.fromEntries(head.map((h, i) => [h, f[i]])));
}

/** Games on a date (YYYY-MM-DD) and/or with a team whose name holds `q` (case, spacing and punctuation ignored), newest first, at most `limit`. */
export function searchGames(games: AdminGame[], { q, date }: { q?: string; date?: string }, limit = 40): { found: AdminGame[]; more: boolean } {
  const needle = slugify(q ?? "");
  const hits = games
    .filter((g) => (!date || g.date === date) && (!needle || slugify(g.home).includes(needle) || slugify(g.away).includes(needle)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { found: hits.slice(0, limit), more: hits.length > limit };
}

/** The season an id belongs to (its date's year), or null for something that is not a game id. */
export function idSeason(id: string): number | null {
  const m = /^(20\d\d)-\d{2}-\d{2}-[a-z0-9-]+-at-[a-z0-9-]+$/.exec(id);
  return m && id.length <= 200 ? Number(m[1]) : null;
}

/** Every name a season's game files use that is not a listed school (slug compared): what a merge can fold in. */
export function unlistedNames(games: AdminGame[], listed: Set<string>): string[] {
  return [...new Set(games.flatMap((g) => [g.home, g.away]).filter((n) => !listed.has(slugify(n))))].sort();
}

/** The schools an alignments.csv lists (its `school` column, by name). */
export function alignmentSchools(text: string | null): string[] {
  return csvRecords(text).map((r) => r.school ?? "").filter(Boolean);
}
