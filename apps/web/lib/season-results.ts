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
  /** The row is marked a neutral site (games.csv `neutral` "true"). */
  neutral?: boolean;
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
 * data should have none). `playoffSides` gives a playoff game's home and away as its page orders them (by the same key): a
 * result written the other way round has its sides and scores swapped, so every page agrees on the home side (ADR 0079); its
 * `id` stays as games.csv wrote it. Pure: no file access.
 */
export function buildSeasonResults(
  season: number,
  text: string,
  fixes: Corrections,
  playoffPages: Map<string, string>,
  gameKey: (date: string, home: string, away: string) => string,
  playoffSides: Map<string, { home: string; away: string }> = new Map(),
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
    const page = playoffSides.get(gameKey(r.game_date, r.home, r.away));
    const flip = !!page && slugify(page.home) === slugify(r.away) && slugify(page.away) === slugify(r.home);
    const [home, away, homeScore, awayScore] = flip ? [r.away, r.home, r.away_score, r.home_score] : [r.home, r.away, r.home_score, r.away_score];
    return [
      {
        id,
        href: `/scores/${playoffPages.get(gameKey(r.game_date, r.home, r.away)) ?? id}`,
        date: r.game_date,
        status: shortDate(r.game_date),
        home,
        away,
        homeScore: Number(homeScore),
        awayScore: Number(awayScore),
        forfeit: forfeitScore(Number(homeScore), Number(awayScore)),
        ...(r.neutral === "true" ? { neutral: true } : {}),
      },
    ];
  });
  return { results, voided, duplicates: copies.size };
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
