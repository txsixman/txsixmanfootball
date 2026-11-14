/** ONE game listed twice. The source sometimes lists a game under two contest ids, one on each team's schedule, a day or two
 * apart (a game that ran past midnight, a date entered in the other team's time zone) and sometimes with the sides swapped.
 *
 * THE RULE: two played rows are one game when the same two teams have the same score (each team's own score, so a row with
 * home and away swapped counts) and their dates are at most DUPLICATE_DAYS apart (the same day too). The earlier date stays,
 * the file order breaks a tie, and a later row is judged only against rows that stayed (so a run of copies a day apart
 * folds into the first, and the one after that is a new game). A row with no score is not a game yet and is never one.
 *
 * TWIN of `classify` in services/ratings/rows.py (kind "duplicate"): change one, change the other (lib/duplicate-cases.json
 * is the table both are tested against: scripts/duplicate-game.test.mjs and services/ratings/test_duplicates.py). The reader
 * (tools/league-watch/maxpreps.mjs), the site's loaders and scripts/check-data.mjs all use this one function. No imports,
 * so every one of them can load it. */
const DUPLICATE_DAYS = 2;

type Played = { game_date: string; home: string; away: string; home_score: string | number; away_score: string | number };

const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;
const hasScore = (r: Played) => r.home_score !== "" && r.away_score !== "";

/** The rows that are a later copy of an earlier one (the indexes into `rows`), and for each the row it copies. */
export function duplicateRows(rows: Played[]): Map<number, number> {
  const copies = new Map<number, number>();
  const stayed = new Map<string, number[]>();
  const order = rows.map((_, i) => i).filter((i) => hasScore(rows[i])).sort((a, b) => rows[a].game_date.localeCompare(rows[b].game_date) || a - b);
  for (const i of order) {
    const r = rows[i];
    const key = [`${r.home}\u0000${Number(r.home_score)}`, `${r.away}\u0000${Number(r.away_score)}`].sort().join("\u0001");
    const first = (stayed.get(key) ?? []).find((j) => Math.abs(day(r.game_date) - day(rows[j].game_date)) <= DUPLICATE_DAYS);
    if (first === undefined) stayed.set(key, [...(stayed.get(key) ?? []), i]);
    else copies.set(i, first);
  }
  return copies;
}
