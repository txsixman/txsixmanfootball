import { loadAlignments } from "./alignments";
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
type BracketRound = { round: string; label: string; games: BracketRow[] };
/** `chances`: state title chances (the last four, or a template plus every region settled). `regionChances`: UIL region titles. */
export type Bracket = { name: string; league: string; rounds: BracketRound[]; chances?: Chance[]; regionChances?: RegionChances[] };

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

export async function loadBrackets(season = CURRENT_SEASON): Promise<Bracket[]> {
  const [alignments, ratings, template] = await Promise.all([loadAlignments(), loadRatings(season), loadBracketTemplate()]);
  const games = await loadPlayoffGames(alignments, season);
  const brackets = [...Map.groupBy(games, (g) => g.bracket)].map(([name, list]): Bracket => {
    const league = list[0].league;
    const rounds = [...Map.groupBy(list, (g) => g.round)]
      .sort(([a], [b]) => ROUNDS.indexOf(a) - ROUNDS.indexOf(b))
      .map(([round, rows]) => ({
        round,
        label: roundLabel(round, league),
        games: rows.map((g) => (g.homeScore == null ? { ...g, projection: project(ratings, g.home, g.away, g.neutral) } : g)),
      }));
    const found = bracketTitleChances(ratings, alignments, template, name, list);
    const chances = found.state?.chances;
    return {
      name, league, rounds: ordered(rounds),
      ...(chances ? { chances } : {}),
      ...(found.regions.length ? { regionChances: found.regions } : {}),
    };
  });
  const order = (b: Bracket) => LEAGUES.indexOf(b.league as (typeof LEAGUES)[number]);
  return brackets.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}
