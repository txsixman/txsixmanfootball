// A playoff game's page address (/scores/<id>) for the season under way (ADR 0079). Pure, one local import: the node tests
// run it as it is.
//
// A game the bracket sets by winners keeps one address from the day both its teams are known: `<season>-<round>-<away>-at-<home>`
// in the bracket's order (bracket-fill.ts pageOrders: home is the slot's first side), before any listing has it, once a
// listing has it, and once its final is recorded, whichever way round the listing or the final writes the two teams. Any
// other game (a first round, a game no slot places) takes its listing's order, as every page did before ADR 0079.

import { slugify } from "./slug.ts";

type Order = { round: string; home: string; away: string };
type Row = { round: string; home: string; away: string };

/** The address a listing's own order gives a game: the page id before ADR 0079, and the database's order (migration 0014). */
export const listingId = (season: number, r: Row) => `${season}-${r.round}-${slugify(r.away)}-at-${slugify(r.home)}`;

/** A bracket-set game's address, from its page order. */
export const orderId = (season: number, o: Order) => `${season}-${o.round}-${slugify(o.away)}-at-${slugify(o.home)}`;

/** A round and its two teams, in either order. */
const orderKey = (round: string, a: string, b: string) => [round, ...[slugify(a), slugify(b)].sort()].join("|");

/** The page order of each bracket-set game by `orderKey`, for `pageId`. */
export const orderMap = <O extends Order>(orders: O[]) => new Map(orders.map((o) => [orderKey(o.round, o.home, o.away), o]));

/** A row's page id: the bracket's order when the bracket sets the game, else the listing's. `name` maps a file's spelling of
 * a team to the one the bracket's orders use (our alignments'). */
export function pageId(season: number, orders: Map<string, Order>, r: Row, name: (team: string) => string = (t) => t): string {
  const o = orders.get(orderKey(r.round, name(r.home), name(r.away)));
  return o ? orderId(season, o) : listingId(season, r);
}
