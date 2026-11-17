import { addressLine } from "./address";
import type { CalendarGame } from "./calendar";
import { demoGames, type Game } from "./demo-games";
import { isDisputed, loadDisputed } from "./disputed";
import { bracketGames, builtGamePages } from "./game-pages";
import { loadSeasonResults } from "./games";
import { homeFieldAddress, loadHomeFields, regularSeasonSite } from "./home-fields";
import { kickoffOf, knownAddress, knownSite, loadAddresses, loadKickoffs, loadSites } from "./kickoffs";
import { memo } from "./memo";
import { CURRENT_SEASON } from "./season";
import { isForfeit } from "./score-display";

// This season's games in the shape a calendar feed needs (ADR 0095): the bracket games (played, and still to play), the games
// a bracket sets once both teams are known, and every robot-read result no bracket game already holds, each once, by the id
// of its page. Read once per build worker: every program, bracket and game feed filters this one list. Never mutate it.

/** A site worth putting in a calendar: not "Site not listed yet", not "Neutral site", and a home team alone is no place. */
const placeOf = (venue: string | undefined, home?: string) => (venue && !/not listed|^neutral site/i.test(venue) && venue !== `${home} (home)` ? venue.replace(/ \(home\)$/, "") : undefined);

/** A scoreboard game (a bracket game or one the bracket sets) as a feed's game. A forfeit and a disputed final say so, and a
 * forfeit carries no score (ADR 0004). */
function fromGame(g: Game, kickoff: string | undefined): CalendarGame {
  const played = g.state === "final" && g.homeScore != null && g.awayScore != null;
  return {
    id: g.id,
    date: g.date,
    kickoff: g.kickoff ?? kickoff,
    away: g.away.name,
    home: g.home.name,
    label: g.league,
    site: placeOf(g.venue),
    address: g.address && addressLine(g.address),
    status: !played ? "to-play" : isForfeit(g) ? "forfeit" : g.verification === "confirmed" ? "final" : "reported",
    ...(played && !isForfeit(g) ? { score: { away: g.awayScore!, home: g.homeScore! } } : {}),
  };
}

const calendarGames = memo<void, CalendarGame[]>(async () => {
  const [bracket, built, results, kickoffs, sites, addresses, fields, disputed] = await Promise.all([
    bracketGames(),
    builtGamePages(),
    loadSeasonResults(CURRENT_SEASON),
    loadKickoffs(CURRENT_SEASON),
    loadSites(CURRENT_SEASON),
    loadAddresses(CURRENT_SEASON),
    loadHomeFields(),
    loadDisputed(CURRENT_SEASON),
  ]);
  const own = [...bracket.filter((g) => !demoGames.includes(g)), ...built];
  const kept = new Set(own.map((g) => [g.date, ...[g.home.name, g.away.name].sort()].join("|")));
  const games = new Map<string, CalendarGame>();
  for (const g of own) games.set(g.id, fromGame(g, g.date ? kickoffOf(kickoffs, g.date, g.home.name, g.away.name) : undefined));
  for (const r of results) {
    if (kept.has([r.date, ...[r.home, r.away].sort()].join("|"))) continue; // a bracket game already holds it
    const id = r.href.slice("/scores/".length);
    const site = knownSite(sites, r.date, r.home, r.away);
    const field = site ?? regularSeasonSite(fields, r.home, r.neutral === true, CURRENT_SEASON);
    const address = site ? knownAddress(addresses, r.date, r.home, r.away) : homeFieldAddress(fields, r.home, r.neutral === true, CURRENT_SEASON);
    games.set(id, {
      id,
      date: r.date,
      kickoff: kickoffOf(kickoffs, r.date, r.home, r.away),
      away: r.away,
      home: r.home,
      label: `${CURRENT_SEASON} season`,
      site: placeOf(field, r.home),
      address: placeOf(field, r.home) && address ? addressLine(address) : undefined,
      status: r.forfeit ? "forfeit" : isDisputed(disputed, r.date, r.home, r.away) ? "reported" : "final",
      ...(r.forfeit ? {} : { score: { away: r.awayScore, home: r.homeScore } }),
    });
  }
  return [...games.values()];
});

/** A program's season: every game of this season with the school in it, played or still to come. */
export async function programCalendarGames(school: string): Promise<CalendarGame[]> {
  return (await calendarGames()).filter((g) => g.home === school || g.away === school);
}

/** A bracket's games this season (UIL "Division I" is "UIL DI" on a game's label). */
export async function bracketCalendarGames(bracketName: string): Promise<CalendarGame[]> {
  const prefix = `${bracketName.replace("Division ", "D")} · `;
  return (await calendarGames()).filter((g) => g.label?.startsWith(prefix));
}

/** The games a game page offers "Add to calendar" for: dated and still to play. A played game has nothing to add. */
export async function upcomingCalendarGames(): Promise<CalendarGame[]> {
  return (await calendarGames()).filter((g) => g.date && g.status === "to-play");
}
