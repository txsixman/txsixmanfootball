import type { Corrections } from "./corrections.ts";
import { applyToGame } from "./corrections.ts";
import { parseCsv, PlayedGameRow, RESULT_COLUMNS } from "./data-schemas.ts";
import { duplicateRows } from "./duplicate-game.ts";
import { forfeitScore } from "./forfeit.ts";
import { slugify } from "./slug.ts";

/** A result read from MaxPreps (ADR 0008): unconfirmed, so pages show the score but never crown a winner. */
/** `forfeit`: recorded 1-0 or 2-0, the way the source writes a forfeit; pages show the word, never the score (ADR 0004). */
/** `id`: the game's own key (`<date>-<away>-at-<home>`, unique across seasons: the date carries the year), used to match it
 * to its projection. `href`: its page. A current-season playoff game is also a bracket game with its own page
 * (`<season>-<round>-<away>-at-<home>`, loadGames), so it links there and has no second page; every other game is its own page. */
export type SeasonResult = {
  id: string; href: string; date: string; status: string; home: string; away: string; homeScore: number; awayScore: number; forfeit: boolean;
};


function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * A season's games.csv text → its results, with the corrections applied (data/corrections, lib/corrections.ts): program
 * names merged, scores fixed, and a game voided as listed in error left out, so it has no result and no page of its own
 * (lib/game-pages.ts builds every game page from these). `playoffPages` maps a current-season playoff game's key to its
 * bracket page id. A fixed score stays unconfirmed like every robot-read result (ADR 0011). A game listed twice (the same two
 * teams, the same score, at most two days apart: lib/duplicate-game.ts) is one game, the earlier row, so a team never lists
 * more games than its record counts; `duplicates` says how many were folded (check-data fails on one in the files, so the
 * data should have none). Pure: no file access.
 */
export function buildSeasonResults(
  season: number,
  text: string,
  fixes: Corrections,
  playoffPages: Map<string, string>,
  gameKey: (date: string, home: string, away: string) => string,
): { results: SeasonResult[]; voided: number; duplicates: number } {
  let voided = 0;
  const rows = parseCsv(`data/seed/maxpreps-${season}/games.csv`, text, RESULT_COLUMNS, PlayedGameRow).flatMap(({ row: parsed }) => {
    const fixed = applyToGame(fixes, parsed);
    if (!fixed) voided += 1;
    return fixed ? [fixed.row] : [];
  });
  const copies = duplicateRows(rows);
  const results = rows.flatMap((r, i) => {
    if (copies.has(i)) return [];
    const id = `${r.game_date}-${slugify(r.away)}-at-${slugify(r.home)}`;
    return [
      {
        id,
        href: `/scores/${playoffPages.get(gameKey(r.game_date, r.home, r.away)) ?? id}`,
        date: r.game_date,
        status: shortDate(r.game_date),
        home: r.home,
        away: r.away,
        homeScore: Number(r.home_score),
        awayScore: Number(r.away_score),
        forfeit: forfeitScore(Number(r.home_score), Number(r.away_score)),
      },
    ];
  });
  return { results, voided, duplicates: copies.size };
}
