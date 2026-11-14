import path from "node:path";
import { loadAlignments } from "../lib/alignments";
import { CURRENT_SEASON } from "../lib/season";
import { loadGames, loadSeasonResults } from "../lib/games";
import { seasonRows } from "../lib/program-games";
import { tonightsDate } from "../lib/tonight";

// Tests of "the next game" follow the season's own data, not a named school: each game night's results use up the games
// a fixed program had left. These pick, from the same files the site is built from, a program whose next game is still to
// play (dated tonight or later) and carries a projection. In the offseason there is none, and the test skips with a
// logged reason, so the skip is counted in the report rather than passing silently.

/** The loaders read ../../data from the working directory; the tests run from the repo root. */
async function inWeb<T>(run: () => Promise<T>): Promise<T> {
  const was = process.cwd();
  process.chdir(path.join(__dirname, ".."));
  try {
    return await run();
  } finally {
    process.chdir(was);
  }
}

type Upcoming = { slug: string; school: string };
const NO_UPCOMING = "no program has a game still to play with a projection (offseason, or every listed game is scored)";

/** Programs whose next game is dated tonight or later and shows a projection, in alignment order, and how many unplayed
 * playoff games dated tonight or later show one. */
export const upcoming = (now = new Date()): Promise<{ programs: Upcoming[]; projectedGames: number }> =>
  inWeb(async () => {
    const tonight = tonightsDate(now);
    const alignments = await loadAlignments();
    const [games, results] = await Promise.all([loadGames(alignments), loadSeasonResults(CURRENT_SEASON)]);
    const ahead = games.filter((g) => g.state === "scheduled" && g.projected && (g.date ?? "") >= tonight);
    const seen = new Set<string>();
    const programs: Upcoming[] = [];
    for (const a of alignments) {
      if (seen.has(a.slug)) continue;
      seen.add(a.slug);
      const { next } = seasonRows(a.school, games, results);
      if (next?.playoff && next.date >= tonight && next.note?.startsWith("Projected: ")) {
        programs.push({ slug: a.slug, school: a.school });
      }
    }
    return { programs, projectedGames: ahead.length };
  });

/** Logs why a next-game test is skipped, so the reason shows in the run's output as well as the report. */
export function skipReason(why = NO_UPCOMING): string {
  console.warn(`skipped: ${why}`);
  return why;
}
