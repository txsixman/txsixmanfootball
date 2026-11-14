import { loadAlignments, programsFor } from "./alignments";
import { roundLabel } from "./brackets";
import { groupNight, gameNight, isNight, onNight, type Slot } from "./game-night";
import { loadGames, loadSeasonResults, ROUNDS } from "./games";
import { ORGS, orgOfLabel } from "./orgs";
import { isForfeit } from "./score-display";
import { CURRENT_SEASON } from "./season";
import { isDisputed, loadDisputed } from "./disputed";

// One game night's games for the "Tonight" scoreboard (/scores/tonight) and the home page's link to it: the bracket games
// dated that night, and any other robot-read game of the season dated that night, by organization and round. Read when
// the page is built. A score is the reader's, so a final is "Unconfirmed" and no winner is named (ADR 0004).

/** One game as the scoreboard shows it. Plain data: the board is a client component (it reads live scores in the browser). */
export type NightGame = {
  id: string;
  href: string;
  date: string;
  away: string;
  home: string;
  /** "UIL D1" for a bracket game, "Season game" for any other. */
  where: string;
  /** No score yet, a score the reader gave, or a forfeit. */
  state: "later" | "final" | "forfeit";
  /** Scores in the order the page lists the teams (away first); null before there is one. */
  awayScore: number | null;
  homeScore: number | null;
  /** True for every score the reader gave; false only for a hand-confirmed one. */
  unconfirmed: boolean;
  /** "Jayton by 12 · 74% win probability" for a game not yet played, when both teams are rated. */
  projected?: string;
  /** Kickoff in UTC, for a game not yet played, when known (ADR 0036). */
  kickoff?: string;
};
type NightRound = { label: string; games: NightGame[] };
type NightOrg = { slug: string; label: string; rounds: NightRound[] };
export type Night = { night: string; count: number; orgs: NightOrg[] };

/**
 * The night to show: `GAME_NIGHT` (a "YYYY-MM-DD" date, for trying a page on a night with games or none) when it is set,
 * else the game night of `now` (lib/game-night.ts). The environment is read when the page is built, never in the browser.
 */
export const tonightsDate = (now = new Date(), override = process.env.GAME_NIGHT) => (isNight(override) ? override : gameNight(now));

/** Every game of `night`, grouped. `night` defaults to tonight; a test or a page for another night passes its own. */
export async function loadNight(night = tonightsDate()): Promise<Night> {
  const alignments = await loadAlignments();
  const slots: Slot<NightGame>[] = [];
  const bracket = onNight(await loadGames(alignments), night);
  for (const g of bracket) {
    const org = orgOfLabel(g.league);
    if (!org || !g.round) continue;
    const forfeit = isForfeit(g);
    slots.push({
      org: org.slug,
      round: g.round,
      sort: `${g.league}|${g.away.name}`,
      game: {
        id: g.id,
        href: `/scores/${g.id}`,
        date: night,
        away: g.away.name,
        home: g.home.name,
        where: g.league.split(" · ")[0],
        state: forfeit ? "forfeit" : g.state === "final" ? "final" : "later",
        awayScore: forfeit ? null : g.awayScore,
        homeScore: forfeit ? null : g.homeScore,
        unconfirmed: g.state === "final" && g.verification !== "confirmed",
        ...(g.projected ? { projected: g.projected } : {}),
        ...(g.kickoff ? { kickoff: g.kickoff } : {}),
      },
    });
  }
  // Any other robot-read game of the night (a playoff game is already above, under its bracket page): under each organization with a team in it.
  const disputed = await loadDisputed(CURRENT_SEASON);
  for (const r of onNight(await loadSeasonResults(CURRENT_SEASON), night)) {
    if (r.href !== `/scores/${r.id}`) continue;
    const leagues = new Set([...programsFor(alignments, r.home), ...programsFor(alignments, r.away)].map((a) => a.league));
    for (const org of ORGS.filter((o) => leagues.has(o.league))) {
      slots.push({
        org: org.slug,
        round: "",
        sort: `${r.away}|${r.home}`,
        game: {
          id: r.id,
          href: r.href,
          date: night,
          away: r.away,
          home: r.home,
          where: "Season game",
          state: r.forfeit ? "forfeit" : "final",
          awayScore: r.forfeit ? null : r.awayScore,
          homeScore: r.forfeit ? null : r.homeScore,
          unconfirmed: !r.forfeit && isDisputed(disputed, r.date, r.home, r.away), // a final is confirmed unless disputed (ADR 0040)
        },
      });
    }
  }
  const orgs = groupNight(slots, ORGS.map((o) => o.slug), ROUNDS).map(({ org, rounds }) => ({
    slug: org,
    label: ORGS.find((o) => o.slug === org)!.label,
    rounds: rounds.map(({ round, games }) => ({ label: round ? roundLabel(round, ORGS.find((o) => o.slug === org)!.league) : "Season games", games })),
  }));
  return { night, count: new Set(orgs.flatMap((o) => o.rounds.flatMap((r) => r.games.map((g) => g.id)))).size, orgs };
}
