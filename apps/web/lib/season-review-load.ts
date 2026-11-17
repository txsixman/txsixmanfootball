import { loadAlignments } from "./alignments";
import { type Final, finalScore, loadFinals } from "./champions";
import { gameKey, loadSeasonResults } from "./games";
import { memo } from "./memo";
import { gameInOrg, schoolAlignments, teamInOrg } from "./org-games";
import { ORGS, type Org } from "./orgs";
import { pregame } from "./pregame";
import { rankedOrder } from "./rank-range";
import { placeTeams } from "./rankings";
import { FEW_GAMES, loadRatings } from "./ratings";
import {
  bestRecords, biggestRisers, closestPlayoffGames, seasonStreaks, seasonTotals,
  type CloseGame, type Riser, type SeasonStreak, type TeamRecord, type Totals,
} from "./season-review";
import type { SeasonResult } from "./season-results";
import { recordedFinals } from "./state-championships";
import { teamSequences, upsets, type Upset } from "./week-recap";
import { rankingWeeks } from "./week-rankings";
import { disputedIds, playoffHistory, sequencesThrough, weekMilestones, type Milestone } from "./week-review-load";

// One organization's season in review (/seasons/<year>, ADR 0099), from the same results, ratings, projections and playoff
// files the rest of the site reads. The pure rules are lib/season-review.ts and lib/week-recap.ts; this file only gathers
// their inputs. Each organization is counted alone (ADR 0012): its own teams for a record, a streak, a rating or a first,
// any game with one of its teams for a total or an upset.

type ReviewChampion = { label: string; champion: string; runnerUp: string; score: string; game?: SeasonResult };
type ReviewClose = CloseGame & { result: SeasonResult };
type ReviewStart = { team: string; rating: number; mercy_only?: true };

export type SeasonReview = {
  org: Org;
  season: number;
  champions: ReviewChampion[];
  totals: Totals;
  unbeaten: TeamRecord[];
  best: TeamRecord[];
  /** The ten games the ratings gave the winner the lowest chance in, lowest first, and how many such games the season had. */
  upsets: Upset[];
  upsetCount: number;
  close: ReviewClose[];
  streaks: (SeasonStreak & { firstGame?: SeasonResult; lastGame?: SeasonResult })[];
  highest?: ReviewStart;
  risers: Riser[];
  milestones: Milestone[];
};

const UPSETS_SHOWN = 10;

/** "Division I" for a UIL division, "Six-man" for UIL's one bracket, and a private league's bracket without its league's name. */
const bracketLabel = (league: string, bracket: string, division = ""): string =>
  league === "UIL" ? (division ? `Division ${division}` : "Six-man") : bracket === league ? "" : bracket.startsWith(`${league} `) ? bracket.slice(league.length + 1) : bracket;

/** The season's State Championships recorded for the organization, with the game they were played in when the results hold it. */
const championsOf = memo(async (key: string): Promise<ReviewChampion[]> => {
  const [season, league] = [Number(key.split("|")[0]), key.split("|")[1]];
  const [results, recorded] = await Promise.all([loadSeasonResults(season), recordedFinals()]);
  const byKey = new Map(results.map((g) => [gameKey(g.date, g.home, g.away), g]));
  const mine = recorded.filter((f) => f.season === season && f.league === league);
  const rows: { label: string; champion: string; runnerUp: string; score: string; date?: string }[] =
    league === "UIL"
      ? (await loadFinals()).filter((f: Final) => f.season === season).map((f) => ({
          label: bracketLabel("UIL", "", f.division),
          champion: f.champion,
          runnerUp: f.runnerUp,
          score: finalScore(f),
          date: mine.find((r) => r.division === f.division)?.date,
        }))
      : mine.map((f) => ({
          label: bracketLabel(league, f.bracket),
          champion: f.champion,
          runnerUp: f.runnerUp,
          score: f.championScore != null ? `${f.championScore}-${f.runnerUpScore}` : "Forfeit",
          date: f.date,
        }));
  return rows
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ date, ...row }) => ({ ...row, game: date ? byKey.get(gameKey(date, row.champion, row.runnerUp)) : undefined }));
});

const loadReview = memo(async (key: string): Promise<SeasonReview> => {
  const [season, slug] = [Number(key.split("|")[0]), key.split("|")[1]];
  const org = ORGS.find((o) => o.slug === slug)!;
  const [results, table, alignments, schools, before, disputed, weeks, history, through, champions] = await Promise.all([
    loadSeasonResults(season),
    loadRatings(season),
    loadAlignments(),
    schoolAlignments(),
    pregame(season),
    disputedIds(season),
    rankingWeeks(season),
    playoffHistory(),
    sequencesThrough(season),
    championsOf(`${season}|${org.league}`),
  ]);
  const mine = (team: string) => teamInOrg(schools, org, team);
  const games = results.filter((g) => gameInOrg(schools, org, g));
  const sequences = teamSequences(results.map((g) => ({ ...g, season })), disputed);
  const { unbeaten, best } = bestRecords(sequences, mine);

  const byKey = new Map(results.map((g) => [gameKey(g.date, g.home, g.away), g]));
  const playoffs = history.seasons.find((s) => s.season === season)?.games.filter((g) => g.league === org.league) ?? [];
  const close = closestPlayoffGames(playoffs).flatMap((c) => {
    const result = byKey.get(gameKey(c.game.date, c.game.home, c.game.away));
    return result ? [{ ...c, result }] : [];
  });

  const byId = new Map(results.map((g) => [g.id, g]));
  const streaks = seasonStreaks(sequences, mine).map((s) => ({ ...s, firstGame: byId.get(s.first), lastGame: byId.get(s.last) }));

  const rows = placeTeams(table.teams, alignments).placed.filter((r) => r.school.league === org.league);
  const top = rankedOrder(rows)[0];
  const week4 = weeks.find((w) => w.number === 4);
  const risers = week4
    ? biggestRisers(
        rows.map((r) => ({ team: r.team, rating: r.rating, rated: r.rated, start: r.trend?.[week4.index] ?? null, startRated: r.rated_trend?.[week4.index] ?? 0 })),
        FEW_GAMES,
      )
    : [];

  const all = upsets(games, before, disputed);
  // Firsts over the whole season: a first playoff win, a first State Championship game (the oldest season held claims none of
  // the first, weekMilestones). A team's first loss of the season is the week recap's, not this list's.
  const milestones = (await weekMilestones(org, season, "0000-01-01", "9999-12-31", games, through.sequences, schools)).filter((m) => m.kind !== "first-loss");

  return {
    org,
    season,
    champions,
    totals: seasonTotals(games),
    unbeaten,
    best,
    upsets: all.slice(0, UPSETS_SHOWN),
    upsetCount: all.length,
    close,
    streaks,
    highest: top && { team: top.team, rating: top.rating, mercy_only: top.mercy_only },
    risers,
    milestones,
  };
});

/** An organization's season in review. Shared across pages: never mutate it. */
export const loadSeasonReview = (season: number, org: Org): Promise<SeasonReview> => loadReview(`${season}|${org.slug}`);

