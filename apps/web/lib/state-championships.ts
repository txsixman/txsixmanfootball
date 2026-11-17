import { directionsUrl, type Address } from "./address";
import { loadAlignments } from "./alignments";
import { bracketHref, bracketLabel, bracketSlug, loadBrackets, type Bracket } from "./brackets";
import { loadPlayoffGames } from "./games";
import { memo } from "./memo";
import { orderMap, pageId } from "./page-id";
import { centralDate } from "./preview-parts";
import type { Projection } from "./projection";
import { CURRENT_SEASON, FIRST_SEASON } from "./season";
import { finalOf, STATE_ROUNDS, type LeagueFinal } from "./state-finals";

// Every league's State Championship games (ADR 0083): the recorded finals of every season, and this season's games, played
// or not, for the State Championship pages (/championships/<season>/<bracket>). Shared across pages: never mutate.

/** Every recorded State Championship with a champion, every league, every season with playoff files, oldest first. A final
 * the robot or a correction records shows here on the next build: nothing is edited by hand. */
export const recordedFinals = memo<void, LeagueFinal[]>(async () => {
  const alignments = await loadAlignments();
  const seasons = Array.from({ length: CURRENT_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);
  const per = await Promise.all(
    seasons.map(async (season) => (await loadPlayoffGames(alignments, season)).flatMap((g) => finalOf(season, g) ?? [])),
  );
  return per.flat().sort((a, b) => a.season - b.season || a.bracket.localeCompare(b.bracket));
});

/** A State Championship page's address. */
const championshipHref = (season: number, bracket: string) => `/championships/${season}/${bracketSlug(bracket)}`;

/** One bracket's State Championship game this season, played or not. */
export type StateChampionship = {
  season: number; league: string; bracket: string;
  /** The bracket's name without its league ("Division II Large School"), or the league for a league's one bracket. */
  label: string;
  slug: string; href: string; bracketHref: string;
  /** The two teams once known, home (the bracket's first side) first; a side not yet known reads as the tree box does
   * ("Winner of G29", "To be decided"). */
  sides: [{ team?: string; text: string }, { team?: string; text: string }];
  /** Date, kickoff (UTC) and site, from the listing, the playoff-week details, or the league's own bracket. */
  date?: string; kickoff?: string; site?: string; address?: Address;
  /** A maps search for the site: at its street address when known, else by the site's name and city (a State Championship
   * stadium the league names, such as UIL's, before any listing gives its street). */
  directions?: string;
  /** The game's page (/scores/<id>), once both teams are known. */
  gameHref?: string;
  /** Unplayed, both teams known: the projection on the game's field (no home edge at a State Championship, ADR 0057). */
  projection?: Projection;
  /** Played and recorded: score shown unless a forfeit. Absent until then. */
  final?: LeagueFinal;
  /** Played but disputed (ADR 0040): the sources give different winners, so no champion is named. */
  disputed?: boolean;
  /** The listed scores of a played game, home first, whether or not it names a champion. */
  scores?: [number, number];
};

const directionsOf = (site?: string, address?: Address) =>
  !site ? undefined
  : address ? directionsUrl(site, address)
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${site}, Texas`)}`;

function championshipOf(season: number, b: Bracket): StateChampionship | undefined {
  const round = b.rounds.find((r) => STATE_ROUNDS.has(r.round));
  const node = b.tree.find((n) => STATE_ROUNDS.has(n.round));
  if (!round && !node) return undefined;
  const game = round?.games[0];
  const built = round?.built[0];
  const base = {
    season, league: b.league, bracket: b.name, label: bracketLabel(b), slug: bracketSlug(b.name), href: championshipHref(season, b.name), bracketHref: bracketHref(b.name),
  };
  const orders = orderMap(b.orders);
  const finalRound = round?.round ?? node?.round ?? "final";
  if (game) {
    const played = game.homeScore != null && game.awayScore != null;
    const final = finalOf(season, game);
    return {
      ...base,
      sides: [{ team: game.home, text: game.home }, { team: game.away, text: game.away }],
      date: game.date, kickoff: game.kickoff, site: game.site, address: game.address, directions: directionsOf(game.site, game.address),
      gameHref: `/scores/${pageId(season, orders, { round: game.round, home: game.home, away: game.away })}`,
      ...(game.projection ? { projection: game.projection } : {}),
      ...(final ? { final } : {}),
      ...(played && !final && !game.forfeit && !game.confirmed ? { disputed: true } : {}),
      ...(played ? { scores: [game.homeScore!, game.awayScore!] as [number, number] } : {}),
    };
  }
  const side = (i: 0 | 1) => {
    const s = built?.sides[i];
    if (s && "team" in s) return { team: s.team, text: s.team };
    const t = node?.sides[i];
    return t?.team ? { team: t.team, text: t.team } : { text: t?.title ?? t?.text ?? "To be decided" };
  };
  const sides: StateChampionship["sides"] = [side(0), side(1)];
  const [a, b2] = sides;
  const site = built?.site ?? node?.site;
  return {
    ...base,
    sides,
    date: built?.date ?? (node?.kickoff_utc ? centralDate(node.kickoff_utc) : undefined), kickoff: built?.kickoff ?? node?.kickoff_utc, site, address: built?.address,
    directions: directionsOf(site, built?.address),
    ...(a.team && b2.team ? { gameHref: `/scores/${pageId(season, orders, { round: finalRound, home: a.team, away: b2.team })}` } : {}),
    ...(built?.projection ? { projection: built.projection } : node?.projection ? { projection: node.projection } : {}),
  };
}

/** This season's State Championship in every bracket, in /playoffs order (UIL first, then the private leagues). */
export const stateChampionships = memo<number, StateChampionship[]>(async (season) =>
  (await loadBrackets(season)).flatMap((b) => championshipOf(season, b) ?? []),
);

/** The State Championship a school plays in or won this season, if it reached one. */
export async function championshipFor(school: string, season = CURRENT_SEASON): Promise<StateChampionship | undefined> {
  return (await stateChampionships(season)).find((c) => c.sides.some((s) => s.team === school));
}
