// State Championship results as one list for every page (ADR 0083). Pure, one local import: the node tests run it as it is
// (scripts/state-finals.test.mjs).
//
// A State Championship game's champion is known the moment its final is recorded, by the results robot or a correction:
// played, confirmed (not disputed, ADR 0040) and not a tie. A forfeit names its winner too, with no score. UIL's own archive
// (data/seed/uil-champions) stays the record for UIL: a recorded UIL final fills a season and division the archive does not
// have yet, and the archive wins once it lists it. The private leagues have no archive here: their recorded finals are
// their record.

import { slugify } from "./slug.ts";

/** The last round of every league's bracket: UIL "state", the private leagues "final". */
export const STATE_ROUNDS: ReadonlySet<string> = new Set(["final", "state"]);

/** A playoff game as lib/games.ts loadPlayoffGames gives it (team names as our alignments spell them). */
export type RecordedGame = {
  league: string; bracket: string; division: string; round: string; date: string; home: string; away: string;
  homeScore?: number; awayScore?: number; forfeit: boolean; confirmed: boolean;
};

/** A State Championship with a champion. `bracket` is the bracket's name ("TAPPS Division II Large School", "TCAF"). */
export type LeagueFinal = {
  season: number; league: string; bracket: string; division: string; date: string;
  champion: string; runnerUp: string;
  /** Absent for a forfeit: the site never shows a forfeit's score (ADR 0004). */
  championScore?: number; runnerUpScore?: number; forfeit: boolean;
};

/** The champion of a State Championship game, or undefined while it has none: not the last round, not played, disputed
 * (ADR 0040) or a tie. */
export function finalOf(season: number, g: RecordedGame): LeagueFinal | undefined {
  if (!STATE_ROUNDS.has(g.round) || !g.confirmed) return undefined;
  if (g.homeScore == null || g.awayScore == null || g.homeScore === g.awayScore) return undefined;
  const homeWon = g.homeScore > g.awayScore;
  const [champion, runnerUp] = homeWon ? [g.home, g.away] : [g.away, g.home];
  const [won, lost] = homeWon ? [g.homeScore, g.awayScore] : [g.awayScore, g.homeScore];
  return {
    season, league: g.league, bracket: g.bracket, division: g.division, date: g.date, champion, runnerUp, forfeit: g.forfeit,
    ...(g.forfeit ? {} : { championScore: won, runnerUpScore: lost }),
  };
}

/** The UIL archive's shape (lib/champions.ts Final), kept here so this file needs no file reads. */
export type ArchiveFinal = {
  season: number; conference: string; division: string; champion: string; runnerUp: string;
  championScore: number | null; runnerUpScore: number | null; scoreNote: string; notes: string;
};

/** The UIL archive plus each recorded UIL final for a season and division it does not list yet, oldest first. */
export function withRecorded(archive: ArchiveFinal[], recorded: LeagueFinal[]): ArchiveFinal[] {
  const listed = new Set(archive.map((f) => `${f.season}|${f.division}`));
  const added = recorded
    .filter((f) => f.league === "UIL" && !listed.has(`${f.season}|${f.division}`))
    .map((f): ArchiveFinal => ({
      season: f.season, conference: "1A", division: f.division, champion: f.champion, runnerUp: f.runnerUp,
      championScore: f.championScore ?? null, runnerUpScore: f.runnerUpScore ?? null, scoreNote: f.forfeit ? "Forfeit" : "", notes: "",
    }));
  return [...archive, ...added].sort((a, b) => a.season - b.season || a.division.localeCompare(b.division));
}

/** One school's State Championship games in one league's list, newest first: each with the season, the bracket, whether it
 * won and the other team. `successors` (lib/lineage.ts) counts a renamed or merged school's games under the program it
 * became, as title counts do. */
export type Appearance = { season: number; league: string; bracket: string; won: boolean; opponent: string; score?: string };

export function appearancesOf(school: string, finals: { season: number; league: string; bracket: string; champion: string; runnerUp: string; championScore?: number | null; runnerUpScore?: number | null }[], successors: ReadonlyMap<string, string> = new Map()): Appearance[] {
  const now = (name: string) => successors.get(slugify(name)) ?? name;
  const me = slugify(now(school));
  const out: Appearance[] = [];
  for (const f of finals) {
    const won = slugify(now(f.champion)) === me;
    if (!won && slugify(now(f.runnerUp)) !== me) continue;
    const score = f.championScore != null && f.runnerUpScore != null ? `${f.championScore}-${f.runnerUpScore}` : undefined;
    out.push({ season: f.season, league: f.league, bracket: f.bracket, won, opponent: won ? f.runnerUp : f.champion, ...(score ? { score } : {}) });
  }
  return out.sort((a, b) => b.season - a.season || a.bracket.localeCompare(b.bracket));
}

/** "2026 State Champion" (or "2026 TAPPS Division I State Champion" when `withBracket`), for the season's title, if any. */
export function championLine(school: string, season: number, finals: LeagueFinal[], withBracket = false): string | undefined {
  const f = finals.find((x) => x.season === season && slugify(x.champion) === slugify(school));
  if (!f) return undefined;
  return withBracket ? `${season} ${f.bracket} State Champion` : `${season} State Champion`;
}
