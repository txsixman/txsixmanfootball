import { resolveGame } from "@/lib/game-pages";
import { isForfeit } from "@/lib/score-display";
import { gameCardText, kickerSize } from "@/lib/share-text";
import { championBanner, stateCardTitle } from "./state-card";
import { stateChampionshipOf } from "./state-championship";

// What a game page's share card says (route.tsx draws it; the page's metadata uses the same words as the image's alt text).
// A module of its own: a route file may export nothing but its handlers.

/** What the card says, as one function of the game, so the page's alt text is the card's own words (the page calls this too). */
export async function cardOf(id: string) {
  const game = (await resolveGame(id))!;
  const { g, detail } = game;
  const championship = await stateChampionshipOf(id);
  const title = championship && stateCardTitle(championship.season, championship.bracket);
  const banner = championBanner(championship?.final);
  const kicker = title ?? g.league.replace(/\. Sample game.*/, "");
  const text = gameCardText({
    kicker,
    date: g.date,
    kickoff: g.kickoff,
    site: g.venue,
    state: g.state,
    forfeit: isForfeit(g),
    confirmed: g.verification === "confirmed",
    // A sample game keeps its invented records; a real game's are its season record going in (lib/game-pages.ts).
    away: { name: g.away.name, score: g.awayScore, record: detail ? detail.going.away.record : g.away.record },
    home: { name: g.home.name, score: g.homeScore, record: detail ? detail.going.home.record : g.home.record },
    banner,
  });
  return { g, text, kicker, kickerSize: kickerSize(kicker, text.upcoming), banner };
}

