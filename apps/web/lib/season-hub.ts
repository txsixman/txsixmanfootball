import { loadAlignments, programFor, programsFor } from "./alignments";
import { playoffLeagues, playoffSeasons } from "./brackets";
import { type Final, loadFinals } from "./champions";
import { loadSeasonResults } from "./games";
import { memo } from "./memo";
import { schoolAlignments, teamInOrg } from "./org-games";
import { ORGS, type Org } from "./orgs";
import { rankedOrder } from "./rank-range";
import { placeTeams } from "./rankings";
import { CURRENT_SEASON } from "./season";
import { loadRatings, ratingSeasons, record } from "./ratings";
import { type Leader, teamLeaders } from "./season-leaders";
import { reviewedWeeks } from "./week-review-load";
import { loadWeeks, resultSeasons } from "./weeks";

// One season's hub (/seasons/<year>): the UIL state finals, then each organization on its own (ADR 0012): its top five by
// rating, team leaders and where its season lives on the site. Records, ranks and averages may rest on unconfirmed
// robot-read scores (ADR 0013); nothing here names the winner of a game (ADR 0004). UIL's state finals are official
// results from UIL's own archive.

const TOP = 5;

type HubTeam = { name: string; slug: string; record: string; rating: number };
/** `slug`: the program page, when the alignments list the team. */
export type HubLeader = Leader & { slug?: string };
export type OrgHub = {
  org: Org;
  top: HubTeam[];
  /** Teams with enough games to hold a rank. */
  ranked: number;
  scored: HubLeader[];
  allowed: HubLeader[];
  /** The organization's playoffs this season have a page. */
  playoffs: boolean;
  /** The last week of the season with a game of this organization, for its week-in-review link. */
  lastReviewWeek?: number;
};
export type SeasonHub = {
  season: number;
  /** The season under way: its pages live at the bare addresses (/results, /rankings, /playoffs). */
  latest: boolean;
  /** The newest season with a ratings table (what `seasonHref` takes to tell the season under way from past ones). */
  current: number;
  games: number;
  /** Programs on this site with a game that season. */
  programs: number;
  finals: Final[];
  /** Organizations with a game that season, in site order. */
  orgs: OrgHub[];
  /** Week numbers with a game of any organization, with the Monday each starts on. */
  weeks: { number: number; monday: string }[];
  /** Weeks with a UIL week-in-review page. */
  reviewWeeks: number[];
  /** The season's UIL playoffs have a page. */
  uilPlayoffs: boolean;
};

/** Seasons with games read, FIRST_SEASON (lib/season.ts) to the current season, newest first. */
export const hubSeasons = memo<void, number[]>(async () => (await resultSeasons()).filter((s) => s <= CURRENT_SEASON));

export const loadSeasonHub = memo(async (season: number): Promise<SeasonHub> => {
  const [results, table, alignments, schools, ratingYears, leagues, playoffYears, finals, weeks, orgSeasons] = await Promise.all([
    loadSeasonResults(season),
    loadRatings(season),
    loadAlignments(),
    schoolAlignments(),
    ratingSeasons(),
    playoffLeagues(season),
    playoffSeasons(),
    loadFinals(),
    loadWeeks(season),
    Promise.all(ORGS.map((o) => resultSeasons(o))),
  ]);
  const latest = season === ratingYears[0];
  const { placed } = placeTeams(table.teams, alignments);
  const played = ORGS.filter((_, i) => orgSeasons[i].includes(season));
  const orgs = await Promise.all(
    played.map(async (org): Promise<OrgHub> => {
      const rows = placed.filter((r) => r.school.league === org.league);
      const top = rankedOrder(rows).slice(0, TOP).map((r) => ({ name: r.school.school, slug: r.school.slug, record: record(r), rating: r.rating }));
      const { scored, allowed } = teamLeaders(results, (team) => teamInOrg(schools, org, team));
      const withSlug = (l: Leader): HubLeader => ({ ...l, slug: programFor(alignments, l.team, org.league)?.slug });
      return {
        org,
        top,
        ranked: rankedOrder(rows).length,
        scored: scored.map(withSlug),
        allowed: allowed.map(withSlug),
        playoffs: leagues.includes(org.league as (typeof leagues)[number]),
        lastReviewWeek: (await reviewedWeeks(season, org)).at(-1)?.number,
      };
    }),
  );
  const programs = new Set(results.flatMap((g) => [g.home, g.away]).flatMap((t) => programsFor(alignments, t).map((a) => a.slug)));
  return {
    season,
    latest,
    current: ratingYears[0],
    games: results.length,
    programs: programs.size,
    finals: finals.filter((f) => f.season === season).sort((a, b) => a.division.localeCompare(b.division)),
    orgs,
    weeks: weeks.map((w) => ({ number: w.number, monday: w.monday })),
    reviewWeeks: (await reviewedWeeks(season, ORGS[0])).map((w) => w.number),
    uilPlayoffs: playoffYears.includes(season) && leagues.includes("UIL"),
  };
});
