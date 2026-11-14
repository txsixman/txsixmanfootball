import { loadBrackets, LEAGUES } from "@/lib/brackets";
import { roundName } from "@/lib/friday-card";
import { centralClock, currentRound } from "@/lib/playoff-status";
import { projectionText } from "@/lib/projection";
import { CURRENT_SEASON } from "@/lib/season";
import { gamesCard } from "../../friday-card";
import { cardSize } from "../../page-card";

export const size = cardSize;
export const contentType = "image/png";
export const alt = `Texas six-man playoff games this round, ${CURRENT_SEASON}`;
export const dynamic = "force-static";

/** The games the page lists, in its order: each league (ADR 0012), then each bracket's current round, tagged with both. */
export default async function Card() {
  const brackets = await loadBrackets();
  const today = centralClock().date;
  const games = LEAGUES.flatMap((league) =>
    brackets.filter((b) => b.league === league).flatMap((b) => {
      const round = currentRound(b.rounds, today);
      return (round?.games ?? []).map((g) => ({
        tag: `${b.name} · ${roundName(round!.label)}`,
        away: g.away,
        home: g.home,
        state: g.forfeit ? ("forfeit" as const) : g.homeScore != null ? ("final" as const) : ("later" as const),
        awayScore: g.awayScore,
        homeScore: g.homeScore,
        confirmed: g.confirmed,
        projected: g.projection ? projectionText(g.projection) : undefined,
      }));
    }),
  );
  return gamesCard({ kicker: `${CURRENT_SEASON} season`, title: "Playoffs this round", games, empty: "Texas six-man playoff games this round" });
}
