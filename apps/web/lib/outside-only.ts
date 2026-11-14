/** A team-season rated only from games against teams outside our list (`rated_outside` > 0, no listed game: `rated` 0 and a 0-0
 * record). A record would read 0-0 beside a rating, so pages say this instead (rankings, program history). */
export const OUTSIDE_ONLY_NOTE = "Rated from games against teams outside our list.";

export const ratedFromOutsideOnly = (r: { rated?: number; won: number; lost: number; tied: number; rated_outside?: number }) =>
  r.rated === 0 && r.won + r.lost + r.tied === 0 && (r.rated_outside ?? 0) > 0;
