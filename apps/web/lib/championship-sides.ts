// The two sides of a State Championship the bracket sets but no site lists yet. Pure, imports only .ts files: the node tests run it as it is.
//
// The tree node's sides are in slot order (the bracket's first side, then its second); a built game's sides are not: the
// known team is put first (bracket-fill.ts builtGames). Reading one side from the other by index paired a known team that
// sat in the second slot with itself ("Grace Classical Academy vs Grace Classical Academy"). So a known team is read from
// the slot that holds it, and the waiting side keeps the words of its own slot.

import { sideText, type Side } from "./bracket-fill.ts";
import { orderId } from "./page-id.ts";

type Slot = { text: string; title?: string; team?: string };
export type ChampionshipSide = { team?: string; text: string };

/** The two sides in slot order: a team where the slot has one, else the slot's waiting words ("Winner of SF2", "To be decided"),
 * else (no tree box) the built game's own side in its order, known team first. */
export function championshipSides(node: { sides: [Slot, Slot] } | undefined, built: { sides: [Side, Side] } | undefined): [ChampionshipSide, ChampionshipSide] {
  const side = (i: 0 | 1): ChampionshipSide => {
    const t = node?.sides[i];
    if (t?.team) return { team: t.team, text: t.team };
    if (t) return { text: t.title ?? t.text };
    const s = built?.sides[i];
    return s && "team" in s ? { team: s.team, text: s.team } : { text: s ? sideText(s) : "To be decided" };
  };
  return [side(0), side(1)];
}

/** The game page of a State Championship nothing lists yet: only when both teams are known and are two different teams, and
 * the bracket gives the game a page (`orders`, bracket-fill.ts pageOrders), else none. */
export function championshipGameHref(season: number, round: string, sides: [ChampionshipSide, ChampionshipSide], orders: { round: string; home: string; away: string }[]): string | undefined {
  const [a, b] = [sides[0].team, sides[1].team];
  if (!a || !b || a === b) return undefined;
  const order = orders.find((o) => o.round === round && [o.home, o.away].sort().join("|") === [a, b].sort().join("|"));
  return order ? `/scores/${orderId(season, order)}` : undefined;
}
