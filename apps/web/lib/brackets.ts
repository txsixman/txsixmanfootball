import { heading, loadAlignments, programFor, type Alignment } from "./alignments";
import { bracketSlots, builtGames, derivedSlots, fill, ownSlots, type Side } from "./bracket-fill";
import { treeGames, type TreeGame } from "./bracket-tree";
import { loadSlotRows } from "./bracket-slots";
import { memo } from "./memo";
import { pairsOf, type Pair } from "./playoff-path";
import { slugify } from "./slug";
import { loadPlayoffGames, playoffLeagueSet, ROUNDS, type PlayoffGame } from "./games";
import { project, type Projection } from "./projection";
import { loadRatings, ratingSeasons } from "./ratings";
import { bracketTitleChances, loadBracketTemplate, type Chance, type RegionChances } from "./title-chances";
import { CURRENT_SEASON } from "./season";

// A season's playoffs bracket by bracket, round by round. Scores are unconfirmed (ADR 0004, ADR 0008), so no game names a
// winner; a team's next game shows who went on. Unplayed games carry a projection from that season's ratings, on a
// neutral field unless the data says the game is at a home site. A finished season has no unplayed games, so it has
// no projections and no title chances. Team names missing from today's alignments pass through as written.

export type BracketRow = PlayoffGame & { projection?: Projection };
/** A next-round game no site lists yet (ADR 0047): its two sides, the team first when only one is known ("Team vs winner of
 * X–Y"), and the projection on a neutral field once both teams are known. No date or site: none is listed yet. */
export type BuiltRow = { round: string; sides: [Side, Side]; projection?: Projection };
/** A box of the tree view (ADR 0049): the slot, its round's label, and the projection of a game not yet played once both
 * teams are known (a listed game at its own site, a game no site lists yet on a neutral field). */
type TreeRow = TreeGame<PlayoffGame> & { label: string; projection?: Projection };
type BracketRound = { round: string; label: string; games: BracketRow[]; built: BuiltRow[] };
/** `chances`: state title chances (the last four, or a template plus every region settled). `regionChances`: UIL region titles.
 * `pairs`: games whose winners meet next, so the next pairing is known (lib/playoff-path.ts). */
export type Bracket = { name: string; league: string; rounds: BracketRound[]; tree: TreeRow[]; pairs: Pair[]; chances?: Chance[]; regionChances?: RegionChances[] };

/** A bracket's own page (/playoffs/bracket/<slug>), and its name without the league ("Division II Large School"; a league's one bracket keeps the league). */
export const bracketSlug = (name: string) => slugify(name);
export const bracketHref = (name: string) => `/playoffs/bracket/${bracketSlug(name)}`;
export const bracketLabel = (b: Pick<Bracket, "name" | "league">) => b.name.slice(b.league.length).trim() || b.league;
/** The latest round a site lists a game in: a round that holds only games the bracket sets (ADR 0047) is not "latest" yet. */
export const latestRound = (b: Pick<Bracket, "rounds">) => b.rounds.findLast((r) => r.games.length) ?? b.rounds.at(-1);

/** League tabs, in page order: UIL first, then the private leagues. */
export const LEAGUES = ["UIL", "TAPPS", "TAIAO", "TCAF"] as const;

/** Leagues with playoff games in a season, in tab order. */
export async function playoffLeagues(season: number): Promise<(typeof LEAGUES)[number][]> {
  const have = await playoffLeagueSet(season);
  return LEAGUES.filter((l) => have.has(l));
}

/** Seasons with playoff games (and ratings to rate them by), newest first. */
export async function playoffSeasons(): Promise<number[]> {
  const seasons = await ratingSeasons();
  const withGames = await Promise.all(seasons.map(async (s) => ((await playoffLeagues(s)).length ? s : undefined)));
  return withGames.filter((s) => s !== undefined);
}

export function roundLabel(round: string, league: string): string {
  if (round === "state" || (round === "final" && league === "UIL")) return "State final";
  if (round === "round-1") return "First round";
  return round[0].toUpperCase() + round.slice(1); // Bi-district, Area, Regional, Quarterfinal, Semifinal, Final
}

/**
 * Earlier rounds sit in the order of the later games they feed: a game's place is the place of the first later game
 * either of its teams played in. Within a round with no later round yet, by date, then home team.
 */
function ordered(rounds: BracketRound[]): BracketRound[] {
  let later = new Map<string, number>(); // team -> position of its game in the round after this one
  for (const r of [...rounds].reverse()) {
    const key = (g: BracketRow) => Math.min(later.get(g.home) ?? 1e9, later.get(g.away) ?? 1e9);
    r.games.sort((a, b) => key(a) - key(b) || a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
    later = new Map(r.games.flatMap((g, i) => [[g.home, i], [g.away, i]] as const));
  }
  return rounds;
}

/** Each team's region in a UIL bracket, from the alignments: where an area game stays inside one region. Other leagues have none (ADR 0012). */
const regionLookup = (alignments: Alignment[], league: string, name: string) => {
  const region = new Map(alignments.filter((a) => a.league === league && league === "UIL" && heading(a) === name).map((a) => [a.school, a.region]));
  return (team: string) => region.get(team);
};

/** Read once per season per build worker: every program page asks for its bracket path. Never mutate what it returns. */
export const loadBrackets = (season = CURRENT_SEASON): Promise<Bracket[]> => bracketsOf(season);
const bracketsOf = memo(async (season: number): Promise<Bracket[]> => {
  const [alignments, ratings, template, slotRows] = await Promise.all([loadAlignments(), loadRatings(season), loadBracketTemplate(), loadSlotRows(season)]);
  const games = await loadPlayoffGames(alignments, season);
  const brackets = [...Map.groupBy(games, (g) => g.bracket)].map(([name, list]): Bracket => {
    const league = list[0].league;
    // The next round's games before any site lists them: from the league's own bracket, or what the data closes (ADR 0047).
    const division = list[0].division;
    const regionOf = regionLookup(alignments, league, name);
    const rename = (t: string) => programFor(alignments, t, league)?.school ?? t;
    const slots = bracketSlots(slotRows, list, { league, division, regionOf, rename });
    // The tree's shape: the league's own bracket, else what the listed games show (ADR 0049).
    const own = ownSlots(slotRows, { league, division, rename });
    const tree = treeGames(own.length ? own : derivedSlots(list, league === "UIL" ? "state" : "final", ROUNDS), list, ROUNDS).map((n): TreeRow => {
      const [a, b] = n.sides;
      const projection =
        n.state === "upcoming" && n.game ? project(ratings, n.game.home, n.game.away, n.game.neutral)
        : n.state === "open" && a.team && b.team ? project(ratings, a.team, b.team, true, true)
        : undefined;
      return { ...n, label: roundLabel(n.round, league), ...(projection ? { projection } : {}) };
    });
    // Past seasons are all played: their pages stay as listed.
    const built = (season === CURRENT_SEASON ? builtGames(fill(slots, list, ROUNDS)) : []).map(({ round, sides }): BuiltRow => {
      const [a, b] = sides;
      const projection = "team" in a && "team" in b ? project(ratings, a.team, b.team, true, true) : undefined;
      return { round, sides, ...(projection ? { projection } : {}) };
    });
    const rounds = [...new Set([...list.map((g) => g.round), ...built.map((g) => g.round)])]
      .sort((a, b) => ROUNDS.indexOf(a) - ROUNDS.indexOf(b))
      .map((round) => ({
        round,
        label: roundLabel(round, league),
        games: list.filter((g) => g.round === round).map((g) => (g.homeScore == null ? { ...g, projection: project(ratings, g.home, g.away, g.neutral) } : g)),
        built: built.filter((g) => g.round === round),
      }));
    const found = bracketTitleChances(ratings, alignments, template, name, list);
    const chances = found.state?.chances;
    return {
      name, league, rounds: ordered(rounds), tree, pairs: pairsOf(rounds, regionLookup(alignments, league, name)),
      ...(chances ? { chances } : {}),
      ...(found.regions.length ? { regionChances: found.regions } : {}),
    };
  });
  const order = (b: Bracket) => LEAGUES.indexOf(b.league as (typeof LEAGUES)[number]);
  return brackets.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
});
