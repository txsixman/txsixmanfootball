import type { Corrections } from "./corrections.ts";
import { applyToGame } from "./corrections.ts";
import { parseCsv, PlayedGameRow, RESULT_COLUMNS } from "./data-schemas.ts";
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
 * bracket page id. A fixed score stays unconfirmed like every robot-read result (ADR 0011). Pure: no file access.
 */
export function buildSeasonResults(
  season: number,
  text: string,
  fixes: Corrections,
  playoffPages: Map<string, string>,
  gameKey: (date: string, home: string, away: string) => string,
): { results: SeasonResult[]; voided: number } {
  let voided = 0;
  const results = parseCsv(`data/seed/maxpreps-${season}/games.csv`, text, RESULT_COLUMNS, PlayedGameRow).flatMap(({ row: parsed }) => {
    const fixed = applyToGame(fixes, parsed);
    if (!fixed) {
      voided += 1;
      return [];
    }
    const r = fixed.row;
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
  return { results, voided };
}

/**
 * Games each team played: one for every result of `results` it is in, a forfeit too (it counts in the record). Through
 * `through` (an ISO date, a week's Sunday) when given. This is the "played" half of "played, rated" on the rankings and
 * program pages; "rated" is the ratings table's own `rated` (services/ratings/run.py), never counted here.
 */
export function playedCounts(results: Pick<SeasonResult, "home" | "away" | "date">[], through?: string): Map<string, number> {
  const played = new Map<string, number>();
  for (const g of results) {
    if (through && g.date > through) continue;
    for (const team of [g.home, g.away]) played.set(team, (played.get(team) ?? 0) + 1);
  }
  return played;
}
