/**
 * The comment count to show after a page of comments arrives. The route counts with a window function, so a page past the
 * end (comments hidden or removed since the last page) comes back empty with `total: 0`. That says nothing beyond `offset`
 * exists, not that there are no comments: keep the count already known, lowered to the number on screen so "Show more"
 * goes away rather than asking again for a page that is empty. No second query.
 */
export function pageTotal(known: number, offset: number, page: { comments: unknown[]; total: number }): number {
  if (offset > 0 && page.comments.length === 0) return Math.min(known, offset);
  return page.total;
}
