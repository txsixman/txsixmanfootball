// A program's history from its games and each season's ratings table. Pure: no file access and no imports but types, so
// node can test it directly (scripts/program-history.test.mjs). lib/program-seasons.ts feeds it the data.

/** One game of a school from its own side. `forfeit`: recorded 1-0 or 2-0 (lib/forfeit.ts); a page shows the word, never the score. */
export type Meeting = { opponent: string; date: string; us: number; them: number; forfeit: boolean };
export type Tally = { won: number; lost: number; tied: number };
/** A school's record against one opponent. `last`: the latest meeting. */
export type Rivalry = Tally & { opponent: string; games: number; last: Meeting };

// ADR 0013: W-L records may come from unconfirmed robot-read scores, so a game counts for whoever scored more, with the
// pages' note that scores are not confirmed here. A forfeit (recorded 1-0 or 2-0) counts as a win or a loss like any
// other result; its row shows the word, never the score (ADR 0004). A game row itself names no winner.
export function tally(games: Pick<Meeting, "us" | "them">[]): Tally {
  return {
    won: games.filter((g) => g.us > g.them).length,
    lost: games.filter((g) => g.us < g.them).length,
    tied: games.filter((g) => g.us === g.them).length,
  };
}

/** The record against each opponent met, most played first, then the most recently met, then by name. */
export function opponentRecords(meetings: Meeting[]): Rivalry[] {
  return [...Map.groupBy(meetings, (m) => m.opponent)]
    .map(([opponent, games]) => ({
      opponent,
      games: games.length,
      ...tally(games),
      last: games.reduce((a, b) => (b.date > a.date ? b : a)),
    }))
    .sort((a, b) => b.games - a.games || b.last.date.localeCompare(a.last.date) || a.opponent.localeCompare(b.opponent));
}

/** One season of the table. Every field is null where the data has nothing: a page shows a dash, never a guess. */
export type SeasonLine = {
  season: number;
  /** Games read for the school that season. */
  games: number;
  record: Tally | null;
  rating: number | null;
  /** Rank among its organization's teams that season; null for a team with too few games to be ranked (lib/rank-range.ts). */
  rank: number | null;
  /** Teams ranked in the organization that season. */
  of: number;
  playoff: { round: string; league: string } | null;
};

/**
 * `row`: the school's line of that season's ratings table, if it has one. Its record is the one the rankings pages show;
 * without a row the record comes from the games read, and with neither it is null.
 */
export function seasonLine(input: {
  season: number;
  row?: (Tally & { rating: number }) | undefined;
  meetings: Pick<Meeting, "us" | "them">[];
  rank?: number | undefined;
  of: number;
  playoff?: { round: string; league: string } | undefined;
}): SeasonLine {
  const { season, row, meetings, rank, of, playoff } = input;
  return {
    season,
    games: meetings.length,
    record: row ? { won: row.won, lost: row.lost, tied: row.tied } : meetings.length ? tally(meetings) : null,
    rating: row ? row.rating : null,
    rank: row && rank != null ? rank : null,
    of,
    playoff: playoff ?? null,
  };
}

/** Each season's final rating, oldest first, null where the school had none: the chart breaks its line there. */
export const ratingSeries = (lines: SeasonLine[]) =>
  [...lines].sort((a, b) => a.season - b.season).map((l) => ({ season: l.season, rating: l.rating }));
