# ADR 0079: Pages for the games the bracket sets, at one address that keeps

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0047 (games the bracket sets)
and ADR 0018 (game comments), and changes the page address rule of a current-season playoff game.

## Context
- `/playoffs/this-round` listed 28 games on Nov 16, 2026, but only 9 had a game page, and so a "Comments" link: the ones a
  listing holds. The other 19 were set by the bracket from earlier winners (ADR 0047), for example most UIL area games
  (Nazareth v Hermleigh, Jayton v Whiteface), and had no page, no comment thread and no game details, days before they
  were played.
- A current-season playoff game's page id was `<season>-<round>-<away>-at-<home>` in its **listing's** order, and a
  comment thread is keyed by that id. A listing and a recorded final are read from another site, which picks its own home
  team. The bracket's own home designation does not predict it: for 14 of the 21 later-round games already listed, the
  listing named the bracket slot's second side as home. So an id taken from a game the bracket sets, before any listing,
  would change when the listing arrived, leaving its thread behind and making a second page.
- Posting a comment needs the database to know the game (`resolve_game_key`, migration 0013): a stored game row whose
  home and away match the key's order. A game the bracket sets has no row until a listing holds it.
- No comment existed on any game when this was decided, so moving an address cost no thread.

## Decision
- **Every game the bracket sets gets a page once both teams are known** (`lib/game-pages.ts` `builtGamePages`), at
  `/scores/<season>-<round>-<away>-at-<home>`: kickoff, site and address with Directions once the read finds them (ADR
  0067), else "Date not listed yet" / "Site not listed yet"; the projection on a neutral field; each team's record going
  in, earlier meetings, and the Comments section. No score-report form: there is no database row to report on until a
  listing holds the game.
- **One address rule for the season under way** (`lib/page-id.ts`, `bracket-fill.ts` `pageOrders`): a game the bracket
  sets by winners (a slot both of whose sides are fed by an earlier slot) takes the **bracket's order**: home is the slot's
  first side, away its second. The same before any listing, once a listing holds it, and once results-watch records its
  final, whichever way round the listing or the final writes the teams. A listed game whose feeding final is not yet
  confirmed takes each side's team from the listing. Any other game (a first round, a game no slot places, a past season)
  keeps its listing's order, as before.
- **The old address redirects.** A listed game whose listing order differs (14 on Nov 16) answers its listing-order
  address with a permanent redirect to the bracket-order one. The redirect is not in the sitemap and has no share card.
- **Score reports keep the database's order:** the game page passes the listing-order key to the score-report form,
  since migration 0014 reads home and away from the stored row.
- **The database accepts comments on these keys** (migration 0030): a table `bracket_pairing` of the season's
  bracket-set pairings (both orders), replaced by `packages/db/load.mjs` on every load from the same bracket code
  (`tools/league-watch/bracket-due.mjs` `pagePairings`), and `add_comment` now asks `comment_game_known`: a stored game in
  either order, or a key in that table. `resolve_game_key` and the score reports are unchanged.
- **Where they show:** the bracket-set rows on `/playoffs/this-round`, `/playoffs` and the bracket pages link to their
  comments as listed rows do (ADR 0078); the bracket tree's boxes link to the pages; the pages are in the sitemap and in
  the bracket page's list of games for search engines (with no start date while the day is not known).

## Consequences
- `scripts/page-id.test.mjs` checks that a game the bracket sets and its later listing or recorded final share one id
  either way round, on invented teams and on the committed season's own UIL brackets.
- `e2e/posts-signed-in.spec.ts` checks that every game on `/playoffs/this-round` with both teams known has a Comments link
  and that its page answers 200 as itself.
- A pairing a corrected final undoes drops out of the table on the next load; a comment already left on it stays in the
  database, on a page that no longer exists.
- The table reaches the hosted database with the next full load (the Supabase workflow, or Monday's run); until then a
  per-read load says it skipped the pairings, and comments on a bracket-set game are refused as an unknown game.
- Past seasons are untouched: their pages are date-based (ADR 0069).
