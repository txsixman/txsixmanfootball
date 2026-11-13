import { findGame, gameIds } from "@/lib/game-pages";
import { memo } from "@/lib/memo";
import { CURRENT_SEASON } from "@/lib/season";

/** This season's games (bracket and sample games, and robot-read games of the current season) get a card; a past season's
 * game page shares the site's card. One card per game of every season would be ~6,800 images drawn on every build. */
export const hasCard = async (id: string) => ((await findGame(id))?.season ?? CURRENT_SEASON) === CURRENT_SEASON;

export const cardIds = memo<void, string[]>(async () => {
  const ids = await gameIds();
  const keep = await Promise.all(ids.map(hasCard));
  return ids.filter((_, i) => keep[i]);
});
