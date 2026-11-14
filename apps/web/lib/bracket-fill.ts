// Which games feed which (ADR 0047): a bracket's slots, each fed by a team, a bye or the winner of an earlier slot, and
// from them the next round's games before any site lists them ("Winner A vs Winner B", "Team vs winner of X–Y"), and the
// checks that every listed later-round game has the right two teams. Pure, no imports: the site's build, the data checks
// (scripts/check-data.mjs) and the node tests all run it as it is.
//
// The slots come from a source's own bracket (data/seed/brackets/<season>.csv, written by a robot, never by hand) and from
// what the data closes by itself: the two semifinals of a bracket feed its final, and two area games of one UIL region
// feed that region's final (the regions are closed sub-brackets; lib/playoff-path.ts). Nothing is guessed from district
// numbers or seeds.

/** One game as a bracket lists it. A winner is named only for a confirmed final (ADR 0040), never for a tie. */
export type FillGame = { round: string; date: string; home: string; away: string; homeScore?: number; awayScore?: number; confirmed: boolean; forfeit?: boolean };

/** What fills one side of a slot: a team placed by the bracket, a bye, or the winner of another slot. */
type Feed = { team: string } | { bye: true } | { winnerOf: string };

/** A place in the bracket: its round, and the two sides that meet there. `slot` is the source's own code ("SQ1", "SF2"). */
export type Slot = { slot: string; round: string; a: Feed; b: Feed; group?: string; kickoff_utc?: string; site?: string };

/** A side as far as it is known: the team, or the game whose winner it will be (listed or not), or a bye. */
export type Side = { team: string } | { winnerOf: FillGame } | { pending: string } | { bye: true };

/** A slot worked out: its two sides, its listed game if any, and its winner once that game is a confirmed final. */
export type Filled = { slot: Slot; a: Side; b: Side; game?: FillGame; winner?: string };

function winnerOf(g: FillGame): string | undefined {
  if (!g.confirmed || g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return undefined;
  return g.homeScore > g.awayScore ? g.home : g.away;
}

const loserOf = (g: FillGame) => {
  const w = winnerOf(g);
  return w && (w === g.home ? g.away : g.home);
};

export const gameId = (g: Pick<FillGame, "date" | "home" | "away">) => `game:${g.date}|${g.home}|${g.away}`;

/**
 * The slots the data closes by itself, beyond any source's: a bracket's two semifinals feed its final (`finalRound`: "state"
 * for UIL, "final" elsewhere), and, given `regionOf`, two area games inside one region feed that region's final. A listed
 * game is its own slot, fed by its two teams.
 */
function closedSlots(games: FillGame[], finalRound: string, regionOf?: (team: string) => string | undefined): Slot[] {
  const own = (g: FillGame): Slot => ({ slot: gameId(g), round: g.round, a: { team: g.home }, b: { team: g.away } });
  const out: Slot[] = [];
  const semis = games.filter((g) => g.round === "semifinal");
  if (semis.length === 2) out.push(own(semis[0]), own(semis[1]), { slot: "closed:final", round: finalRound, a: { winnerOf: gameId(semis[0]) }, b: { winnerOf: gameId(semis[1]) } });
  if (regionOf) {
    const inRegion = games.filter((g) => g.round === "area" && regionOf(g.home) && regionOf(g.home) === regionOf(g.away));
    for (const [region, list] of Map.groupBy(inRegion, (g) => regionOf(g.home)!)) {
      if (list.length !== 2) continue;
      out.push(own(list[0]), own(list[1]), { slot: `closed:regional-${region}`, round: "regional", a: { winnerOf: gameId(list[0]) }, b: { winnerOf: gameId(list[1]) } });
    }
  }
  return out;
}

/** Every team that could come out of `feed`: a team itself, or any team under the slot it names. */
export function candidates(feed: Feed, bySlot: Map<string, Slot>, seen = new Set<string>()): Set<string> {
  if ("team" in feed) return new Set([feed.team]);
  if ("bye" in feed) return new Set();
  const s = bySlot.get(feed.winnerOf);
  if (!s || seen.has(s.slot)) return new Set();
  seen.add(s.slot);
  return new Set([...candidates(s.a, bySlot, seen), ...candidates(s.b, bySlot, seen)]);
}

/**
 * Each slot with its sides, its listed game and its winner, in `order` (the rounds, first to last). A slot's game is the
 * listed game of its round with one team from each side's candidates; a bye slot's winner is its one team.
 */
export function fill(slots: Slot[], games: FillGame[], order: readonly string[]): Filled[] {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const done = new Map<string, Filled>();
  const rank = (round: string) => order.indexOf(round);
  for (const slot of [...slots].sort((x, y) => rank(x.round) - rank(y.round))) {
    const side = (feed: Feed): Side => {
      if ("team" in feed || "bye" in feed) return feed;
      const from = done.get(feed.winnerOf);
      if (from?.winner) return { team: from.winner };
      return from?.game ? { winnerOf: from.game } : { pending: feed.winnerOf };
    };
    const [ca, cb] = [candidates(slot.a, bySlot), candidates(slot.b, bySlot)];
    const game = games.find((g) => g.round === slot.round && ((ca.has(g.home) && cb.has(g.away)) || (ca.has(g.away) && cb.has(g.home))));
    const [a, b] = [side(slot.a), side(slot.b)];
    const bye = "bye" in a ? b : "bye" in b ? a : undefined;
    const winner = game ? winnerOf(game) : bye && "team" in bye ? bye.team : undefined;
    done.set(slot.slot, { slot, a, b, ...(game ? { game } : {}), ...(winner ? { winner } : {}) });
  }
  return [...done.values()];
}

/** A next-round game no site lists yet: both teams known, or one team and the game whose winner it meets. */
export type Built = { slot: string; round: string; sides: [Side, Side] };

/**
 * The games to show ahead of any listing: slots with no listed game, at least one team known, and the other side either
 * known or the winner of a listed game. A side that is only "pending" (its game is not listed either) is too far ahead.
 */
export function builtGames(filled: Filled[]): Built[] {
  const shown = (s: Side) => "team" in s || "winnerOf" in s;
  return filled.flatMap((f) =>
    !f.game && !("bye" in f.a) && !("bye" in f.b) && shown(f.a) && shown(f.b) && ("team" in f.a || "team" in f.b)
      ? [{ slot: f.slot.slot, round: f.slot.round, sides: ("team" in f.a ? [f.a, f.b] : [f.b, f.a]) as [Side, Side] }]
      : [],
  );
}

/** "Kress–Jayton": a game's two teams, away first, as the pages list them. */
const pairLabel = (g: Pick<FillGame, "home" | "away">) => `${g.away}–${g.home}`;

/** A side in words: the team, or "winner of Kress–Jayton". */
export const sideText = (s: Side) => ("team" in s ? s.team : "winnerOf" in s ? `winner of ${pairLabel(s.winnerOf)}` : "to be decided");

const line = (g: FillGame) => `${g.round} ${g.date} ${g.away} v ${g.home}`;

/**
 * What is wrong with a bracket's listed games, one line each, keyed for data/integrity-exceptions.json:
 * - a listed later-round game whose team is not the winner of the slot feeding that side;
 * - a confirmed winner with a next slot whose listed game has the other side's team and not this winner;
 * - a listed game in a round the bracket covers that is none of its slots' games;
 * - a team that lost a confirmed final and appears in a later round of the same bracket.
 */
export function bracketProblems(name: string, slots: Slot[], games: FillGame[], order: readonly string[]): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const rank = (round: string) => order.indexOf(round);
  const filled = fill(slots, games, order);
  for (const f of filled) {
    if (!f.game) continue;
    for (const [feed, side] of [[f.slot.a, f.a], [f.slot.b, f.b]] as const) {
      if (!("winnerOf" in feed) || !("team" in side)) continue;
      if (f.game.home !== side.team && f.game.away !== side.team) {
        out.push({ key: `bracket ${name} ${f.slot.slot}`, text: `${name}: ${line(f.game)} should have ${side.team}, the winner of the game that feeds it` });
      }
    }
  }
  // A winner whose next slot lists a game without it: the game was found by the other side, not by this winner.
  const placed = new Map(filled.map((f) => [f.slot.slot, f]));
  for (const s of slots) {
    for (const [mine, other] of [[s.a, s.b], [s.b, s.a]] as const) {
      if (!("winnerOf" in mine)) continue;
      const winner = placed.get(mine.winnerOf)?.winner;
      if (!winner) continue;
      const others = candidates(other, new Map(slots.map((x) => [x.slot, x])));
      const listed = games.find((g) => g.round === s.round && (others.has(g.home) || others.has(g.away)));
      if (listed && listed.home !== winner && listed.away !== winner) {
        out.push({ key: `bracket ${name} ${s.slot} placed`, text: `${name}: ${winner} won its game but ${line(listed)} is listed in its place` });
      }
    }
  }
  // A listed game in a round the bracket covers must be one of its slots: two teams the bracket never pairs is a wrong listing.
  const rounds = new Set(slots.map((s) => s.round));
  const used = new Set(filled.flatMap((f) => (f.game ? [f.game] : [])));
  for (const g of games) {
    if (rounds.has(g.round) && !used.has(g)) out.push({ key: `bracket ${name} unplaced ${g.round} ${g.away} v ${g.home}`, text: `${name}: ${line(g)} is not a pairing in the bracket` });
  }
  // A team that lost never plays on in the same bracket.
  for (const g of games) {
    const loser = loserOf(g);
    if (!loser) continue;
    for (const later of games) {
      if (rank(later.round) > rank(g.round) && (later.home === loser || later.away === loser)) {
        out.push({ key: `bracket ${name} lost ${loser} ${later.round}`, text: `${name}: ${loser} lost ${line(g)} but is listed in ${line(later)}` });
      }
    }
  }
  return [...new Map(out.map((p) => [p.key, p])).values()];
}

/** The rounds, first to last (lib/games.ts ROUNDS). */
export const ROUND_ORDER = ["round-1", "bi-district", "area", "quarterfinal", "regional", "semifinal", "final", "state"] as const;

/** A row of data/seed/brackets/<season>.csv (lib/data-schemas.ts BracketSlotRow), or of UIL's own bracket file with the
 * kickoff and site it lists, if any. */
export type SlotRow = { league: string; division: string; round: string; slot: string; a: string; b: string; region?: string; kickoff_utc?: string; site?: string };

/** UIL's bracket file rows (data/seed/uil-<span>/bracket-<year>.csv) as slot rows: seeds and region stay in the file. */
export const uilSlotRows = (rows: { division: string; region: string; round: string; slot: string; a: string; b: string; kickoff_utc: string; site_name: string; site_city: string }[]): SlotRow[] =>
  rows.map((r) => ({
    league: "UIL", division: r.division, round: r.round, slot: r.slot, a: r.a, b: r.b,
    ...(r.region ? { region: r.region } : {}),
    ...(r.kickoff_utc ? { kickoff_utc: r.kickoff_utc } : {}),
    ...(r.site_name ? { site: r.site_city ? `${r.site_name}, ${r.site_city}` : r.site_name } : {}),
  }));

const feedOf = (x: string): Feed => (x === "bye" ? { bye: true } : x.startsWith("winner:") ? { winnerOf: x.slice("winner:".length) } : { team: x });

/** The block of the bracket a first-round slot sits in, as the league names it: a UIL region, or TAIAO's North and South
 * halves (its codes NR1, SQ2 are the North and South rounds). */
const groupOf = (r: SlotRow) =>
  r.region ? `Region ${r.region}` : r.league === "TAIAO" && /^[NS][RQ]\d/.test(r.slot) ? (r.slot[0] === "N" ? "North" : "South") : undefined;

/** A league's own bracket from the file, or none. `rename` maps a bracket's spelling of a team to the pages' one. */
export function ownSlots(rows: SlotRow[], { league, division, rename = (t) => t }: { league: string; division: string; rename?: (team: string) => string }): Slot[] {
  return rows.filter((r) => r.league === league && r.division === division).map((r): Slot => {
    const [a, b] = [feedOf(r.a), feedOf(r.b)].map((f) => ("team" in f ? { team: rename(f.team) } : f));
    const group = groupOf(r);
    return { slot: r.slot, round: r.round, a, b, ...(group ? { group } : {}), ...(r.kickoff_utc ? { kickoff_utc: r.kickoff_utc } : {}), ...(r.site ? { site: r.site } : {}) };
  });
}

/**
 * One bracket's slots: the league's own bracket when the file has it, else only what the data closes by itself
 * (closedSlots; regions for UIL alone, ADR 0012).
 */
export function bracketSlots(rows: SlotRow[], games: FillGame[], { league, division, regionOf, rename }: {
  league: string; division: string; regionOf?: (team: string) => string | undefined; rename?: (team: string) => string;
}): Slot[] {
  const own = ownSlots(rows, { league, division, rename });
  return own.length ? own : closedSlots(games, league === "UIL" ? "state" : "final", league === "UIL" ? regionOf : undefined);
}

/**
 * A bracket's shape from its listed games alone, for the tree view (ADR 0048) where no league file gives it: each listed
 * game is a slot, and a side is the winner of that team's game in the round before, or the team itself when it has none
 * (its first game here). Two listed semifinals with nothing after them feed the final (`finalRound`). Who meets whom
 * further on is never guessed: a bracket whose later rounds are not listed stays a set of separate trees.
 */
export function derivedSlots(games: FillGame[], finalRound: string, order: readonly string[]): Slot[] {
  const rank = (round: string) => order.indexOf(round);
  const feed = (g: FillGame, team: string): Feed => {
    const before = games.filter((h) => rank(h.round) < rank(g.round) && (h.home === team || h.away === team));
    const last = Math.max(...before.map((h) => rank(h.round)));
    const prev = before.filter((h) => rank(h.round) === last);
    return prev.length === 1 ? { winnerOf: gameId(prev[0]) } : { team };
  };
  const out: Slot[] = games.map((g) => ({ slot: gameId(g), round: g.round, a: feed(g, g.home), b: feed(g, g.away) }));
  const semis = games.filter((g) => g.round === "semifinal");
  if (semis.length === 2 && !games.some((g) => rank(g.round) > rank("semifinal"))) {
    out.push({ slot: "closed:final", round: finalRound, a: { winnerOf: gameId(semis[0]) }, b: { winnerOf: gameId(semis[1]) } });
  }
  return out;
}
