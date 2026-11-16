// The keys a comment count is asked for (/api/games/comment-counts, ADR 0078). One rule for the route and the score cards'
// script, so what the page sends is what the route accepts. A key is a game page's address id, the same pattern
// /api/games/[id]/comments accepts (and the posts table's check, migration 0013).
export const COUNT_KEY = /^[a-z0-9][a-z0-9-]{5,200}$/;
/** At most this many keys in one request, and in one database call (comment_counts looks at no more). */
export const MAX_COUNT_KEYS = 200;

/** The valid keys of a comma-separated list, each once, in the order given, at most MAX_COUNT_KEYS. Anything else is dropped. */
export function parseCountKeys(raw: string | null): string[] {
  if (!raw) return [];
  // Bounded before it is split: 200 longest keys and their commas is under 41,000 characters.
  const seen = new Set<string>();
  for (const key of raw.slice(0, 41_000).split(",")) {
    if (seen.size === MAX_COUNT_KEYS) break;
    if (COUNT_KEY.test(key)) seen.add(key);
  }
  return [...seen];
}
