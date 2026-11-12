import { loadSeasonResults, type SeasonResult } from "./games";
import { gameInOrg, schoolAlignments, teamInOrg } from "./org-games";
import { ORGS, type Org } from "./orgs";
import { pregame } from "./pregame";
import { loadRatings } from "./ratings";
import { resultSeasons } from "./weeks";

// Records across every season read (robot-read results, ADR 0008): the most points, the longest winning runs, the
// unbeaten seasons. Scores are unconfirmed, so the page says so; counts are what the files hold, not an official book.
// One organization at a time (ADR 0012): a record about a team (most points, runs, unbeaten seasons) counts only teams in
// the organization; a record about a game (most by both teams, upsets) counts any game with a team in it.

type GameRecord = { season: number; href: string; date: string; team: string; opponent: string; points: number; against: number; home: boolean };
type Streak = { team: string; wins: number; from: string; to: string; current: boolean };
type Unbeaten = { season: number; team: string; won: number; tied: number };
/** A game the team given the lower win probability beforehand won; `chance` is the winner's win probability. */
type Upset = { season: number; href: string; date: string; winner: string; loser: string; won: number; lost: number; chance: number };
export type Records = {
  seasons: number[];
  games: number;
  mostPoints: GameRecord[];
  mostCombined: GameRecord[];
  streaks: Streak[];
  unbeaten: Unbeaten[];
  upsets: Upset[];
};

const TOP = 10;
/** A season with fewer wins than this is not listed as unbeaten: a short schedule read is not a season. */
const UNBEATEN_MIN_WINS = 8;

/** Each game twice, once from each side, oldest first. */
function sides(games: (SeasonResult & { season: number })[]): GameRecord[] {
  return games.flatMap((g) => [
    { season: g.season, href: g.href, date: g.date, team: g.home, opponent: g.away, points: g.homeScore, against: g.awayScore, home: true },
    { season: g.season, href: g.href, date: g.date, team: g.away, opponent: g.home, points: g.awayScore, against: g.homeScore, home: false },
  ]);
}

/** Longest runs of wins in a row, across seasons; a tie or a loss ends a run. One entry per team: its longest, marked
 * `current` when no loss or tie has ended it yet. */
function longestStreaks(all: GameRecord[]): Streak[] {
  const latest = Math.max(...all.map((g) => g.season));
  const byTeam = Map.groupBy(all, (g) => g.team);
  const best: Streak[] = [];
  for (const [team, games] of byTeam) {
    games.sort((a, b) => a.date.localeCompare(b.date));
    let top: Streak | undefined;
    let run: Streak | undefined;
    for (const g of games) {
      if (g.points > g.against) {
        run = run ? { ...run, wins: run.wins + 1, to: g.date } : { team, wins: 1, from: g.date, to: g.date, current: false };
        if (!top || run.wins > top.wins) top = run;
      } else run = undefined;
    }
    // Still going only when nothing has ended it and the team has played in the latest season read: a run whose last
    // game was years ago ended in games the files do not hold.
    if (top) best.push({ ...top, current: run?.from === top.from && games.at(-1)!.season === latest });
  }
  return best.sort((a, b) => b.wins - a.wins || b.to.localeCompare(a.to) || a.team.localeCompare(b.team)).slice(0, TOP);
}

/** Biggest upsets: games the team the ratings gave the lower win probability beforehand won (lib/pregame.ts). */
async function seasonUpsets(season: number, org: Org, schools: Awaited<ReturnType<typeof schoolAlignments>>): Promise<Upset[]> {
  const [games, before] = await Promise.all([loadSeasonResults(season), pregame(season)]);
  return games.filter((g) => gameInOrg(schools, org, g)).flatMap((g) => {
    const p = before.get(g.id);
    const [winner, loser, won, lost] = g.homeScore > g.awayScore ? [g.home, g.away, g.homeScore, g.awayScore] : [g.away, g.home, g.awayScore, g.homeScore];
    return p && p.favorite !== winner ? [{ season, href: g.href, date: g.date, winner, loser, won, lost, chance: 1 - p.winProbability }] : [];
  });
}

export async function loadRecords(org: Org = ORGS[0]): Promise<Records> {
  const [seasons, schools] = await Promise.all([resultSeasons(org), schoolAlignments()]);
  const mine = (team: string) => teamInOrg(schools, org, team);
  const games = (
    await Promise.all(seasons.map(async (season) => (await loadSeasonResults(season)).filter((g) => gameInOrg(schools, org, g)).map((g) => ({ ...g, season }))))
  ).flat();
  const all = sides(games);
  const ours = all.filter((g) => mine(g.team)); // the organization's own side of each game: the opponent may be from another one
  const byPoints = (a: GameRecord, b: GameRecord) => b.points - a.points || a.date.localeCompare(b.date);
  const mostPoints = [...ours].sort(byPoints).slice(0, TOP);
  const mostCombined = all
    .filter((g) => g.points > g.against || (g.points === g.against && g.home)) // one row a game: the side that scored more (or the home side of a tie)
    .sort((a, b) => b.points + b.against - (a.points + a.against) || a.date.localeCompare(b.date))
    .slice(0, TOP);
  const unbeaten = (
    await Promise.all(
      seasons.map(async (season) =>
        (await loadRatings(season)).teams
          .filter((t) => mine(t.team) && t.lost === 0 && t.won >= UNBEATEN_MIN_WINS)
          .map((t) => ({ season, team: t.team, won: t.won, tied: t.tied })),
      ),
    )
  )
    .flat()
    .sort((a, b) => b.season - a.season || b.won - a.won || a.team.localeCompare(b.team));
  const upsets = (await Promise.all(seasons.map((s) => seasonUpsets(s, org, schools)))).flat().sort((a, b) => a.chance - b.chance || b.date.localeCompare(a.date)).slice(0, TOP);
  return { seasons, games: games.length, mostPoints, mostCombined, streaks: longestStreaks(ours), unbeaten, upsets };
}
