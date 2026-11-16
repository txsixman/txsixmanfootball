import { LEAGUES, loadBrackets } from "@/lib/brackets";
import { sideText } from "@/lib/bracket-fill";
import { roundName } from "@/lib/friday-card";
import { centralClock } from "@/lib/playoff-status";
import { projectionText } from "@/lib/projection";
import { CURRENT_SEASON } from "@/lib/season";
import { thisRound } from "@/lib/this-round";
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
  const games = thisRound(brackets, LEAGUES, today).flatMap(({ brackets: list }) =>
    list.flatMap(({ bracket: b, round }) => {
      const tag = `${b.name} · ${roundName(round.label)}`;
      const listed = round.games.map((g) => ({
        tag,
        away: g.away,
        home: g.home,
        state: g.forfeit ? ("forfeit" as const) : g.homeScore != null ? ("final" as const) : ("later" as const),
        awayScore: g.awayScore,
        homeScore: g.homeScore,
        confirmed: g.confirmed,
        projected: g.projection ? projectionText(g.projection) : undefined,
      }));
      // The games the bracket sets, after the listed ones, as the page lists them.
      const set = round.built.map((g) => ({
        tag,
        away: sideText(g.sides[0]),
        home: sideText(g.sides[1]),
        state: "later" as const,
        confirmed: false,
        projected: g.projection ? projectionText(g.projection) : undefined,
      }));
      return [...listed, ...set];
    }),
  );
  return gamesCard({ kicker: `${CURRENT_SEASON} season`, title: "Playoffs this round", games, empty: "Texas six-man playoff games this round" });
}
