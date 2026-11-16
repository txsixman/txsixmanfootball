# ADR 0086: A landing page at /welcome; home stays the scoreboard

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds a page and one small link on home;
it changes nothing any other page says.

## Context
- The owner asked (Nov 16, 2026) for a dedicated landing page: where a first-time visitor or a shared link lands, saying
  in under a minute what the site is and sending them where they want to go.
- Home (`/`) is a scoreboard: games to watch, rankings, title chances. In playoff week it is the page fans open again and
  again, so it should not become a brochure.

## Decision
- **A separate page, `/welcome`.** Home stays the scoreboard. `/welcome` is static (`force-static`), built from the same
  data as every page (`app/welcome/facts.ts`), so nothing on it is typed in but the words (`lib/welcome.ts`):
  - **Hero:** what the site is ("Every team. Every game."), a live line as of the build (the round being played in every
    bracket, counted as `/playoffs/this-round` counts it, and tonight's games as `/scores/tonight` lists them; out of the
    playoffs, the season's games so far), and two calls to action: Find your team (`/programs`) and Tonight's scores.
  - **What's here:** live scores, the ratings (rating, projected margin, chance to win), brackets for every league that has
    one this season, program pages, State Championships, and following teams with alerts.
  - **By the numbers:** programs, games with scores, seasons of results, UIL State Championship games, from the data.
  - **Get alerts:** find the team, tap its alert button, allow notifications; on iPhone, add to the Home Screen first.
  - A closing call to action, and the usual header and footer.
- **Fan accounts are named only while they are on.** The page is built without them; a line saying what an account adds
  appears after load when `/api/me` says accounts are on (FAN_SIGNIN), so the page never promises what the site does not offer.
- **Home's link is for a first visit only.** "New here? Start here", small and dismissible, under home's opening lines. It
  is drawn with the page, and an inline script before it hides it before it paints (`data-returning` on `<html>`) for a
  browser that has been here (`welcome-seen` in localStorage), follows a team or was signed in, so it never moves the
  page (layout shift stays 0). A first visit marks the browser seen, so the next visit does not show it; dismissing it
  or opening `/welcome` does the same. Nothing else on home changes.
- **Wired in:** the footer's "About this site" links ("New here?"), the sitemap's sections (lastmod: the latest game, as
  home), a canonical link, its own title, description, `AboutPage` JSON-LD and share card.
- **Held to ADRs 0080 and 0081:** `/welcome` is in Lighthouse's pages (with the same budgets) and in the axe sweep at 375 px;
  `e2e/welcome.spec.ts` checks its content, metadata, share card, overflow, 44 px targets, axe, and the home link's
  first-visit, dismiss and follow rules. Section and program links on it do not prefetch.

## Consequences
- A shared link to the site can point at `txsixmanfootball.com/welcome`.
- The page's words name each organization (ADR 0012), no source (ADR 0010) and no winner (ADR 0004); the last round is the
  State Championship. A new section of the site should get a card here.
- A visitor whose storage is blocked sees the home link on every visit until they dismiss it on a browser that keeps it.
