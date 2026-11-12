import { heading, loadAlignments, placeLabel, programFor, programsFor, slugify } from "./alignments";
import { roundLabel } from "./brackets";
import type { Game, Team } from "./demo-games";
import { initials, loadPlayoffGames, loadSeasonResults, gameKey, type SeasonResult } from "./games";
import { pairKey } from "./meetings";
import { memo } from "./memo";
import { pregame } from "./pregame";
import type { Projection } from "./projection";
import { loadRatings, record } from "./ratings";
import { CURRENT_SEASON } from "./season";
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

/** Playoff rounds of a past season (the season's playoff file), to say a game was one. The current season's playoff games have bracket pages instead. */
const pastPlayoffs = memo(async (season: number) =>
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
    ...(!current ? { playoff: (await pastPlayoffs(season)).get(gameKey(date, home, away)) } : {}),
    places: { home: place(home), away: place(away) },
    districtGame,
  };
}

/** "Friday, October 24, 2025". */
export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** "Oct 24, 2025". */
export const mediumDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * A robot-read game as the scoreboard's Game, so it shares the playoff game page's look. Unconfirmed, so no winner is
 * named (ADR 0004); a forfeit carries the word and no score, so its 1-0 or 2-0 never reaches the page.
 */
export function resultAsGame({ season, result: r }: Entry, d: GameDetail): Game {
  const team = (name: string, g: Going): Team => ({ name, mascot: "", initials: initials(name), color: "#0a2a5e", record: g.record ? `${g.record} going in` : "" });
  const kind = d.playoff ? `${season} playoffs · ${d.playoff}` : d.districtGame ? `${season} season · District game` : `${season} season`;
  return {
    id: r.id,
    date: r.date,
    league: kind,
    home: team(r.home, d.going.home),
    away: team(r.away, d.going.away),
    homeScore: r.forfeit ? null : r.homeScore,
    awayScore: r.forfeit ? null : r.awayScore,
    state: "final",
    status: r.forfeit ? "Forfeit" : "Final",
    endReason: r.forfeit ? "Forfeit" : undefined,
    verification: "unconfirmed",
    venue: d.playoff ? "Neutral site or not listed" : `${r.home} (home)`,
  };
}
