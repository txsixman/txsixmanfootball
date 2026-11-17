import { heading, loadAlignments, placeLabel, programsFor } from "./alignments";
import { roundLabel } from "./brackets";
import { isDisputed, loadDisputed } from "./disputed";
import { gameKey, loadPlayoffGames, ROUNDS } from "./games";
import type { Org } from "./orgs";
import { resultsText, type TextGame } from "./results-text";
import { CURRENT_SEASON } from "./season";
import { loadWeeks } from "./weeks";

const DAY = 86_400_000;

/**
 * One week of one organization's results as plain text (ADR 0102): the games the Results page lists, placed in a district,
 * outside districts, or in a playoff round. A district game is two teams of one numbered district; only the current season
 * has alignments to say so, so a past season's regular-season games are listed as plain "games", not claimed to be outside a district, and a
 * playoff round names its games (a game page tells the same way, lib/game-pages.ts). A game with a team from another organization stays in its own organization's text (ADR 0012).
 * Undefined when the week has no game.
 */
export async function loadResultsText(org: Org, season: number, week: number): Promise<string | undefined> {
  const all = await loadAlignments();
  const alignments = season === CURRENT_SEASON ? all : [];
  const [weeks, disputed, playoffs] = await Promise.all([loadWeeks(season, org), loadDisputed(season), loadPlayoffGames(all, season)]);
  const shown = weeks.find((w) => w.number === week);
  if (!shown?.games.length) return undefined;
  const rounds = new Map(playoffs.map((p) => [gameKey(p.date, p.home, p.away), p]));
  const games = shown.games.map((g): TextGame => {
    const base = {
      date: g.date,
      home: g.home,
      away: g.away,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      forfeit: g.forfeit,
      reported: !g.forfeit && isDisputed(disputed, g.date, g.home, g.away),
    };
    const playoff = rounds.get(gameKey(g.date, g.home, g.away));
    if (playoff) return { ...base, section: "playoff", group: `${playoff.bracket}, ${roundLabel(playoff.round, playoff.league)}`, order: ROUNDS.indexOf(playoff.round) };
    const away = programsFor(alignments, g.away);
    const together = programsFor(alignments, g.home).find(
      (x) => /^[1-9]\d*$/.test(x.district) && away.some((y) => y.league === x.league && y.division === x.division && y.region === x.region && y.district === x.district),
    );
    return together
      ? { ...base, section: "district", group: `${heading(together)}, ${placeLabel(together).replace(" · ", ", ")}` }
      : { ...base, section: season === CURRENT_SEASON ? "non-district" : "games" };
  });
  const sunday = new Date(Date.parse(`${shown.monday}T12:00:00Z`) + 6 * DAY).toISOString().slice(0, 10);
  const title = `${org.label} six-man football results, ${season} season, week ${week}`;
  return resultsText({ title, from: shown.monday, to: sunday, games });
}
