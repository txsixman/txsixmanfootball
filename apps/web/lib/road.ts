// A team's road to the State Championship (ADR 0104): for each round it has still to play, the chance it gets there and wins,
// and who it could meet, each with the chance of being there and the projected margin. Worked out from the same slot-by-slot
// shares as the chance to reach each round (lib/advancement.ts, ADR 0071), so the two cannot disagree: a team's chance to
// reach a round is its side's share in that round's slot, its chance to win it is that slot's winner share, and its
// opponents are the other side's shares. A confirmed final (ADR 0040) settles a game and nothing else does: a score no
// source confirms advances no one, and the game stays on the road. A team whose last settled game is a loss is out. Pure,
// no imports beyond the bracket math: the site's build and the node tests run it as it is.
import { fill, type FillGame, type Slot } from "./bracket-fill.ts";
import { slotShares, type WinChance } from "./advancement.ts";
import type { Projection } from "./projection.ts";

/** Most opponents named a round; the rest are counted. */
const MAX_OPPONENTS = 3;

/** A team that could be on the other side of a round's game: its chance of being there, and the projection of the meeting
 * (at the listed game's own site, else on a neutral field; none when either team has too few rated games). */
type Opponent = { team: string; reach: number; projection?: Projection };

export type RoadStep<G> = {
  slot: string;
  round: string;
  /** "bye": the team's side meets a bye here, so it goes on without playing. */
  kind: "game" | "bye";
  /** The game a site lists for this slot, if any. */
  game?: G;
  /** The listed game has a score no source confirms: it is not settled and names no winner (ADR 0004). */
  reported?: true;
  /** The chance the team plays in this round, and the chance it wins its game there; undefined when some team in the way
   * has too few rated games to project (nothing is guessed). */
  reach?: number;
  win?: number;
  /** Most likely opponent first. Empty for a bye, or when who the opponent could be cannot be projected (`unknown`). */
  opponents: Opponent[];
  /** The other teams that could be there, and the chance that it is one of them. */
  more?: { count: number; reach: number };
  unknown?: true;
  /** What the bracket file lists for a slot no site lists a game for yet (UIL's bracket: kickoff in UTC and site). */
  kickoff_utc?: string;
  site?: string;
};

/** alive: still in; out: lost a confirmed final, in `outRound`; champion: won the State Championship. */
export type Road<G> = { team: string; state: "alive" | "out" | "champion"; outRound?: string; byes: string[]; steps: RoadStep<G>[] };

/**
 * Every team's road in one bracket. `win` is the per-game chance of lib/win-chance.ts and `project` the projection it
 * rests on (a listed game at its own site, else a neutral field). `steps` are the rounds still to play, first to last: the
 * first is the team's next game. A team with a bye keeps the round in `byes` and plays on from the next.
 */
export function roads<G extends FillGame>(
  slots: Slot[], games: G[], order: readonly string[], win: WinChance<G>,
  project: (a: string, b: string, game?: G) => Projection | undefined, finalRounds: ReadonlySet<string>,
): Map<string, Road<G>> {
  const shares = slotShares(slots, games, order, win);
  const filled = new Map(fill(slots, games, order).map((f) => [f.slot.slot, f]));
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const rank = (round: string) => order.indexOf(round);
  const teams = new Set(shares.flatMap((s) => s.could.flatMap((c) => [...c])));
  const out = new Map<string, Road<G>>();
  for (const team of [...teams].sort()) {
    const mine = shares.filter((s) => s.could.some((c) => c.has(team))).sort((x, y) => rank(x.round) - rank(y.round));
    const road: Road<G> = { team, state: "alive", byes: [], steps: [] };
    for (const s of mine) {
      const f = filled.get(s.slot)!;
      const bye = "bye" in f.a || "bye" in f.b;
      if (f.winner) {
        if (f.winner !== team) {
          Object.assign(road, { state: "out", outRound: s.round, steps: [] });
          break;
        }
        if (bye) road.byes.push(s.round);
        else if (finalRounds.has(s.round)) road.state = "champion";
        continue;
      }
      const i = s.could[0].has(team) ? 0 : 1;
      const [side, other] = [s.sides[i], s.sides[1 - i]];
      const g = f.game as G | undefined;
      const def = bySlot.get(s.slot);
      const base = {
        slot: s.slot, round: s.round, ...(g ? { game: g } : {}), ...(g && g.homeScore != null ? { reported: true as const } : {}),
        ...(def?.kickoff_utc ? { kickoff_utc: def.kickoff_utc } : {}), ...(def?.site ? { site: def.site } : {}),
        ...(side ? { reach: side.get(team) ?? 0 } : {}), ...(s.winner ? { win: s.winner.get(team) ?? 0 } : {}),
      };
      if (bye) road.steps.push({ ...base, kind: "bye", opponents: [] });
      else if (!other) road.steps.push({ ...base, kind: "game", opponents: [], unknown: true });
      else {
        const all = [...other].filter(([, p]) => p > 0).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
        const opponents = all.slice(0, MAX_OPPONENTS).map(([o, p]): Opponent => {
          const projection = win(team, o, g) == null ? undefined : project(team, o, g);
          return { team: o, reach: p, ...(projection ? { projection } : {}) };
        });
        const rest = all.slice(MAX_OPPONENTS);
        road.steps.push({ ...base, kind: "game", opponents, ...(rest.length ? { more: { count: rest.length, reach: rest.reduce((n, [, p]) => n + p, 0) } } : {}) });
      }
    }
    out.set(team, road);
  }
  return out;
}
