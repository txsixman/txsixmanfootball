import { nightTitle } from "@/lib/game-night";
import { loadNight } from "@/lib/tonight";
import { gamesCard } from "../../friday-card";
import { cardSize } from "../../page-card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = "Tonight's Texas six-man games";
export const dynamic = "force-static";

/** Tonight's games, one organization at a time as the page lists them (ADR 0012), each tagged with its own; a game two organizations share is drawn once. */
export default async function Card() {
  const night = await loadNight();
  const seen = new Set<string>();
  const games = night.orgs.flatMap((o) =>
    o.rounds.flatMap((r) =>
      r.games.filter((g) => !seen.has(g.id) && seen.add(g.id)).map((g) => ({
        tag: g.where === "Season game" ? `${o.label} · season game` : g.where,
        away: g.away,
        home: g.home,
        state: g.state,
        awayScore: g.awayScore,
        homeScore: g.homeScore,
        confirmed: !g.unconfirmed,
        projected: g.projected,
      })),
    ),
  );
  return gamesCard({ kicker: night.count ? nightTitle(night.night) : "", title: "Tonight", games, empty: "Texas six-man scores tonight" });
}
