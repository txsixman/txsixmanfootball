import type { Game, Team } from "./demo-games";
import { isForfeit } from "./score-display";
import { SITE_URL } from "./site";

// Structured data (schema.org JSON-LD) for search engines. It says only what the page already says: a score only when
// the page's own rules call it confirmed (ADR 0004, 0011, 0013), never a winner from an unconfirmed score, nothing
// that reads as betting, and no source named (ADR 0009, 0010).

const CONTEXT = "https://schema.org";
const SPORT = "Six-man football";
const abs = (path: string) => `${SITE_URL}${path}`;

/** A page's own trail, last entry the page itself: breadcrumbs on screen and in the markup come from one list. */
export type Crumb = { name: string; href: string };

export const breadcrumbList = (trail: Crumb[]) => ({
  "@context": CONTEXT,
  "@type": "BreadcrumbList",
  itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.href) })),
});

/** The ranked teams in table order: position, name and page. No ratings or numbers. */
export const rankedList = (name: string, teams: { name: string; href: string }[]) => ({
  "@context": CONTEXT,
  "@type": "ItemList",
  name,
  itemListElement: teams.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, url: abs(t.href) })),
});

export const programJsonLd = (p: { name: string; slug: string; league?: string; logo?: string }) => ({
  "@context": CONTEXT,
  "@type": "SportsTeam",
  name: p.name,
  sport: SPORT,
  url: abs(`/programs/${p.slug}`),
  ...(p.logo && { logo: abs(p.logo) }),
  ...(p.league && { memberOf: { "@type": "SportsOrganization", name: p.league } }),
});

/** The site the game page names: a home field, a neutral site, or a bracket game's site ("Shotwell Stadium, Abilene",
 * ADR 0041). A site "not listed" is left out, never guessed. */
function placeName(venue: string): string | undefined {
  if (/^(Site not listed|Neutral site or not listed)/.test(venue)) return undefined;
  return /\(home\)$/.test(venue) ? venue.replace(/ \(home\)$/, " home field") : venue;
}

/**
 * A game as a SportsEvent. Home and away are named only for a game at a team's own field; any other game lists its two
 * teams as competitors. The result is a description, and only for a confirmed final that was played: an unconfirmed
 * score (every robot-read one) and a forfeit carry none.
 */
export function gameJsonLd(g: Game, { url, home, away }: { url: string; home?: { slug: string }; away?: { slug: string } }) {
  const team = (t: Team, p?: { slug: string }) => ({ "@type": "SportsTeam", name: t.name, sport: SPORT, ...(p && { url: abs(`/programs/${p.slug}`) }) });
  const place = placeName(g.venue);
  const homeField = /\(home\)$/.test(g.venue);
  const played = g.state === "final" && g.verification === "confirmed" && !isForfeit(g) && g.homeScore != null && g.awayScore != null;
  return {
    "@context": CONTEXT,
    "@type": "SportsEvent",
    name: `${g.away.name} vs ${g.home.name}`,
    url,
    sport: SPORT,
    ...(g.date && { startDate: g.date }),
    ...(g.state === "scheduled" && { eventStatus: "https://schema.org/EventScheduled" }),
    ...(g.state === "postponed" && { eventStatus: "https://schema.org/EventPostponed" }),
    ...(place && { location: { "@type": "Place", name: place } }),
    ...(homeField ? { homeTeam: team(g.home, home), awayTeam: team(g.away, away) } : { competitor: [team(g.away, away), team(g.home, home)] }),
    ...(played && { description: `Final: ${g.away.name} ${g.awayScore}, ${g.home.name} ${g.homeScore}.` }),
  };
}
