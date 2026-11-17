import { loadFinals } from "./champions";
import { loadLineage, successorOf } from "./lineage";
import { memo } from "./memo";
import { recordedFinals } from "./state-championships";
import { type Appearance, appearancesOf } from "./state-finals";

// Each team's State Championship history before a season's (ADR 0083, ADR 0088): the games it played in its league's list of
// State Championships, newest first, and how many it won. UIL's list is its archive (with any recorded final the archive does
// not hold yet); a private league's is its recorded finals. A renamed or merged school counts under the program it became.

const successors = memo<void, ReadonlyMap<string, string>>(async () => successorOf(await loadLineage()));

/** Every State Championship of a league's list, every season, with the bracket's name (UIL's by its division). */
const finalsOf = memo<string, { season: number; league: string; bracket: string; champion: string; runnerUp: string; championScore?: number | null; runnerUpScore?: number | null }[]>(async (league) =>
  league === "UIL"
    ? (await loadFinals()).map((f) => ({ ...f, league: "UIL", bracket: f.division ? `UIL Division ${f.division}` : "UIL" }))
    : (await recordedFinals()).filter((f) => f.league !== "UIL"),
);

export type TeamHistory = { team: string; past: Appearance[]; titles: number };

/** Each of `teams`' earlier State Championships in `league`'s list, leaving out `season` (the game being looked at). */
export async function titleHistory(league: string, teams: string[], season: number): Promise<TeamHistory[]> {
  const [finals, back] = await Promise.all([finalsOf(league), successors()]);
  return teams.map((team) => {
    const past = appearancesOf(team, finals, back).filter((a) => a.season !== season);
    return { team, past, titles: past.filter((a) => a.won).length };
  });
}
