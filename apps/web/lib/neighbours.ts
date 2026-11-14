import { activeOrgs } from "./active-orgs";
import { loadAlignments } from "./alignments";
import { bracketHref, playoffSeasons, roundLabel } from "./brackets";
import { bracketGames } from "./game-pages";
import { gameKey, loadPlayoffGames, loadSeasonResults, ROUNDS } from "./games";
import { memo } from "./memo";
import { gameInOrg, schoolAlignments } from "./org-games";
import { ORGS, orgHref, type Org } from "./orgs";
import { programSeasonPages } from "./program-seasons";
import { ratingSeasons } from "./ratings";
import { CURRENT_SEASON } from "./season";
import { rankingWeeks } from "./week-rankings";
import { weekHref as reviewHref } from "./week-review-hrefs";
import { reviewedWeeks } from "./week-review-load";
import { loadWeeks } from "./weeks";

// The natural neighbours of a page, as links, so a visitor (and a crawler) can step from a game to its week, its bracket and
// each team's season, and between the results, review and rankings pages of one week. Every link is to a page that exists:
// each helper checks the same lists that build the target pages. Organizations never mix (ADR 0012): a week's links stay in
// its organization. The last round is always called "State Championship", in every league. Link text names a place or a game, never a winner (ADR 0004).

export type Neighbour = { href: string; label: string };

const playoffGames = memo(async (season: number) => {
  const games = await loadPlayoffGames(await loadAlignments(), season);
  return { games, byKey: new Map(games.map((g) => [gameKey(g.date, g.home, g.away), g])) };
});
/** A game's week number in a season, by the game's own id (the weeks the Results pages use). */
const weekOf = memo(async (season: number) => new Map((await loadWeeks(season)).flatMap((w) => w.games.map((g) => [g.id, w.number] as const))));
/** A played game's page address by game key, for past seasons (a past season's playoff game is its own page). */
const pageOf = memo(async (season: number) => new Map((await loadSeasonResults(season)).map((r) => [gameKey(r.date, r.home, r.away), r.href] as const)));
const pastPlayoffSeasons = memo<void, number[]>(async () => (await playoffSeasons()).slice(1));

/**
 * Where a game page leads besides its teams: the playoff bracket it belongs to and its next playoff game (a later round that
 * lists either team), the results week it was played in, and each team's season page. `resultId`: the game's own id when
 * it was read as a result (a game not yet played has none, and so no week).
 */
export async function gameNeighbours({ season, date, home, away, resultId }: { season: number; date?: string; home: string; away: string; resultId?: string }): Promise<Neighbour[]> {
  const out: Neighbour[] = [];
  const playoff = date ? (await playoffGames(season)).byKey.get(gameKey(date, home, away)) : undefined;
  if (playoff) {
    if (season === CURRENT_SEASON) out.push({ href: bracketHref(playoff.bracket), label: `${playoff.bracket} bracket` });
    else if ((await pastPlayoffSeasons()).includes(season)) {
      out.push({ href: playoff.league === "UIL" ? `/playoffs/season/${season}` : `/playoffs/season/${season}/${playoff.league.toLowerCase()}`, label: `${season} ${playoff.league} playoffs` });
    }
    const at = ROUNDS.indexOf(playoff.round);
    const next = (await playoffGames(season)).games
      .filter((g) => g.bracket === playoff.bracket && ROUNDS.indexOf(g.round) > at && [g.home, g.away].some((t) => t === playoff.home || t === playoff.away))
      .sort((a, b) => ROUNDS.indexOf(a.round) - ROUNDS.indexOf(b.round) || a.date.localeCompare(b.date))[0];
    const id = next && (season === CURRENT_SEASON ? (await bracketGames()).find((g) => g.round === next.round && g.home.name === next.home && g.away.name === next.away)?.id : (await pageOf(season)).get(gameKey(next.date, next.home, next.away))?.slice("/scores/".length));
    if (next && id) out.push({ href: `/scores/${id}`, label: `Next playoff game: ${next.round === "final" || next.round === "state" ? "State Championship" : roundLabel(next.round, next.league)}, ${next.away} at ${next.home}` });
  }
  const week = resultId ? (await weekOf(season)).get(resultId) : undefined;
  if (week) {
    const schools = await schoolAlignments();
    const org = ORGS.find((o) => gameInOrg(schools, o, { home, away }));
    if (org) out.push({ href: orgHref(`/results/${season}/${week}`, org), label: `${org.label} ${season} week ${week} results` });
  }
  const [alignments, pages] = await Promise.all([loadAlignments(), programSeasonPages()]);
  for (const team of [away, home]) {
    const slug = alignments.find((a) => a.school === team)?.slug;
    if (slug && pages.get(slug)?.includes(season)) out.push({ href: `/programs/${slug}/${season}`, label: `${team} ${season} season` });
  }
  return out;
}

/** The other two pages of one organization's week: its results, its week in review (only a week with a game has one) and, for
 * the season under way, its rankings after the week. Each is present only when that page exists. */
export async function weekNeighbours({ season, week, org }: { season: number; week: number; org: Org }) {
  const [reviewed, active, ranked, [latest]] = await Promise.all([reviewedWeeks(season, org), activeOrgs(), rankingWeeks(season), ratingSeasons()]);
  return {
    results: { href: orgHref(`/results/${season}/${week}`, org), label: `${org.label} week ${week} results` } satisfies Neighbour,
    review: active.includes(org) && reviewed.some((w) => w.number === week) ? ({ href: reviewHref(season, week, org), label: `${org.label} week ${week} in review` } satisfies Neighbour) : undefined,
    rankings: season === latest && active.includes(org) && ranked.some((w) => w.number === week) ? ({ href: orgHref(`/rankings/week/${week}`, org), label: `${org.label} rankings after week ${week}` } satisfies Neighbour) : undefined,
  };
}
