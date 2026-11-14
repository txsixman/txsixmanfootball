import type { BracketRow } from "./brackets";
import { project, type Projection } from "./projection";
import type { RatingsTable } from "./ratings";

// Where a bracket goes next, from the ratings. The data lists only games that are on the schedule, so the next round
// is known only where two of this round's games must meet: the two semifinals (their winners play the final), and two
// area games of one UIL region (their winners play the regional final; the same closure lib/title-chances.ts rests on).
// Nothing is shown past that: who else meets whom is not in the data. Words: projected margin and chance to win.

/** Round -> the rounds that its two paired games lead to. */
const NEXT_ROUNDS: Record<string, string[]> = { semifinal: ["final", "state"], area: ["regional"] };

/** Two unplayed games of one round whose winners meet next, with no game of that next round listed for any of the four teams. */
export type Pair = { next: string; region?: string; games: [BracketRow, BracketRow] };

type RoundRows = { round: string; games: BracketRow[] };

export function pairsOf(rounds: RoundRows[], regionOf?: (team: string) => string | undefined): Pair[] {
  const out: Pair[] = [];
  for (const [round, nexts] of Object.entries(NEXT_ROUNDS)) {
    const all = rounds.find((r) => r.round === round)?.games ?? [];
    // A semifinal pair is the whole round; an area pair is two games of one region (a game linking regions has none).
    const groups = Map.groupBy(
      all.filter((g) => g.homeScore == null),
      (g) => (round === "area" ? (regionOf?.(g.home) === regionOf?.(g.away) ? regionOf?.(g.home) : undefined) : "") ?? null,
    );
    for (const [region, list] of groups) {
      if (region === null || list.length !== 2 || (round === "semifinal" && all.length !== 2)) continue;
      const teams = new Set(list.flatMap((g) => [g.home, g.away]));
      const listed = rounds.some((r) => nexts.includes(r.round) && r.games.some((g) => teams.has(g.home) || teams.has(g.away)));
      if (teams.size === 4 && !listed) out.push({ next: nexts[0], ...(region ? { region } : {}), games: [list[0], list[1]] });
    }
  }
  return out;
}

/** The chance `side` wins `g` at its own site, or undefined when either team is unrated. */
function winChance(table: RatingsTable, g: BracketRow, side: string): number | undefined {
  const p = project(table, g.home, g.away, g.neutral);
  return p && (p.favorite === side ? p.winProbability : 1 - p.winProbability);
}

/** A possible opponent in the next round: its chance to get there, and the projection against `team` on a neutral field. */
export type Candidate = { team: string; reach: number; projection: Projection };

/** `team`'s likely opponents in the round after its listed game, most likely first; undefined when `team` is in no pair or a team is unrated. */
export function aheadFor(table: RatingsTable, pair: Pair, team: string): { next: string; candidates: Candidate[] } | undefined {
  const mine = pair.games.find((g) => g.home === team || g.away === team);
  const other = pair.games.find((g) => g !== mine);
  if (!mine || !other) return undefined;
  const candidates: Candidate[] = [];
  for (const o of [other.home, other.away]) {
    const [reach, projection] = [winChance(table, other, o), project(table, team, o, true, true)];
    if (reach == null || !projection) return undefined;
    candidates.push({ team: o, reach, projection });
  }
  return { next: pair.next, candidates: candidates.sort((a, b) => b.reach - a.reach) };
}

/** The pairing if the higher-rated team wins each game of the pair, with each side's chance to get there and the projection for that meeting. */
export function previewOf(table: RatingsTable, pair: Pair): { sides: [{ team: string; reach: number }, { team: string; reach: number }]; projection: Projection } | undefined {
  const sides = pair.games.map((g) => project(table, g.home, g.away, g.neutral));
  if (!sides[0] || !sides[1]) return undefined;
  const projection = project(table, sides[0].favorite, sides[1].favorite, true, true);
  return projection && { sides: [{ team: sides[0].favorite, reach: sides[0].winProbability }, { team: sides[1].favorite, reach: sides[1].winProbability }], projection };
}

/** What `team` has played in a bracket's rounds, and what is listed ahead: its games in round order. */
export function gamesOf(rounds: (RoundRows & { label: string })[], team: string) {
  return rounds.flatMap((r) =>
    r.games.filter((g) => g.home === team || g.away === team).map((game) => ({ round: r.round, label: r.label, game, opponent: game.home === team ? game.away : game.home, home: game.home === team })),
  );
}
