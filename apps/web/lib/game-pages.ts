import { heading, loadAlignments, placeLabel, programFor, programsFor, slugify } from "./alignments";
import { roundLabel } from "./brackets";
import { demoGames, type Game, type Team } from "./demo-games";
import { initials, loadGames, loadPlayoffGames, loadSeasonResults, gameKey, type SeasonResult } from "./games";
import { commonOpponents, type CommonOpponent } from "./game-preview";
import { pairKey } from "./meetings";
import { memo } from "./memo";
import type { Org } from "./orgs";
import { pregame, pregameShown } from "./pregame";
import { projectionText, type Projection } from "./projection";
import { loadRanked, rankLabel } from "./rankings";
import { loadRatings, record } from "./ratings";
import { CURRENT_SEASON } from "./season";
import { isDisputed, loadDisputed } from "./disputed";
import { resultSeasons } from "./weeks";

// A page for every robot-read game of every season (/scores/<id>, app/scores/[id]). The lookups below are worked out once
// per build worker and shared by all ~6,800 pages, so a page does a few map reads and nothing else: never mutate them.

export type Entry = { season: number; result: SeasonResult };

type Index = {
  /** By the id in the game's address: a game's own id, or, for a current-season playoff game, the bracket game's id. */
  byPage: Map<string, Entry>;
  /** Every game between two programs (slugs, either order), all seasons, oldest first. */
  pairs: Map<string, Entry[]>;
  /** A team's games of a season (`<season>|<slug>`), oldest first. */
  teams: Map<string, SeasonResult[]>;
};

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => map.set(key, [...(map.get(key) ?? []), value]);

const index = memo<void, Index>(async () => {
  const byPage = new Map<string, Entry>();
  const pairs = new Map<string, Entry[]>();
  const teams = new Map<string, SeasonResult[]>();
  for (const season of [...(await resultSeasons())].sort((a, b) => a - b)) {
    for (const result of [...(await loadSeasonResults(season))].sort((a, b) => a.date.localeCompare(b.date))) {
      const entry = { season, result };
      const page = result.href.slice("/scores/".length);
      // Two games on one address would silently hide one: fail the build instead.
      if (byPage.has(page)) throw new Error(`two games share the address /scores/${page}`);
      byPage.set(page, entry);
      push(pairs, pairKey(slugify(result.home), slugify(result.away)), entry);
      for (const team of [result.home, result.away]) push(teams, `${season}|${slugify(team)}`, result);
    }
  }
  return { byPage, pairs, teams };
});

/** The robot-read game at /scores/<id>: for a current-season playoff game this is its result, found through the bracket game's id. */
export async function findGame(id: string): Promise<Entry | undefined> {
  return (await index()).byPage.get(id);
}

/** Ids of the pages that are only a robot-read game (a playoff game's page is the bracket game's, built by loadGames). */
export async function resultPageIds(): Promise<string[]> {
  return [...(await index()).byPage].flatMap(([page, { result }]) => (page === result.id ? [page] : []));
}

const ratingRows = memo(async (season: number) => new Map((await loadRatings(season)).teams.map((t) => [slugify(t.team), t])));

/** Playoff rounds of a season (the season's playoff file), to say a game was one: "TAPPS Division II · Quarterfinal", by `gameKey`.
 * A game page uses it for past seasons (the current season's playoff games have bracket pages instead); a program page tags its history rows with it. */
export const playoffLabels = memo(async (season: number) =>
  new Map((await loadPlayoffGames(await loadAlignments(), season)).map((g) => [gameKey(g.date, g.home, g.away), `${g.bracket} · ${roundLabel(g.round, g.league)}`])),
);

type Going = { record: string; rating?: number };
export type GameDetail = {
  /** What the ratings said the week before (lib/pregame.ts), when both teams had played four games. */
  projection?: Projection;
  /** Each team's record, and with a projection its rating, at the start of the game. */
  going: { home: Going; away: Going };
  /** Earlier games of the two programs, newest first: how many there were, and the latest few. */
  meetings: { total: number; list: Entry[] };
  /** "TAPPS Division II · Quarterfinal" for a past season's playoff game. */
  playoff?: string;
  /** A current-season game's organization, division and district for each team, where an alignment lists it. */
  places: { home?: string; away?: string };
  /** Two teams of one numbered district, outside the playoffs. */
  districtGame: boolean;
};

const MEETINGS_SHOWN = 8;

/**
 * What a game page adds to the score. `id` is the game's SeasonResult id; without one (an unplayed bracket game) there is
 * no projection to judge. Records count every game of the season read before this date, the way standings do (ADR 0013).
 */
export async function gameDetail({ season, date, home, away, id }: { season: number; date: string; home: string; away: string; id?: string }): Promise<GameDetail> {
  const { pairs, teams } = await index();
  const projection = id ? (await pregame(season)).get(id) : undefined;
  const table = projection ? await loadRatings(season) : undefined;
  const week = table?.weeks?.findLastIndex((w) => w < date) ?? -1;
  const rows = projection ? await ratingRows(season) : undefined;
  const going = (team: string): Going => {
    const before = (teams.get(`${season}|${slugify(team)}`) ?? []).filter((g) => g.date < date);
    const count = (test: (us: number, them: number) => boolean) =>
      before.filter((g) => (g.home === team ? test(g.homeScore, g.awayScore) : test(g.awayScore, g.homeScore))).length;
    const rating = week >= 0 ? rows?.get(slugify(team))?.trend?.[week] : undefined;
    return {
      record: before.length ? record({ won: count((a, b) => a > b), lost: count((a, b) => a < b), tied: count((a, b) => a === b) }) : "",
      ...(rating != null ? { rating } : {}),
    };
  };
  const earlier = ((pairs.get(pairKey(slugify(home), slugify(away))) ?? []).filter((e) => e.result.date < date)).reverse();

  const current = season === CURRENT_SEASON;
  const alignments = current ? await loadAlignments() : [];
  const place = (team: string) => {
    const a = programFor(alignments, team);
    if (!a) return undefined;
    const where = placeLabel(a);
    return [...new Set([heading(a), where === "Teams" ? "" : where].filter(Boolean))].join(" · ");
  };
  const [h, a] = [programsFor(alignments, home), programsFor(alignments, away)];
  const districtGame = h.some((x) => /^[1-9]\d*$/.test(x.district) && a.some((y) => y.league === x.league && y.division === x.division && y.region === x.region && y.district === x.district));

  return {
    ...(projection ? { projection } : {}),
    going: { home: going(home), away: going(away) },
    meetings: { total: earlier.length, list: earlier.slice(0, MEETINGS_SHOWN) },
    ...(!current ? { playoff: (await playoffLabels(season)).get(gameKey(date, home, away)) } : {}),
    places: { home: place(home), away: place(away) },
    districtGame,
  };
}

/** One team of a game not yet played: its record this season, and its current rating and rank where it has one. */
export type PreviewSide = { team: string; record: string; rating?: number; rank?: { text: string; sub?: string } };
/** `common`: the opponents both met this season, each team's scores against it (away team's first), see lib/game-preview.ts. */
export type GamePreview = { away: PreviewSide; home: PreviewSide; common: { shown: CommonOpponent[]; rest: number } };

/**
 * The preview of a game not yet played, from data already loaded: each team's record (`detail.going`), its rating and rank
 * within the game's organization (`org`: ranks never cross organizations, ADR 0012), and the opponents both met this season.
 * Head-to-head is `detail.meetings`.
 */
export async function gamePreview({ season, date, home, away, org, detail }: { season: number; date: string; home: string; away: string; org?: Org; detail: GameDetail }): Promise<GamePreview> {
  const [{ teams }, ranked] = await Promise.all([index(), loadRanked()]);
  const side = (team: string, going: Going): PreviewSide => {
    const row = ranked.teams.find((r) => r.school.school === team && (!org || r.org.league === org.league));
    const rank = row && rankLabel(row);
    return { team, record: going.record, ...(row && rank ? { rating: row.rating, rank: { text: rank.text, ...(rank.sub ? { sub: rank.sub } : {}) } } : {}) };
  };
  const games = (team: string) => teams.get(`${season}|${slugify(team)}`) ?? [];
  return { away: side(away, detail.going.away), home: side(home, detail.going.home), common: commonOpponents(away, home, games(away), games(home), date) };
}

/** "Friday, October 24, 2025". */
export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** "Oct 24, 2025". */
export const mediumDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * A robot-read game as the scoreboard's Game, so it shares the playoff game page's look. A final, so it is confirmed and
 * names its winner unless disputed (ADR 0040); a forfeit carries the word and no score, so its 1-0 or 2-0 never reaches the page.
 */
function resultAsGame({ season, result: r }: Entry, d: GameDetail, disputed: Set<string>): Game {
  const team = (name: string, g: Going): Team => ({ name, mascot: "", initials: initials(name), color: "#0a2a5e", record: g.record ? `${g.record} going in` : "" });
  const kind = d.playoff ? `${season} playoffs · ${d.playoff}` : d.districtGame ? `${season} season · District game` : `${season} season`;
  const dispute = !r.forfeit && isDisputed(disputed, r.date, r.home, r.away); // the sources give different winners: none marked
  return {
    id: r.id,
    date: r.date,
    league: kind,
    home: team(r.home, d.going.home),
    away: team(r.away, d.going.away),
    homeScore: r.forfeit ? null : r.homeScore,
    awayScore: r.forfeit ? null : r.awayScore,
    state: "final",
    status: r.forfeit ? "Forfeit" : dispute ? "Score reported" : "Final",
    endReason: r.forfeit ? "Forfeit" : undefined,
    verification: dispute ? "disputed" : "confirmed",
    venue: d.playoff ? "Neutral site or not listed" : `${r.home} (home)`,
  };
}

/** The bracket games of the season (hand captures and robot-read), then the invented sample games. Read once per worker:
 * every robot-read game of every season has a page too, and would otherwise read these files again. */
export const bracketGames = memo<void, Game[]>(async () => [...(await loadGames(await loadAlignments())), ...demoGames]);

/** One address per game: bracket and sample games, then every robot-read game that is not also a bracket game. The game
 * page and its share image (app/scores/[id]) are built for exactly these ids. */
export const gameIds = async () => [...new Set([...(await bracketGames()).map((g) => g.id), ...(await resultPageIds())])];

/**
 * Everything a game page and its share image start from: the game as the scoreboard's Game, whether it is an invented
 * sample, its detail, and `neutral` (a past season's playoff game has no site on record, so neither team is called home
 * or away). `found`: the robot-read game behind the address, if any. Undefined for an address with no game.
 */
export async function resolveGame(id: string) {
  // A robot-read game, which is also a bracket game's result when it is a current-season playoff game.
  const found = await findGame(id);
  const own = found?.result.id === id ? found : undefined;
  const bracket = own ? undefined : (await bracketGames()).find((x) => x.id === id);
  if (!own && !bracket) return undefined;
  const sample = bracket !== undefined && demoGames.includes(bracket);
  const date = own?.result.date ?? bracket?.date;
  const detail =
    !sample && date
      ? await gameDetail({
          season: found?.season ?? CURRENT_SEASON,
          date,
          home: own?.result.home ?? bracket!.home.name,
          away: own?.result.away ?? bracket!.away.name,
          id: found?.result.id,
        })
      : undefined;
  // A played game's projection is the one from the week before it (ADR 0044), shown beside its outcome.
  const before = own && (await pregameShown(own.season)).byId.get(own.result.id);
  const g: Game = own ? { ...resultAsGame(own, detail!, await loadDisputed(own.season)), ...(before && { projected: projectionText(before) }) } : bracket!;
  return { g, found, own, sample, detail, neutral: own !== undefined && detail?.playoff !== undefined };
}

/** Every game between two programs (slugs in `pairKey` order), all seasons read, oldest first: what the series pages are made of. Shared: never mutate it. */
export async function gamePairs(): Promise<ReadonlyMap<string, Entry[]>> {
  return (await index()).pairs;
}
