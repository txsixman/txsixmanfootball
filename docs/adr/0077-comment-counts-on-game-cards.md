# ADR 0077: Comment counts on the score cards

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds one public read and one route under
ADR 0018's game comments and ADR 0052's posts switch, and changes no rule of either.

## Context
- With posts open, a fan on `/scores` cannot tell which games have a comment thread without opening each game page.
- The score pages are static. Anything per-game and live has to come from the browser, and game night (Friday, and the
  other playoff nights) is when the scoreboard is open on many phones at once. One request per card, or one database call
  per visitor, would be the wrong load.

## Decision
- **A new public read, `comment_counts(p_game_keys text[])` (migration 0029):** for each game key given, the number of
  comments `list_comments` would show for it, under the same rule (the post is not hidden and its author is not banned; a
  muted author's comment still counts). Only keys with at least one come back. Only the first 200 array elements are looked at.
  It returns a key and a number, no id, name, text or time. It is `security definer`, `stable`, pins `search_path`, is
  revoked from public and granted to `anon` and `authenticated` the way migration 0013 grants `list_comments`, and is in
  `ANON_FUNCTIONS` so the live role check covers it. Like the other public reads it is not behind the database's posts switch
  (ADR 0052): it only reads.
- **A route, `GET /api/games/comment-counts?keys=k1,k2,...`:** 404 first while posts are off (the same gate as every posts
  route). Keys that are not a game page's id are dropped, the rest deduped, at most 200. It answers `{ counts: { <key>: <n> } }`
  with the nonzero ones only. A database error is a 502 that logs only the error code.
- **Cached for 30 seconds:** `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`. A count may lag a new
  comment, or a comment hidden by flags, by about 30 seconds, and the database sees one read per distinct list of keys, not one
  per visitor. This is the one posts read that is cached; the comments themselves stay `no-store`, so a hidden comment
  disappears from its game page at once even while the card's count still includes it for up to a minute.
- **The card shows it:** each card on `/scores` that has comments says "1 comment" or "N comments" with a small icon, as plain
  text at the bottom of the card's text block (the card is one link to the game page). Nothing shows while the number loads, at 0, when posts
  are off (the route's 404) or when the request fails. The cards of a page share one request, in chunks of 200 keys; a count
  is asked again only when it is older than 30 seconds, and nothing is asked for 5 minutes after a 404. The invented sample
  scoreboard never asks. No `NEXT_PUBLIC` flag is added: the route's 404 is the switch.
- **A link variant exists** for a place that is not already a link (a playoffs row, later): the same count linking to
  `/scores/<id>#comments`, which is the comments block's heading.

## Consequences
- A visitor to `/scores` makes one more small request while posts are on, and none while they are off.
- A game with only hidden comments shows nothing, and a game whose last comment was just hidden may show a stale "1 comment"
  for up to a minute.
- The count includes every visible comment, whoever wrote it. Nothing here ranks games or fans.
