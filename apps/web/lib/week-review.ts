import type { Projection } from "./projection";
import type { SeasonResult } from "./season-results";

// The week in review's pure rules: which games are closest, which results sit furthest from the week-before projection,
// which ratings moved most, and which teams a playoff round sent on. No file access, so the node tests run it as it is.
// Words (ADRs 0004, 0013): a result is described by how far
// it sits from the projection, never by who won; advancement is read from the later round's own games, as the bracket pages
// show it. Ratings, projected margin and win probability are the only numbers.

const DAY = 86_400_000;

/** The Sunday of the week that starts on `monday` ("YYYY-MM-DD"). */
export const weekEnd = (monday: string) => new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * DAY).toISOString().slice(0, 10);

/** A game with a score worth comparing: never a forfeit (recorded 1-0 or 2-0) and never 0-0 (a no contest). */
const played = (g: SeasonResult) => !g.forfeit && g.homeScore + g.awayScore > 0;
const points = (g: SeasonResult) => Math.abs(g.homeScore - g.awayScore);
const inOrder = (a: SeasonResult, b: SeasonResult) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** The games decided by the fewest points (a tie is 0), forfeits and no contests left out. */
export const closestGames = (games: SeasonResult[], n = 5): SeasonResult[] =>
  games.filter(played).sort((a, b) => points(a) - points(b) || inOrder(a, b)).slice(0, n);

/** The games decided by the most points, forfeits and no contests left out. */
export const biggestMargins = (games: SeasonResult[], n = 5): SeasonResult[] =>
  games.filter(played).sort((a, b) => points(b) - points(a) || inOrder(a, b)).slice(0, n);

export const marginOf = points;

/** The 45-point rule ends a game there, and a projected margin past it reads "by 45+" (lib/projection.ts): a margin past 45 counts as 45. */
const MERCY = 45;

export type Off = { game: SeasonResult; projection: Projection; gap: number };

/**
 * The games whose final margin sat furthest from the projected margin (`before`: what the ratings said the week before,
 * lib/pregame.ts, which already leaves out ties, forfeits and teams with fewer than four games). `gap` is in points, on
 * the projected favorite's side: a favorite projected by 12 who finished 9 down is 21 from the projection, as is one who
 * finished 33 up. A margin past 45 counts as 45 (the 45-point rule). It says how far the result was from the projection, never which team won (ADR 0004). A gap that rounds to
 * under a point is not listed.
 */
export function furthestFromProjection(games: SeasonResult[], before: Map<string, Projection>, n = 5): Off[] {
  return games
    .flatMap((game) => {
      const projection = before.get(game.id);
      if (!projection || !played(game)) return [];
      const favoriteMargin = projection.favorite === game.home ? game.homeScore - game.awayScore : game.awayScore - game.homeScore;
      const gap = Math.abs(Math.min(favoriteMargin, MERCY) - Math.min(projection.margin, MERCY));
      return Math.round(gap) >= 1 ? [{ game, projection, gap }] : [];
    })
    .sort((a, b) => b.gap - a.gap || inOrder(a.game, b.game))
    .slice(0, n);
}

export type Mover = { team: string; rating: number; was: number; change: number };

/**
 * The teams whose rating rose or fell most over a week: `rating` at the end of the week against `was` at its start.
 * A team counts only when it was rated at both ends and has `few` or more rated games, so one early result does not fill
 * the list. A change that rounds to 0.0 is not a move.
 */
export function ratingMovers(
  rows: { team: string; rating: number; was?: number | null; rated: number }[],
  few: number,
  n = 5,
): { rises: Mover[]; drops: Mover[] } {
  const moves = rows.flatMap((r) =>
    r.was != null && r.rated >= few && Math.abs(r.rating - r.was) >= 0.05 ? [{ team: r.team, rating: r.rating, was: r.was, change: r.rating - r.was }] : [],
  );
  return {
    rises: moves.filter((m) => m.change > 0).sort((a, b) => b.change - a.change || a.team.localeCompare(b.team)).slice(0, n),
    drops: moves.filter((m) => m.change < 0).sort((a, b) => a.change - b.change || a.team.localeCompare(b.team)).slice(0, n),
  };
}

/** A bracket as the Playoffs pages hold it: rounds earliest first, each with its games (lib/brackets.ts). */
type BracketRounds = {
  name: string;
  league: string;
  rounds: { round: string; label: string; games: { home: string; away: string; date: string; homeScore?: number }[] }[];
};

export type Advance = {
  bracket: string;
  round: string;
  label: string;
  /** Games of this round played in the week. */
  games: number;
  /** True when no later round is listed in the bracket at all (the last round). */
  last: boolean;
  /** Teams of those games with a game in a later round, grouped by the first later round they are listed in. */
  wentOn: { round: string; label: string; teams: string[] }[];
  /** Teams of those games with no later-round game listed (yet). */
  unlisted: number;
};

/**
 * Each bracket round that had a game played between `monday` and `sunday`, and the teams of those games that have a game in a
 * later round of the same bracket: "who went on" read from the later round's own listing, the way the bracket pages show it
 * (ADR 0013), never from a game row's score. A team with no later game listed is counted, not named: its next game may
 * simply not be on the schedule yet. Brackets in the order given; rounds earliest first.
 */
export function advancement(brackets: BracketRounds[], monday: string, sunday: string): Advance[] {
  return brackets.flatMap((b) =>
    b.rounds.flatMap((r, i): Advance[] => {
      const week = r.games.filter((g) => g.homeScore != null && g.date >= monday && g.date <= sunday);
      if (!week.length) return [];
      const teams = [...new Set(week.flatMap((g) => [g.home, g.away]))];
      const later = b.rounds.slice(i + 1);
      const next = new Map<string, (typeof later)[number]>();
      for (const team of teams) {
        const found = later.find((l) => l.games.some((g) => g.home === team || g.away === team));
        if (found) next.set(team, found);
      }
      const wentOn = later
        .map((l) => ({ round: l.round, label: l.label, teams: teams.filter((t) => next.get(t) === l).sort((a, b) => a.localeCompare(b)) }))
        .filter((w) => w.teams.length);
      return [{ bracket: b.name, round: r.round, label: r.label, games: week.length, last: !later.length, wentOn, unlisted: teams.length - next.size }];
    }),
  );
}
