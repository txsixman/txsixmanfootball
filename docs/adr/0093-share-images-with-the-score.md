# ADR 0093: Share images that show the score, the matchup and the standing

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0004 (only a confirmed final names a
winner), ADR 0040 (a final is confirmed unless disputed), ADR 0083 (State Championship pages and recorded champions), ADR 0006 and
ADR 0016 (logos shown as published, else the initials badge in the school's colors) and ADR 0080 (the pages are static and edge cached).

## Context
- A fan who shares a game, a team or a State Championship link on game night pastes it into a text or a post, and the app there
  draws the page's preview image. Game pages of the season under way already had a card (both teams, the date, the final score) and
  program pages had a name-and-rank card with no logo; State Championship pages had no card of their own, so they showed the site's
  default. A game still to play showed two names and no time, site or record, and no card had alt text that said what it showed or
  a large Twitter card tag.
- Every fact a card needs is in the build's own data. The cards are made at build time, as the pages are.

## Decision
- **Game pages** (`/scores/<id>/card`, as before, drawn from `app/share-card.tsx`):
  - a **final**: both teams (logo, else initials badge), the final score, the round and the date; "Final" in the footer only for a
    confirmed final, "Score reported" for a score the sources do not agree on, "Forfeit" with no score. The team that lost a confirmed
    final is dimmed; nothing is dimmed for any other game (ADR 0004).
  - a **game still to play**: the matchup, the day, kickoff in Central time and site, each when known (a site "not listed yet" is
    left off), and each team's record going in, written "Record 7-2" and in alt text "7 wins and 2 losses".
  - a **State Championship's game** keeps its title and, once recorded and confirmed, its champion banner.
- **Program pages** (`/programs/<slug>/card`, replacing `opengraph-image.tsx`, so the card can carry alt text of its own): the
  school's logo as published, its name and place, this season's record and rank, and its latest score ("Latest score: 75-6 vs Kress",
  or "Latest game: forfeit at Kress"). No winner is named; a robot-read score may be unconfirmed (ADR 0004). A school with no logo
  gets the initials in its colors. The program's season pages share the program's card.
- **State Championship pages** (`/championships/<season>/<bracket>/card`): the matchup (a side not known yet reads "Winner of G29")
  with the day, time, site and each team's season record; or, once the final is recorded and confirmed, the champion and the score;
  the listed score alone, with no champion, while the result is not confirmed; a forfeit's winner with no score (ADR 0083). The words
  are "State Championship" always.
- **Every card** is 1200 by 630, in the site's navy with the red bar (or the school's colors on a program card), and its largest text
  is the teams and the score or the time, so it reads as a small phone thumbnail. Each page's metadata has `og:image` and `twitter:image`
  with the card's size, `twitter:card` `summary_large_image`, and alt text (`og:image:alt`, `twitter:image:alt`) that says what the card
  shows: "Final score, UIL Division I · Quarterfinal, Friday, November 27, 2026: Kress 14, Jayton 42."; "Scheduled, TAIAO D1 ·
  Semifinal: Austin Royals versus Texas Wind, Friday, November 20, 2026 at 7:30 PM CT, at Texas Wind Stadium, Waco. Records: Austin Royals
  5 wins and 4 losses; Texas Wind 9 wins and 1 loss." Alt text writes records and scores out in words (a bare "1-0" reads as a forfeit
  score). The image and its alt text come from one function (`lib/share-text.ts`), unit-tested.
- **A card shows the last deploy, never a live score.** The cards are drawn at build time from the static data, so a game being played
  has no score on its card until the results robot's next commit deploys (every ten minutes on a playoff night, ADR 0015); a card
  for a game under way says "Scheduled" or "In progress", with no score and no leader. Link-preview apps cache a card for some time
  after they first see it, so a link shared before kickoff may keep showing the preview card it first got; the page itself is always
  current. A live-score image would need a request-time image route and a database read per share, which ADR 0080 keeps off the
  pages; it is not built.
- **Where the cards stop:** a card per game of every season would be about 6,800 images. The game cards stay at this season's games
  (about 1,340 now: the bracket and the robot-read games), as ADR 0079's routes had them; a past season's game page shares the site's
  card. Bracket pages keep their own images (ADR 0049).

## Build cost (measured, one process, the image drawing only)
| | Before | After |
|---|---|---|
| Game cards (1,341) | 25.7 s, 95 MB of PNG | 23.8 s, 95 MB |
| Program cards (283) | 3.0 s, 14 MB | 7.0 s, 28 MB (the logo is drawn on each) |
| State Championship cards (11) | none | 0.2 s, 0.8 MB |
| Total | 28.7 s | 31.0 s |

About 2 to 3 seconds more of drawing for the whole site, spread across the build's workers, and 14 MB more static output (the program
logos). The same measurement puts a card for every game of every season at about 100 seconds and 400 MB more, which is why past
seasons stay on the default card. The page's own metadata now reads the card's text for each of this season's game pages (94 ms for
all 1,341).

## Consequences
- A State Championship link, a team link and a game link each preview with their own facts; a game ahead names its day, time and site.
- `/programs/<slug>/opengraph-image` no longer exists; the program card is at `/programs/<slug>/card`. Nothing links to the old address
  (its tags were generated); a scraper holding the old address gets the site's card on its next fetch of the page.
- A new kind of page that wants a card adds its words to `lib/share-text.ts` and a route that draws them with `app/share-card.tsx`.
