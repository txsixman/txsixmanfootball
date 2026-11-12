/** A forfeit as robot-read results record it: 1-0 or 2-0 (either way round). A 2-0 or 1-0 six-man game decided on the field
 * is all but unknown. Twin of `forfeit_score` in services/ratings/rows.py: change one, change the other
 * (lib/forfeit-cases.json holds the table both test). 0-0 is a no contest, which the ratings also leave out; the pages
 * show it as a tie. */
export const forfeitScore = (a: number, b: number) => Math.max(a, b) <= 2 && Math.min(a, b) === 0 && a !== b;
