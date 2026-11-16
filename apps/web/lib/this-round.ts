// The round being played in every bracket (/playoffs/this-round, its share card), and the one count every playoff page gives a
// round. Pure, one local import: the node tests run it as it is.
//
// A round holds the games a site lists AND the games the bracket sets before any listing has them (ADR 0047: "set by the
// bracket", from the bi-district winners). Every page that shows a round shows both, so every page counts both: a page that
// counted only the listed games said "2 games" for a UIL area round with 8 (2 listed and 6 the bracket had set).

import { currentRound } from "./playoff-status";

type Counted = { games: unknown[]; built: unknown[] };
type Playable = Counted & { round: string; games: { date: string; homeScore?: number }[] };

/** Every game a round shows: the listed ones, then the ones the bracket sets. */
export const roundTotal = (r: Counted): number => r.games.length + r.built.length;

/** A round's heading count: "16 games", "2 games · 6 more set by the bracket", or "6 games set by the bracket" when no
 * listing has any yet (never "0 games"). */
export function roundCount(r: Counted): string {
  const n = (k: number) => `${k} ${k === 1 ? "game" : "games"}`;
  if (!r.games.length && r.built.length) return `${n(r.built.length)} set by the bracket`;
  return `${n(r.games.length)}${r.built.length ? ` · ${r.built.length} more set by the bracket` : ""}`;
}

/**
 * Each league's brackets with the round their own page opens on (playoff-status.ts currentRound), league by league in the
 * order given, a league with no bracket left out. A bracket a round ahead or behind shows its own round.
 */
export function thisRound<B extends { league: string; rounds: Playable[] }>(brackets: B[], leagues: readonly string[], today: string) {
  return leagues
    .map((league) => ({
      league,
      brackets: brackets.flatMap((b) => {
        const round = b.league === league ? (currentRound(b.rounds, today) as B["rounds"][number] | undefined) : undefined;
        return round ? [{ bracket: b, round }] : [];
      }),
    }))
    .filter((g) => g.brackets.length);
}
