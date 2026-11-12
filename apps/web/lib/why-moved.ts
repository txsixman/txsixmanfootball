import { loadSeasonResults } from "./games";
import { pregame } from "./pregame";
import { loadRatings } from "./ratings";

// Why a team's rating moved: for each week of the season, the game that went furthest from what the ratings projected
// the week before (lib/pregame.ts: judged once both teams had four games, no ties, no forfeits). The distance is the
// team's own margin minus its projected margin, both clipped at the 45-point rule, which a final cannot show beyond.
// A week whose biggest miss is under MIN_SURPRISE points went as projected and is left out.

export const MIN_SURPRISE = 3;
const CAP = 45;

export type Surprise = {
  id: string;
  /** The game's page. */
  href: string;
  /** "Fri 10/24". */
  status: string;
  opponent: string;
  /** "vs" (home) or "at" (away), as the schedule rows say; a game line names no winner (ADRs 0004, 0013). */
  lead: string;
  /** This team's score first, "42-14", as the schedule rows show it. */
  score: string;
  /** "projected margin +6", "projected margin -20" or "projected even". */
  projected: string;
  /** Points better (positive) or worse (negative) than projected. */
  surprise: number;
};

const clip = (n: number) => Math.max(-CAP, Math.min(CAP, n));
/** Points a team's own margin (us minus them) went past its projected margin, both clipped at the 45-point rule. Positive is better than projected. */
export const surpriseOf = (us: number, them: number, projected: number) => clip(us - them) - clip(projected);
const by = (n: number) => (n >= CAP ? "45+" : String(Math.round(n)));

/** One line per week for `team`, oldest first. */
export async function whyItMoved(season: number, team: string): Promise<Surprise[]> {
  const [table, results, before] = await Promise.all([loadRatings(season), loadSeasonResults(season), pregame(season)]);
  const weeks = table.weeks ?? [];
  const best = new Map<number, Surprise>();
  for (const g of results) {
    const p = before.get(g.id);
    if (!p || (g.home !== team && g.away !== team)) continue;
    const home = g.home === team;
    const [us, them] = home ? [g.homeScore, g.awayScore] : [g.awayScore, g.homeScore];
    const projected = p.favorite === team ? p.margin : -p.margin;
    const surprise = surpriseOf(us, them, projected);
    const week = weeks.findLastIndex((w) => w < g.date);
    if (Math.abs(surprise) < MIN_SURPRISE || (best.get(week) && Math.abs(best.get(week)!.surprise) >= Math.abs(surprise))) continue;
    best.set(week, {
      id: g.id,
      href: g.href,
      status: g.status,
      opponent: home ? g.away : g.home,
      lead: home ? "vs" : "at",
      score: `${us}-${them}`,
      projected: Math.abs(projected) < 0.5 ? "projected even" : `projected margin ${projected > 0 ? "+" : "-"}${by(Math.abs(projected))}`,
      surprise,
    });
  }
  return [...best].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}
