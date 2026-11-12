import { FEW_GAMES, type RatingRow } from "./ratings";

// Where a team stands in one list of teams (one organization, or one UIL division: ADR 0012, so callers pass only the
// teams of the page's own group). A rating is an estimate: `sd` is its standard deviation, so rating +/- sd is a span the
// data cannot tell apart from the rating itself. Three plain things follow from it.
//
// Rank: place among the teams with FEW_GAMES or more rated games. A team on fewer is "NR" (not ranked): one result can
// move its rating a long way, so it takes no rank and is left out of everyone else's range.
//
// Rank range: the best and worst place the team would hold if its rating were one sd higher or one sd lower and every
// other team stayed where it is. "#3 to #13" means the ratings cannot separate it from the teams in between.
//
// Tier: teams are walked best first. A tier starts at the best team not yet placed and holds each following team whose
// range (rating +/- sd) overlaps the tier leader's range. It is checked against the leader only, never team to team, so
// a long chain of near neighbors cannot stretch one tier across the whole table.

export type Entry = Pick<RatingRow, "team" | "rating" | "rated" | "sd">;
export type Placed = { rank?: number; range?: { best: number; worst: number }; tier?: number };

/** Best first, ties by name: the order every table lists its ranked teams in. */
export const byRating = (a: Pick<Entry, "team" | "rating">, b: Pick<Entry, "team" | "rating">) => b.rating - a.rating || a.team.localeCompare(b.team);

/** Teams with enough games to take a rank, best first. */
export const rankedOrder = <T extends Entry>(rows: T[]): T[] => rows.filter((r) => r.rated >= FEW_GAMES).sort(byRating);

/** Each team's rank, rank range and tier among `rows`. A team with too few games has none (NR); a team without an `sd`
 * has a rank but no range and no tier. */
export function placeRows(rows: Entry[]): Map<string, Placed> {
  const ranked = rankedOrder([...rows]);
  const out = new Map<string, Placed>(rows.map((r) => [r.team, {}]));
  let tier = 0;
  let leader: (Entry & { sd: number }) | undefined;
  ranked.forEach((r, i) => {
    const rank = i + 1;
    const place: Placed = { rank };
    if (r.sd != null) {
      const above = (rating: number) => 1 + ranked.filter((o) => o !== r && o.rating > rating).length;
      place.range = { best: Math.min(rank, above(r.rating + r.sd)), worst: Math.max(rank, above(r.rating - r.sd)) };
      if (!leader || r.rating + r.sd < leader.rating - leader.sd) {
        tier += 1;
        leader = { ...r, sd: r.sd };
      }
      place.tier = tier;
    }
    out.set(r.team, place);
  });
  return out;
}

/** "#3 to #13", or "#3" when the range is one place. */
export const rangeText = ({ best, worst }: { best: number; worst: number }) => (best === worst ? `#${best}` : `#${best} to #${worst}`);
