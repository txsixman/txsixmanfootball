# ADR 0106: A phone check of the pages added in rounds 11 to 13

**Status:** Proposed Nov 17, 2026; accepted when its pull request is merged. It adds to ADR 0081 (accessibility sweep), ADR 0094
(brackets on a phone) and ADR 0096 (offline game night), and changes nothing they decided except where a finding below says so.

## Context
- The playoffs run Nov 19 to 21 and most fans read the site on a phone in a stadium. Rounds 11 to 13 added the week recaps
  (`/weeks`, ADR 0092), the bracket round tabs and who's left (ADR 0094), rankings movers and the program history chart
  (ADR 0091), share images (ADR 0093), calendar feeds (ADR 0095), the offline page and "Save for no signal" (ADR 0096),
  `/series/<a>/<b>` (ADR 0097), the 404 page (ADR 0098), `/seasons/<year>` (ADR 0099), `/leaders` (ADR 0101), the results text
  file and "Copy results" (ADR 0102) and the scoreboard's midweek order (ADR 0103). The existing phone checks run at 375 and 390
  px; none ran at 320 px, the narrowest phone still sold, and none looked at clipped text, heading order or the keyboard ring.
- Method. The live site (build b40a906) in headless Chromium at 320 and 375 px, light and dark, about 70 pages (every family
  above, the longest school names in the data: "The Christian School at Castle Hills-San Antonio", "Tyler Heat (Home Education
  Athletics of Tyler)", "Lone Star High School Southeast - Giddings"), each with axe-core (WCAG 2.2 AA, best practice and the
  experimental label-in-name rule) and a measurement of sideways scroll, every link and control's size, text cut by an ellipsis
  or a clamp, heading order and layout shift; plus taps through the round tabs, "Copy results", "Save for no signal", the
  offline bar and the keyboard ring, and the share image, calendar file and text file read as files.

## Findings and what was done
Each line: page, width, what a phone shows, the fix. All fixes are the smallest class or number change; nothing moves after load.

1. **The organization tab row's "UIL" was 36 by 44 px** at 320 on `/weeks`, `/weeks/<season>/<week>`, `/leaders`, `/rankings`,
   `/results` and `/records` (the shared `TabNav`: five tabs sharing 288 px). It now has `min-w-11`, and the row may wrap: at
   320 "Independent" takes a second row; from 360 up the row is one line as before.
2. **Week recap team names as short as 18 px** (`/weeks/2025/12` "Ira" 18x44, "May" 30, "Hart" 30, "NYOS" 42, "Savoy" 43) at 320
   and 375: a name link is only as wide as its text. `min-w-11` on `TeamName`.
3. **Long team names cut with "…" in the week recap and the season in review** (`/weeks/2026/2`, `/weeks/2026/11`,
   `/seasons/2025`, `/seasons/2026` at 320 and 375: "Grace Classical Ac…", "Tyler Heat (Home Education Athletics of…",
   "Prestonwood Christian Academy North-Pros…"). Their game lines now wrap (`break-words`) instead of `truncate`; the row grows
   by a line.
4. **Heading order on `/playoffs` and each league's page** (all widths): "Current round" was an `h3` straight after the page's
   `h1`. It is an `h2`. In the same lists two sections shared the name "Region 1 · region title chances" (Division I and II), a
   repeated landmark name; a list of chances is now a labelled `group` (same heading, not a landmark). `e2e/design-round3.spec.ts`
   asks for the group.
5. **Long names clipped 2 to 11 px sideways in clamped rows** (`/playoffs/tapps`, the TAPPS Division I bracket page at 320:
   "The Emery/Weiner School-Houston" and "Heritage School-Fredericksburg" in game rows, who's left and chances; a two-line clamp
   cannot break "Emery/Weiner"). `break-words` on the six clamped spans (`game-list`, `advance-table`, `chance-list`, `whos-left`).
6. **The keyboard ring on a bracket's round tabs lost its top and bottom** (all widths): the tab bar scrolls, so it clips whatever
   is outside it, and the ring sat 2 px outside a bar that has no room (the same fault the header's strip had). It is drawn
   inside the tab (offset -4 px): white on the open (filled) tab, navy on the others.
7. **The "Series" link on a program's season page was 43 by 44 px** (`/programs/jayton/2025`, 320 and 375; ADR 0097's link):
   `min-w-11`.
8. **Program page charts** (ADRs 0091 and the season-ratings line before it, 320 and 375): the left edge of the drawing lost the
   first character of a rating tick of 100 or more ("+125.0", "−100.0" began 6 units left of the picture; a good UIL team is
   +124), and the text drew at 11.8 px on a 320 phone. The left margin is 72 (was 64 and 56) and the text 17 (was 16): 12.6 px at
   320 and 14.9 at 375, every tick whole.
9. **The saved-copy bar at 320** (ADR 0096): its sentence beside the "Checking..." button runs four lines (72 px) and the bar is
   56 px, so the last line fell outside the dark bar. The bar and its spacer are 76 px under 330 px wide and 56 px from there up
   (three lines fit at every width from 330).

## Checked and fine
- No page scrolls sideways at 320 or 375, light or dark; every other link and control is 44 by 44 px or larger.
- Contrast: axe reports no color-contrast violation on any of the pages in either scheme; no dark-mode color falls back to light
  (the print block of "Copy results" is `hidden` on screen in both). The keyboard ring is 2 to 3 px in the theme's navy, which is
  light blue in dark.
- Layout shift is 0 on every page at 320 (two readings above 0.4 were pages that loaded without their stylesheet on a failed
  request; they were 0 on three repeats). `/scores` midweek shows Later and Next games first on screen (ADR 0103), the jump links
  are 80 by 44 px.
- Share images: a game between the two longest names draws both names whole over two lines on the 1200 by 630 card. Calendar
  files: `text/calendar; charset=utf-8`, CRLF lines, none over 75 octets, "Away vs Home", a UID per game. The results text file is
  UTF-8 plain text, one result a line. `/~offline`, the 404 page with a very long address, `/series/<a>/<b>` for the longest pair,
  "Save for no signal" and "Copy results" (44 px tall, nothing moves when the note appears) pass.
- Not a finding: `p-as-heading` (axe, experimental) names the site name in the header, a paragraph by design.

## Left as they are (deliberate, older than round 11)
- `/scores`, `/results`, `/programs/<slug>` and the tonight board cut a long name with an ellipsis in a fixed 44 px row; the
  full name is on the game and program page, and a taller row would move the board on game night. Rounds 11 to 13's lists wrap.
- `/rankings/how`'s chart labels are 10 px at 320 (the model scorecard, ADR 0071's neighbor); not part of rounds 11 to 13.

## Consequences
- `e2e/phone-320.spec.ts` (phone project, 320 px) holds each fix: for every family above no sideways scroll and every target
  44 px, no clipped text on the weeks, seasons and bracket pages, heading levels never skip on `/playoffs`, `/weeks`, `/seasons` and
  `/leaders`, the keyboard ring has room, every chart label is inside its drawing at 12 px or more, the organization tabs are all
  at least 44 px wide, and (CI, with the service worker) the saved-copy bar holds its sentence beside "Checking...". Run against
  the live site before the fix it failed on every finding above and passed on the rest.
- The shared sweep (`problems`, `open`, `firstLink`) moved from `e2e/phone.spec.ts` to `e2e/phone-guard.ts` so both specs use it.
- A new page should be added to `phone-320.spec.ts`'s family list. No data, request or page was added; no baseline screenshot
  changed (the tab row is unchanged from 360 px up).
