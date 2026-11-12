import { readFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "./slug";
import { FINAL_COLUMNS, FinalRow, NO_FINAL_COLUMNS, NoFinalRow, parseCsv } from "./data-schemas";

// UIL six-man state finals, written by tools/history/uil-champions.mjs from UIL's own archive. Read at build time.
// The CSV keeps each row's source URL; pages do not show it (ADR 0010).

export type Final = {
  season: number;
  /** "1A", or "" when UIL's record names no class. */
  conference: string;
  /** "I", "II", or "" for a single six-man bracket. */
  division: string;
  champion: string;
  runnerUp: string;
  championScore: number | null;
  runnerUpScore: number | null;
  /** "Mercy Rule 3Q", "OT" and the like, as UIL notes it. */
  scoreNote: string;
  notes: string;
};

export async function loadFinals(): Promise<Final[]> {
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), "../../data/seed/uil-champions/six-man.csv"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const n = (v: string) => (v === "" ? null : Number(v));
  return parseCsv("data/seed/uil-champions/six-man.csv", text, FINAL_COLUMNS, FinalRow).map(({ row: r }) => ({
    season: Number(r.season), conference: r.conference, division: r.division, champion: r.champion, runnerUp: r.runner_up,
    championScore: n(r.champion_score), runnerUpScore: n(r.runner_up_score), scoreNote: r.score_note, notes: r.notes,
  }));
}

/** "69-22", "69-22 (Mercy Rule 3Q)", or "Forfeit"-style notes when no score was played. */
export function finalScore(f: Final): string {
  if (f.championScore == null) return f.scoreNote || "—";
  const score = `${f.championScore}-${f.runnerUpScore}`;
  return f.scoreNote ? `${score} (${f.scoreNote})` : score;
}

/** Titles by program, most first, then by the most recent title. `successors` (lib/lineage.ts `successorOf`) counts a
 * merged or renamed school's titles under the program it became, the way its program page does. */
export function titleCounts(finals: Final[], successors: ReadonlyMap<string, string>): { school: string; titles: number; last: number }[] {
  const by = new Map<string, { school: string; titles: number; last: number }>();
  for (const f of finals) {
    const school = successors.get(slugify(f.champion)) ?? f.champion;
    const row = by.get(school) ?? { school, titles: 0, last: 0 };
    row.titles += 1;
    row.last = Math.max(row.last, f.season);
    by.set(school, row);
  }
  return [...by.values()].sort((a, b) => b.titles - a.titles || b.last - a.last || a.school.localeCompare(b.school));
}

/** Six-man seasons UIL lists with no state final, and the round its playoffs stopped at. */
export async function loadNoFinal(): Promise<{ season: number; playedTo: string }[]> {
  let text: string;
  try {
    text = await readFile(path.join(process.cwd(), "../../data/seed/uil-champions/six-man-no-final.csv"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return parseCsv("data/seed/uil-champions/six-man-no-final.csv", text, NO_FINAL_COLUMNS, NoFinalRow).map(({ row }) => ({
    season: Number(row.season),
    playedTo: row.played_to,
  }));
}

/** "bi-district from 1941 to 1967, regionals from 1968 to 1971": consecutive runs of the same last round. */
export function noFinalSpans(rows: { season: number; playedTo: string }[]): { playedTo: string; from: number; to: number }[] {
  const spans: { playedTo: string; from: number; to: number }[] = [];
  for (const r of [...rows].sort((a, b) => a.season - b.season)) {
    const last = spans.at(-1);
    if (last && last.playedTo === r.playedTo) last.to = r.season;
    else spans.push({ playedTo: r.playedTo, from: r.season, to: r.season });
  }
  return spans;
}
