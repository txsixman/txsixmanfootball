import { loadAlignments, uniquePrograms } from "@/lib/alignments";
import { LEAGUES, loadBrackets } from "@/lib/brackets";
import { loadFinals } from "@/lib/champions";
import { nightTitle } from "@/lib/game-night";
import { loadSeasonResults } from "@/lib/games";
import { memo } from "@/lib/memo";
import { ORGS } from "@/lib/orgs";
import { centralClock } from "@/lib/playoff-status";
import { CURRENT_SEASON } from "@/lib/season";
import { roundTotal, thisRound } from "@/lib/this-round";
import { loadNight } from "@/lib/tonight";
import { bracketWords, roundLine, type Facts } from "@/lib/welcome";
import { resultSeasons } from "@/lib/weeks";

/** The organizations as the landing page names them: the independent programs are "independents", not a league. */
export const WELCOME_ORGS = ORGS.map((o) => (o.league === "Independent" ? "independents" : o.label));

/**
 * Everything the landing page and its share card say that comes from data, read when the site is built (ADR 0084): the
 * counts, the round being played in every bracket (the same lists and count as /playoffs/this-round) and tonight's games
 * (the same as /scores/tonight).
 */
export const loadWelcome = memo<void, Facts & { live: string; roundGames: number; brackets: string }>(async () => {
  const [alignments, finals, seasons, brackets, tonight] = await Promise.all([loadAlignments(), loadFinals(), resultSeasons(), loadBrackets(), loadNight()]);
  const perSeason = await Promise.all(seasons.map(async (s) => ({ season: s, games: (await loadSeasonResults(s)).length })));
  const round = thisRound(brackets, LEAGUES, centralClock().date);
  const roundGames = round.reduce((n, g) => n + g.brackets.reduce((m, b) => m + roundTotal(b.round), 0), 0);
  const finalSeasons = finals.map((f) => f.season);
  return {
    programs: uniquePrograms(alignments).length,
    games: perSeason.reduce((n, s) => n + s.games, 0),
    seasons: seasons.length,
    firstSeason: Math.min(...seasons),
    latestSeason: Math.max(...seasons),
    finals: finals.length,
    firstFinal: Math.min(...finalSeasons),
    orgs: WELCOME_ORGS,
    roundGames,
    brackets: bracketWords(brackets.filter((b) => b.rounds.some((r) => r.games.length || r.built.length)), LEAGUES),
    live: roundLine({
      season: CURRENT_SEASON,
      round: roundGames,
      leagues: round.map((g) => g.league),
      tonight: { title: nightTitle(tonight.night), count: tonight.count },
      seasonGames: perSeason.find((s) => s.season === CURRENT_SEASON)?.games ?? 0,
    }),
  };
});
