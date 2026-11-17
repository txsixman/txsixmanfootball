// What is next for a playoff game's winner (ADR 0087). Pure, no imports: the page (app/scores/[id]/whats-next.tsx) hands it
// the bracket's games flattened to entries, and the node tests run it as it is. Only a confirmed winner is ever passed in
// (lib/score-display.ts winnerOf, ADR 0040), so this never names a winner on its own.

/** One game of the bracket, listed by a site or set by the bracket (ADR 0047), reduced to what this needs. A side that is not
 * a team yet carries `null` in `teams` and its words ("winner of Kress–Jayton") in `text`. */
export type NextEntry = {
  round: string;
  label: string;
  teams: [string | null, string | null];
  text: [string, string];
  date?: string;
  kickoff?: string;
  site?: string;
  /** The game's page, when it has one. */
  id?: string;
  /** Present once the game is played: its confirmed winner, or null when it has none (a disputed score, a forfeit). */
  played?: { winner: string | null };
};

export type WhatsNext =
  | { kind: "game"; label: string; opponent: string; known: boolean; date?: string; kickoff?: string; site?: string; id?: string }
  | { kind: "unset"; label: string }
  | { kind: "last" }
  /** Nothing to say: the run ended in a later game, or a later game has no confirmed winner. */
  | { kind: "out" };

/**
 * `winner` went through `round` of a bracket whose rounds, in order, are `rounds` (every round of its shape, played or not).
 * Follows the winner's games: a later game already played that it won moves on to the one after, a later game it lost or
 * with no confirmed winner says nothing more. The earliest game still to play that lists the winner, with the other side as
 * the data has it; else the next round, not set yet; else nothing is left (the last round).
 */
export function whatsNext({ round, winner, rounds, entries, labelOf }: { round: string; winner: string; rounds: string[]; entries: NextEntry[]; labelOf: (round: string) => string }): WhatsNext {
  let at = rounds.indexOf(round);
  if (at < 0) return { kind: "last" };
  for (;;) {
    const mine = entries
      .filter((e) => rounds.indexOf(e.round) > at && e.teams.includes(winner))
      .sort((a, b) => rounds.indexOf(a.round) - rounds.indexOf(b.round) || (a.date ?? "9999").localeCompare(b.date ?? "9999"))[0];
    if (!mine) return at + 1 < rounds.length ? { kind: "unset", label: labelOf(rounds[at + 1]) } : { kind: "last" };
    if (mine.played) {
      if (mine.played.winner !== winner) return { kind: "out" };
      at = rounds.indexOf(mine.round);
      continue;
    }
    const other = mine.teams[0] === winner ? 1 : 0;
    return { kind: "game", label: mine.label, opponent: mine.text[other], known: mine.teams[other] !== null, date: mine.date, kickoff: mine.kickoff, site: mine.site, id: mine.id };
  }
}
