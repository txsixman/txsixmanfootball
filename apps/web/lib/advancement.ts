// Each team's chance to reach each later round of a bracket and to win its State Championship (ADR 0071), worked out
// exactly up the bracket, slot by slot, from the per-game win chance the game pages show: no sampling. A slot's winner
// is a share of its two sides; a side fed by an earlier slot is that slot's winner shares. A listed game has its own two
// teams and its own site; a confirmed final has its winner, and is never overridden; a slot no site lists yet is on a
// neutral field. A side whose teams cannot all be projected (a team with too few rated games) is left unknown, never
// guessed, and so is everything it feeds. Pure, no imports beyond the bracket math: the site's build and the node tests
// run it as it is.
import { fill, type FillGame, type Slot } from "./bracket-fill.ts";

/** P(`a` beats `b`): at `game`'s own site when it is a listed game, else on a neutral field. undefined when either team
 * cannot be projected. */
export type WinChance<G> = (a: string, b: string, game?: G) => number | undefined;

/** Each team's share of a side or a slot's winner. undefined: some team in it cannot be projected. */
type Shares = Map<string, number>;

/** The most likely team for a side no game sets yet, and its chance to be there. `unknown`: a team that could be there
 * has too few rated games to project. */
export type Projected = { team: string; chance: number } | { unknown: true };

export type Advancement = {
  /** The rounds still to be set, first to last (the table's columns, before "Win the State Championship"). */
  rounds: string[];
  /** The teams still in, most likely champion first. `reach[i]`: the chance to reach `rounds[i]`; `title`: to win the
   * State Championship. undefined: not enough games to project. */
  rows: { team: string; reach: (number | undefined)[]; title: number | undefined }[];
};

/** What every slot holds: each side's shares, and the projected team of a side no game sets yet. */
type SlotShares = {
  slot: string; round: string; sides: [Shares | undefined, Shares | undefined];
  /** The teams that could be on each side (a confirmed final's loser is not), known whether or not they can be projected. */
  could: [Set<string>, Set<string>];
  winner: Shares | undefined; possible: Set<string>; projected: [Projected | undefined, Projected | undefined];
};

const one = (team: string): Shares => new Map([[team, 1]]);

/** The winner of a game between whoever comes out of two sides, on a neutral field. */
function meet<G>(win: WinChance<G>, a: Shares, b: Shares): Shares | undefined {
  const out: Shares = new Map();
  for (const [x, y] of [[a, b], [b, a]] as const) {
    for (const [team, reach] of x) {
      let p = 0;
      for (const [other, share] of y) {
        const w = win(team, other);
        if (w == null) return undefined;
        p += share * w;
      }
      out.set(team, reach * p);
    }
  }
  return out;
}

/** The most likely team of a side, alphabetical on a tie, or unknown. */
const likeliest = (s: Shares | undefined): Projected =>
  !s ? { unknown: true } : [...s].map(([team, chance]) => ({ team, chance })).sort((x, y) => y.chance - x.chance || x.team.localeCompare(y.team))[0];

/** Every slot's shares, in `order` of rounds (first to last). */
export function slotShares<G extends FillGame>(slots: Slot[], games: G[], order: readonly string[], win: WinChance<G>): SlotShares[] {
  const done = new Map<string, SlotShares>();
  for (const f of fill(slots, games, order)) {
    const s = f.slot;
    const g = f.game as G | undefined;
    const feed = (x: Slot["a"]): { shares: Shares | undefined; possible: Set<string>; bye?: true } =>
      "team" in x ? { shares: one(x.team), possible: new Set([x.team]) }
      : "bye" in x ? { shares: new Map(), possible: new Set(), bye: true }
      : done.has(x.winnerOf) ? { shares: done.get(x.winnerOf)!.winner, possible: done.get(x.winnerOf)!.possible }
      : { shares: undefined, possible: new Set() }; // fed by a slot the bracket does not have: nothing known
    let [a, b] = [feed(s.a), feed(s.b)];
    // A listed game has its two teams, whatever the games before it say.
    if (g) [a, b] = [{ shares: one(g.home), possible: new Set([g.home]) }, { shares: one(g.away), possible: new Set([g.away]) }];
    let winner: Shares | undefined;
    if (f.winner) winner = one(f.winner); // a confirmed final, or a bye's one team: never overridden
    else if (a.bye || b.bye) winner = a.bye ? b.shares : a.shares;
    else if (g) {
      // Not played, or played with no winner the sources agree on: the game's own chance at its own site.
      const p = win(g.home, g.away, g);
      winner = p == null ? undefined : new Map([[g.home, p], [g.away, 1 - p]]);
    } else winner = a.shares && b.shares ? meet(win, a.shares, b.shares) : undefined;
    const possible = f.winner ? new Set([f.winner]) : new Set([...a.possible, ...b.possible]);
    // A side is projected when no game sets it: a waiting side with more than one team that could be there.
    const projectedOf = (x: typeof a) => (g || x.bye || x.possible.size <= 1 ? undefined : likeliest(x.shares));
    done.set(s.slot, { slot: s.slot, round: s.round, sides: [a.shares, b.shares], could: [a.possible, b.possible], winner, possible, projected: [projectedOf(a), projectedOf(b)] });
  }
  return [...done.values()];
}

/**
 * The table: every team still in, its chance to reach each round still to be set and to win the State Championship.
 * undefined when the bracket is not one tree under one State Championship slot (its later rounds are not known yet), or
 * when that slot has its winner (the season is over).
 */
export function advancement<G extends FillGame>(slots: Slot[], games: G[], order: readonly string[], win: WinChance<G>, finalRounds: ReadonlySet<string>): Advancement | undefined {
  const shares = slotShares(slots, games, order, win);
  const roots = shares.filter((s) => finalRounds.has(s.round));
  if (roots.length !== 1) return undefined;
  const [root] = roots;
  // One tree: every slot feeds, in the end, the State Championship.
  const feeds = new Map(slots.map((s) => [s.slot, [s.a, s.b].flatMap((x) => ("winnerOf" in x ? [x.winnerOf] : []))]));
  const under = new Set<string>();
  const walk = (id: string) => {
    if (under.has(id)) return;
    under.add(id);
    for (const f of feeds.get(id) ?? []) walk(f);
  };
  walk(root.slot);
  if (under.size !== slots.length) return undefined;
  if (root.possible.size <= 1) return undefined; // the State Championship has its winner
  // A round is set once every slot in it has its two teams: a listed game, or sides with one team each (or a bye).
  const set = (s: SlotShares) => s.could.every((c) => c.size <= 1);
  const rounds = order.filter((r) => shares.some((s) => s.round === r && !set(s)));
  const rows = [...root.possible].map((team) => {
    const reach = rounds.map((r) => {
      const slot = shares.find((s) => s.round === r && s.could.some((c) => c.has(team)));
      if (!slot) return 0;
      const side = slot.sides[slot.could[0].has(team) ? 0 : 1];
      return side && (side.get(team) ?? 0);
    });
    return { team, reach, title: root.winner && (root.winner.get(team) ?? 0) };
  });
  // Most likely champion first, then the furthest round, then the name.
  const key = (x: number | undefined) => x ?? -1;
  const later = (x: (typeof rows)[number], y: (typeof rows)[number]) => {
    for (let i = rounds.length - 1; i >= 0; i--) if (key(x.reach[i]) !== key(y.reach[i])) return key(y.reach[i]) - key(x.reach[i]);
    return 0;
  };
  rows.sort((x, y) => key(y.title) - key(x.title) || later(x, y) || x.team.localeCompare(y.team));
  return { rounds, rows };
}
