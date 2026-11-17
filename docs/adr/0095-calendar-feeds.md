# ADR 0095: Games on a phone calendar: a feed for each program and bracket, a file for each game

**Status:** Proposed Nov 16, 2026; accepted when its pull request is merged. It adds to ADR 0036 (kickoffs), ADR 0037 (a game
is "Away vs Home"), ADR 0040 (confirmed finals), ADR 0066 (site addresses) and ADR 0080 (phone speed).

## Context
- Fans plan their Fridays around a phone calendar, and the playoffs move a game's day, kickoff and site from round to round.
  The site showed all three, but a fan had to come back and look, or copy them by hand.
- Every game already has what a calendar event needs, built at build time: a stable page id, a date, a kickoff in UTC when the
  read found one (ADR 0036), a site and its address when known (ADRs 0041, 0066), and a status that says whether a score is a
  confirmed final, a score reported but not confirmed, or a forfeit (ADRs 0004, 0040).
- A calendar can subscribe to a file by address and check it again every few hours, so a static file rebuilt with each deploy
  keeps a phone current with no account, no server and no push permission.

## Decision
1. **Three kinds of static iCalendar (RFC 5545) files, made at build time** (`lib/calendar.ts`, pure and tested; routes
   `app/programs/[slug]/calendar.ics`, `app/playoffs/bracket/[slug]/calendar.ics`, `app/scores/[id]/calendar.ics`):
   - **A program's feed**, `/programs/<slug>/calendar.ics`: this season's games still to play and the ones already played.
   - **A bracket's feed**, `/playoffs/bracket/<slug>/calendar.ics`: this season's games in that bracket, listed ones and the ones
     the bracket sets once both teams are known (ADR 0079).
   - **A game's file**, `/scores/<id>/calendar.ics`: one event, for a game still to play with a date.
   All three read one list of the season's games (`lib/calendar-games.ts`): the bracket games, the games the bracket sets, and
   every robot-read result no bracket game already holds, each once, by the id of its page.
2. **An event:**
   - `UID` is `<game page id>@txsixmanfootball.com`, so a game is the same event in every feed and keeps its identity from
     "the bracket sets it" through its listing to its final (ADR 0079 keeps the page id). `DTSTAMP` is the build time.
   - `SUMMARY` is "Away vs Home" (ADR 0037), the same whether the game is played or not.
   - A game with a kickoff is a timed event: `DTSTART` in UTC, three hours long. A game without one is an all-day event on its
     date. A kickoff that is not a UTC time is not used, so a calendar never shows a wrong hour.
   - `LOCATION` is the site and its street address when the facts file has them. A neutral site, "Site not listed yet" and a
     home team named with no field are no place, so they leave the line out. Never a guess, and no source is named.
   - `URL` and the last line of `DESCRIPTION` are the game's page.
   - `DESCRIPTION` for a game still to play: "Kickoff 7:00 PM CT." (or "Kickoff time not listed yet.") and the bracket and
     round. For a played game: "Final: Away 14, Home 28." for a confirmed final; "Score reported: ..." for a score the sources
     do not agree on (ADR 0040), never "Final"; "Forfeit. No score was played." for a forfeit, which never shows its 1-0 or 2-0
     (ADR 0004). Scores are written in words, away team first. No file says "winner", "leading" or any betting word.
   - A game with no date, or no real date, is left out.
3. **Text and lines follow the standard:** TEXT values escape backslash, semicolon, comma and line breaks and drop control
   characters, so a team's name cannot start a new property; lines fold at 75 octets with CRLF and a space and never inside a
   character; the file ends with CRLF; `METHOD:PUBLISH`, a calendar name, and `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` of six
   hours, which the calendars that honor them use.
4. **Links, in plain words, 44 px:**
   - A program page and a bracket page show "Add to calendar" (the `webcal://` address, which an iPhone or a Mac subscribes to
     in one tap) and "Calendar file" (the same file over https, for Google Calendar, Outlook and the rest), under a line saying
     the calendar updates itself as games are set and played.
   - A game page shows one "Add to calendar" link (the file) for a game still to play. A played game shows none, and has no file.
   - The block is outside the search index, and each file is sent `noindex` (it is for a calendar app, not a reader).

## Consequences
- A feed is as fresh as the last deploy, the same as every page: Results watch rebuilds the site with each batch of new scores,
  and a calendar checks the feed again every few hours. A game's kickoff or site that changes reaches a subscriber then.
- The build writes one feed a program, one a bracket and one file a game still to play (none once the season is over): small text
  files made from lists already in memory.
- A program feed also lists the games already played, with the final in the description, so a fan's calendar is a record of the
  season too. A fan who wants only games to come can hide past events in the calendar app.
- Nothing is stored about a subscriber: a feed is a public file, fetched by the fan's calendar like any page.
- `scripts/calendar.test.mjs` pins the escaping, the folding (including multi-byte characters), the stable UID, timed and
  all-day events, a forfeit, an unconfirmed score and the wording; `e2e/calendar.spec.ts` reads real feeds for a program, a
  bracket and a game, checks they parse and answer `text/calendar`, and checks the links are 44 px.
