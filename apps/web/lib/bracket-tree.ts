// What each box of the tree view holds (ADR 0049): every slot of a bracket with its two sides, filled as far as the games
// go: a team (with its score once played, bold when it won a confirmed final), the winner of an earlier game ("Winner of
// G17", or "Winner of Kress–Jayton" where the bracket has no codes), or a bye. Pure, no imports beyond the bracket math:
// the page, the exported image and the node tests all run it as it is.
import { candidates, fill, type FillGame, type Slot } from "./bracket-fill.ts";
import type { TreeNode } from "./bracket-layout.ts";

/** One side of a box. `text` is what it reads: the team, "Winner of G17", "To be decided" or "Bye". */
type TreeSide = { text: string; team?: string; score?: number; won?: boolean; bye?: true };

/**
 * final: a confirmed final (ADR 0040; a forfeit shows the word, never its score). disputed: a final the sources give
 * different winners, so no winner. upcoming: listed, not played. open: not listed yet. bye: one side is a bye.
 */
export type TreeState = "final" | "disputed" | "upcoming" | "open" | "bye";

export type TreeGame<G extends FillGame = FillGame> = TreeNode & {
  round: string;
  /** The league's own code for the slot ("G17", "NQ1"), when it has one. */
  code?: string;
  sides: [TreeSide, TreeSide];
  state: TreeState;
  game?: G;
  /** A date and site the league's bracket lists for a slot no site lists a game for yet. */
  kickoff_utc?: string;
  site?: string;
};

/** A league's own code, not one the data made up for a listed game or the closing final. */
const ownCode = (slot: string) => !slot.startsWith("game:") && !slot.startsWith("closed:");

/** Each slot of a bracket as a box of the tree, in `order` of rounds (first to last). */
export function treeGames<G extends FillGame>(slots: Slot[], games: G[], order: readonly string[]): TreeGame<G>[] {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const filled = fill(slots, games, order);
  const byId = new Map(filled.map((f) => [f.slot.slot, f]));
  /** What a side fed by another slot reads before its team is known. */
  const waiting = (id: string): TreeSide => {
    if (ownCode(id)) return { text: `Winner of ${id}` };
    const g = byId.get(id)?.game;
    return { text: g ? `Winner of ${g.away}–${g.home}` : "To be decided" };
  };
  return filled.map((f): TreeGame<G> => {
    const s = f.slot;
    const g = f.game as G | undefined;
    const feeds = [s.a, s.b].map((x) => ("winnerOf" in x && bySlot.has(x.winnerOf) ? x.winnerOf : null)) as [string | null, string | null];
    const played = g?.homeScore != null && g.awayScore != null;
    const teamSide = (team: string): TreeSide => {
      const score = g && played && !g.forfeit ? (team === g.home ? g.homeScore : g.awayScore) : undefined;
      return { text: team, team, ...(score != null ? { score } : {}), ...(played && f.winner === team ? { won: true } : {}) };
    };
    let sides: [TreeSide, TreeSide];
    if (g) {
      // The listed game's teams, each on the side of the bracket it came from.
      const first = candidates(s.a, bySlot).has(g.home) ? g.home : candidates(s.a, bySlot).has(g.away) ? g.away : candidates(s.b, bySlot).has(g.home) ? g.away : g.home;
      sides = [teamSide(first), teamSide(first === g.home ? g.away : g.home)];
    } else {
      const side = (feed: Slot["a"], known: (typeof f)["a"]): TreeSide =>
        "team" in known ? teamSide(known.team) : "bye" in known ? { text: "Bye", bye: true } : waiting("winnerOf" in feed ? feed.winnerOf : "");
      sides = [side(s.a, f.a), side(s.b, f.b)];
    }
    const state: TreeState = sides.some((x) => x.bye) ? "bye" : g && played ? (g.confirmed ? "final" : "disputed") : g ? "upcoming" : "open";
    return {
      id: s.slot, feeds, round: s.round, sides, state,
      ...(ownCode(s.slot) ? { code: s.slot } : {}),
      ...(s.group ? { group: s.group } : {}),
      ...(g ? { game: g } : {}),
      ...(!g && s.kickoff_utc ? { kickoff_utc: s.kickoff_utc } : {}),
      ...(!g && s.site ? { site: s.site } : {}),
    };
  });
}
