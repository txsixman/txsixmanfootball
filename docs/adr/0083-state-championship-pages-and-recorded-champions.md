# ADR 0083: A page for every State Championship, and a recorded final names its champion everywhere

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0040 (a confirmed final names
a winner), ADR 0057 (no home edge at a State Championship) and ADR 0072 (a renamed or merged school's titles).

## Context
- The 2026 season ends in stages: one private league's State Championship is already played, another's are this week,
  and UIL's are in mid-December. Until now a champion reached `/championships`, the program pages and the title counts
  only through UIL's own archive (`data/seed/uil-champions`), rerun by hand after December. The private leagues had no
  champions list at all, though their State Championship games since 2018 are in the playoff files.
- Fans look for one page per State Championship: who plays, when and where, how each team got there, and afterwards
  who won.

## Decision
- **One list of champions.** `lib/state-finals.ts` (pure) names the champion of a State Championship game (round `final`
  or `state`) the moment its final is recorded by the results robot or a correction: played, confirmed (ADR 0040) and not
  a tie. A forfeit names its winner with no score. `lib/state-championships.ts` `recordedFinals()` reads every season's
  playoff files (2018 on); every page takes its champions from it, so nothing is edited by hand.
- **UIL's archive stays the record for UIL.** `loadFinals()` is the archive plus each recorded UIL final for a season and
  division the archive does not list yet; once the archive lists it, the archive's row wins. Program pages keep counting
  UIL state titles only, where they say "UIL"; private-league titles are a separate count.
- **The private leagues' recorded finals are their record** on `/championships`, `/championships/<year>` and the
  program pages, grouped by league.
- **A State Championship page for each bracket of the season under way**, `/championships/<season>/<bracket>`. Before
  the game: the matchup (or "Winner of …" while a side is open), kickoff in Central time, the site with Directions, each
  team's playoff results and season record, the projected margin and chance to win, and each program's past State
  Championship appearances and titles. After the final: the champion, the score, the runner-up and the full bracket.
  `/playoffs`, the bracket pages, `/championships`, both programs' pages and the game page link to it.
- **UIL's State Championship date and site** are written by hand in `data/seed/uil-2026-28/bracket-2026.csv` (slot G31
  of each division) from UIL's own state championship page, as the rest of that file is. A site with no street address
  yet gets Directions by its name and city.
- **The game page's share card** of a State Championship reads "<season> <bracket> State Championship" and, once the
  final is recorded and confirmed, names the champion. Every other card is unchanged.
- **Wording:** headings say "State Championship", never "final round" or "title game"; "Final" stays a score status.

## Consequences
- A final recorded on a game night shows as the champion on every page with the next deploy.
- When UIL's archive is rerun after December, its rows replace the recorded UIL finals with no visible change unless the
  two disagree, which `check-data` does not yet compare (a follow-up if it ever happens).
- Only the season under way has State Championship pages; a past season's games keep their game pages.
