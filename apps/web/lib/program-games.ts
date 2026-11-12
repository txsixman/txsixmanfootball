import type { Game } from "./demo-games";
import type { SeasonResult } from "./games";
import { isForfeit } from "./score-display";

/** One game of a school's season: a robot-read result or a playoff game, each with its own page (a playoff game also has a projection until played). */
export type Row = { id: string; date: string; status: string; home: boolean; opponent: string; score: string | null; note?: string; href: string };

const dateLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

/** A robot-read result from `school`'s side. A forfeit shows the word, never the 1-0 or 2-0 (ADR 0004). */
export function fromResult(school: string, r: SeasonResult): Row {
  const home = r.home === school;
  return {
    id: r.id,
    date: r.date,
    status: r.status,
    home,
    opponent: home ? r.away : r.home,
    href: r.href,
    score: r.forfeit ? "Forfeit" : home ? `${r.homeScore}-${r.awayScore}` : `${r.awayScore}-${r.homeScore}`,
  };
}

/**
 * A school's current season as one timeline, by date: robot-read results and playoff games together (a hand-captured
 * playoff game wins over a robot row for the same two teams on the same day), the latest score and the next game.
 * Used by the program page and by "My teams" on the home page. `allGames` are the season's playoff games
 * (loadGames), `seasonResults` the robot-read results (loadSeasonResults).
 */
export function seasonRows(school: string, allGames: Game[], seasonResults: SeasonResult[]) {
  const games = allGames.filter((g) => g.home.name === school || g.away.name === school);
  const key = (date: string | undefined, a: string, b: string) => [date, ...[a, b].sort()].join("|");
  const captured = new Set(games.map((g) => key(g.date, g.home.name, g.away.name)));
  const results = seasonResults.filter((r) => (r.home === school || r.away === school) && !captured.has(key(r.date, r.home, r.away)));
  const rows: Row[] = [
    ...results.map((r) => fromResult(school, r)),
    ...games.map((g): Row => {
      const home = g.home.name === school;
      const us = home ? g.homeScore : g.awayScore;
      const them = home ? g.awayScore : g.homeScore;
      return {
        id: g.id,
        date: g.date ?? "",
        status: g.date ? dateLabel(g.date) : g.status,
        home,
        opponent: (home ? g.away : g.home).name,
        score: us == null ? null : isForfeit(g) ? "Forfeit" : `${us}-${them}`, // a forfeit shows the word, never 1-0 (ADR 0004)
        note: g.state === "scheduled" && g.projected ? `Projected: ${g.projected}` : g.league,
        href: `/scores/${g.id}`,
      };
    }),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return { rows, results, games, latest: rows.findLast((r) => r.score), next: rows.find((r) => !r.score) };
}
