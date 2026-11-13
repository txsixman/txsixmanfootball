/** The season the site is showing: its playoff brackets and title chances, scores, standings and the "2026 games" on a program page.
 * One place to bump when the next season's data starts (lib/ratings.ts finds the latest ratings table on its own). */
export const CURRENT_SEASON = 2026;

/** The oldest season with game results ("since 2021" on game pages, search and the admin console). check-data fails unless
 * it is the oldest data/seed/maxpreps-<year> folder and the oldest data/ratings table, so a backfill moves it in the same change. */
export const FIRST_SEASON = 2021;
